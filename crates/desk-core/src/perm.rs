//! The permission engine: everything is denied unless a grant covers the call's scope and the scope
//! covers the call's target. `always` grants are kept in the grant file when there is one (ADR 0029);
//! a `once` grant is spent by the first call it allows.

use std::path::PathBuf;

use desk_bridge::{CallerGrant, EventName, Grant, GrantDuration, Permission, ShellScheme};

use crate::grants;
use crate::paths::{
    endpoint_covers, endpoint_match, glob_match, host_covers, host_match, normalize,
    pattern_covers, setting_match, star_match,
};
use crate::time::rfc3339_now;

/// What a call touches, checked against its scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target<'a> {
    /// The permission has no target of its own (audio, ui).
    None,
    Path(&'a str),
    Command(&'a str),
    Host(&'a str),
    /// An http or https URL (net.fetch): its host, and its port where the scope names one, as
    /// desk-sys matches every URL of the call.
    Url(&'a str),
    /// A host and port a TCP connection goes to (net.connect).
    Endpoint {
        host: &'a str,
        port: u16,
    },
    /// A command id in the command registry (cmd.invoke).
    CommandId(&'a str),
    /// Event names (events.subscribe).
    Events(&'a [EventName]),
    /// Another owner's setting as `owner/key` (settings.get).
    Setting(&'a str),
    /// The scheme of a link handed to the system (shell.open); a reveal is a `Path`.
    Scheme(ShellScheme),
    /// The app a computer call reaches, by bundle id; `None` for none in particular (a display).
    App(Option<&'a str>),
}

/// A denied call: the scope that was missing and why.
#[derive(Debug, Clone, PartialEq)]
pub struct Denied {
    pub permission: Permission,
    pub reason: String,
}

/// Grants per caller, oldest first. Not thread-safe on its own; `Core` wraps it in a mutex.
#[derive(Debug, Default)]
pub struct PermissionEngine {
    grants: Vec<(String, Grant)>,
    next_id: u64,
    file: Option<PathBuf>,
}

impl PermissionEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// An engine that keeps `always` grants in `file`, starting with the ones it holds.
    pub fn with_file(file: PathBuf) -> Self {
        let (next_id, grants) = grants::load(&file);
        Self {
            grants,
            next_id,
            file: Some(file),
        }
    }

    /// Record that the person granted `permission` to `caller` for the session.
    pub fn grant(&mut self, caller: &str, permission: Permission) -> Grant {
        self.grant_for(caller, permission, GrantDuration::Session)
    }

    /// Record a grant for `duration`. An `always` grant is written to the grant file.
    pub fn grant_for(
        &mut self,
        caller: &str,
        permission: Permission,
        duration: GrantDuration,
    ) -> Grant {
        self.next_id += 1;
        let grant = Grant {
            grant_id: format!("g{}", self.next_id),
            permission,
            duration,
            granted_at: rfc3339_now(),
            expires_at: None,
        };
        self.grants.push((caller.to_owned(), grant.clone()));
        if duration == GrantDuration::Always {
            self.save();
        }
        grant
    }

    /// Remove one of `caller`'s grants. Returns whether a grant was removed.
    pub fn revoke(&mut self, caller: &str, grant_id: &str) -> bool {
        self.holder(grant_id) == Some(caller) && self.revoke_any(grant_id).is_some()
    }

    /// Remove a grant, whoever holds it. Returns its holder.
    pub fn revoke_any(&mut self, grant_id: &str) -> Option<String> {
        let index = self
            .grants
            .iter()
            .position(|(_, g)| g.grant_id == grant_id)?;
        let (holder, grant) = self.grants.remove(index);
        if grant.duration == GrantDuration::Always {
            self.save();
        }
        Some(holder)
    }

    /// `caller`'s grants, oldest first.
    pub fn grants(&self, caller: &str) -> Vec<Grant> {
        self.grants
            .iter()
            .filter(|(owner, _)| owner == caller)
            .map(|(_, grant)| grant.clone())
            .collect()
    }

    /// Every caller's grants, oldest first.
    pub fn list(&self) -> Vec<CallerGrant> {
        self.grants
            .iter()
            .map(|(caller, grant)| CallerGrant {
                caller: caller.clone(),
                grant: grant.clone(),
            })
            .collect()
    }

    /// The callers holding a grant that covers `scope`, each once, in grant order.
    pub fn holders(&self, scope: &Permission) -> Vec<String> {
        let mut holders: Vec<String> = Vec::new();
        for (caller, grant) in &self.grants {
            if covers(&grant.permission, scope) && !holders.contains(caller) {
                holders.push(caller.clone());
            }
        }
        holders
    }

    /// Allow a call when its scope covers the target and one of the caller's grants covers the scope.
    /// Returns the id of the grant that allows it: a lasting grant (`always`, `session`) before a
    /// `once` one. Nothing is spent; see `allow`.
    pub fn authorize(
        &self,
        caller: &str,
        scope: &Permission,
        target: &Target<'_>,
    ) -> Result<String, Denied> {
        self.find(caller, scope, target)
            .map(|index| self.grants[index].1.grant_id.clone())
    }

    /// Allow one call, as `authorize` does. A `once` grant that allows it is spent: it is removed
    /// and returned.
    pub(crate) fn allow(
        &mut self,
        caller: &str,
        scope: &Permission,
        target: &Target<'_>,
    ) -> Result<Option<Grant>, Denied> {
        let index = self.find(caller, scope, target)?;
        if self.grants[index].1.duration == GrantDuration::Once {
            return Ok(Some(self.grants.remove(index).1));
        }
        Ok(None)
    }

    fn find(&self, caller: &str, scope: &Permission, target: &Target<'_>) -> Result<usize, Denied> {
        let denied = |reason: String| Denied {
            permission: scope.clone(),
            reason,
        };
        if !scope_allows(scope, target) {
            return Err(denied(format!("the scope does not cover {target:?}")));
        }
        let covering = |once: bool| {
            self.grants.iter().position(|(owner, grant)| {
                owner == caller
                    && (grant.duration == GrantDuration::Once) == once
                    && covers(&grant.permission, scope)
            })
        };
        covering(false)
            .or_else(|| covering(true))
            .ok_or_else(|| denied("no grant covers the scope".to_owned()))
    }

    fn holder(&self, grant_id: &str) -> Option<&str> {
        self.grants
            .iter()
            .find(|(_, grant)| grant.grant_id == grant_id)
            .map(|(caller, _)| caller.as_str())
    }

    fn save(&self) {
        if let Some(file) = &self.file {
            grants::save(file, self.next_id, &self.grants);
        }
    }
}

/// Whether `grant` covers everything `scope` asks for.
pub fn covers(grant: &Permission, scope: &Permission) -> bool {
    let all_paths = |granted: &[String], asked: &[String]| {
        asked
            .iter()
            .all(|a| granted.iter().any(|g| pattern_covers(g, a)))
    };
    match (grant, scope) {
        (Permission::FsRead(g), Permission::FsRead(s)) => all_paths(&g.paths, &s.paths),
        (Permission::FsWrite(g), Permission::FsWrite(s)) => all_paths(&g.paths, &s.paths),
        (Permission::ProcSpawn(g), Permission::ProcSpawn(s)) => {
            s.commands.iter().all(|c| g.commands.contains(c))
                && (s.pty != Some(true) || g.pty == Some(true))
        }
        (Permission::NetFetch(g), Permission::NetFetch(s)) => s
            .hosts
            .iter()
            .all(|a| g.hosts.iter().any(|h| host_covers(h, a))),
        (Permission::NetConnect(g), Permission::NetConnect(s)) => s
            .hosts
            .iter()
            .all(|a| g.hosts.iter().any(|h| endpoint_covers(h, a))),
        // web:browse without hosts covers every site (ADR 0216).
        (Permission::WebBrowse(g), Permission::WebBrowse(s)) => {
            narrows(g.hosts.as_deref(), s.hosts.as_deref(), |g, a| host_covers(g, a))
        }
        (Permission::AudioCapture(g), Permission::AudioCapture(s)) => {
            s.wake_word != Some(true) || g.wake_word == Some(true)
        }
        (Permission::UiSurface(_), Permission::UiSurface(_)) => true,
        (Permission::UiNotify(_), Permission::UiNotify(_)) => true,
        (Permission::PluginManage(_), Permission::PluginManage(_)) => true,
        (Permission::SearchRead(_), Permission::SearchRead(_)) => true,
        (Permission::SearchSystem(_), Permission::SearchSystem(_)) => true,
        (Permission::BrainConverse(_), Permission::BrainConverse(_)) => true,
        (Permission::BrainAsk(_), Permission::BrainAsk(_)) => true,
        (Permission::CmdInvoke(g), Permission::CmdInvoke(s)) => {
            s.ids.iter().all(|a| g.ids.iter().any(|p| star_match(p, a)))
        }
        (Permission::EventsSubscribe(g), Permission::EventsSubscribe(s)) => {
            s.names.iter().all(|name| g.names.contains(name))
        }
        (Permission::PermManage(_), Permission::PermManage(_)) => true,
        (Permission::DataRead(g), Permission::DataRead(s)) => {
            narrows(g.kinds.as_deref(), s.kinds.as_deref(), |g, a| g == a)
                && narrows(g.sources.as_deref(), s.sources.as_deref(), |p, a| {
                    star_match(p, a)
                })
        }
        (Permission::ConnectorManage(_), Permission::ConnectorManage(_)) => true,
        (Permission::ViewManage(_), Permission::ViewManage(_)) => true,
        (Permission::SettingsRead(g), Permission::SettingsRead(s)) => s
            .keys
            .iter()
            .all(|a| g.keys.iter().any(|p| setting_match(p, a))),
        (Permission::LogRead(_), Permission::LogRead(_)) => true,
        (Permission::UpdateManage(_), Permission::UpdateManage(_)) => true,
        (Permission::ThemeManage(_), Permission::ThemeManage(_)) => true,
        (Permission::AccountManage(_), Permission::AccountManage(_)) => true,
        (Permission::AgentsManage(_), Permission::AgentsManage(_)) => true,
        (Permission::MemoryRead(_), Permission::MemoryRead(_)) => true,
        (Permission::MemoryWrite(_), Permission::MemoryWrite(_)) => true,
        (Permission::StudioManage(_), Permission::StudioManage(_)) => true,
        (Permission::ComputerSee(g), Permission::ComputerSee(s)) => apps_cover(&g.apps, &s.apps),
        (Permission::ComputerControl(g), Permission::ComputerControl(s)) => {
            apps_cover(&g.apps, &s.apps)
        }
        // shell:open: an absent list covers nothing, and only an absent scope list is covered by it.
        (Permission::ShellOpen(g), Permission::ShellOpen(s)) => {
            s.schemes
                .iter()
                .flatten()
                .all(|a| g.schemes.iter().flatten().any(|h| h == a))
                && all_paths(
                    g.paths.as_deref().unwrap_or_default(),
                    s.paths.as_deref().unwrap_or_default(),
                )
        }
        _ => false,
    }
}

/// Whether a granted list covers an asked one, where an absent list means all: every asked entry is
/// matched by a granted one, and only an absent grant covers an absent scope.
fn narrows<T>(
    granted: Option<&[T]>,
    asked: Option<&[T]>,
    matches: impl Fn(&T, &T) -> bool,
) -> bool {
    match (granted, asked) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(granted), Some(asked)) => asked.iter().all(|a| granted.iter().any(|g| matches(g, a))),
    }
}

/// Whether `scope` covers `target`, whatever the grants.
pub(crate) fn scope_allows(scope: &Permission, target: &Target<'_>) -> bool {
    match (scope, target) {
        (Permission::FsRead(s), Target::Path(path)) => path_in(&s.paths, path),
        (Permission::FsWrite(s), Target::Path(path)) => path_in(&s.paths, path),
        (Permission::ProcSpawn(s), Target::Command(command)) => {
            s.commands.iter().any(|c| c == command)
        }
        (Permission::NetFetch(s), Target::Host(host)) => {
            s.hosts.iter().any(|h| host_match(h, host))
        }
        (Permission::NetFetch(s), Target::Url(url)) => desk_sys::net::host_allowed(&s.hosts, url),
        (Permission::NetConnect(s), Target::Endpoint { host, port }) => {
            s.hosts.iter().any(|h| endpoint_match(h, host, *port))
        }
        // web.open and web.load: the address's host; a view with no address yet has no target.
        (Permission::WebBrowse(s), Target::Url(url)) => (s.hosts.as_ref())
            .is_none_or(|hosts| desk_sys::net::host_allowed(hosts, url)),
        (Permission::WebBrowse(_), Target::None) => true,
        (Permission::CmdInvoke(s), Target::CommandId(id)) => {
            s.ids.iter().any(|p| star_match(p, id))
        }
        // cmd.list: the scope only narrows what is listed.
        (Permission::CmdInvoke(_), Target::None) => true,
        (Permission::EventsSubscribe(s), Target::Events(names)) => {
            names.iter().all(|name| s.names.contains(name))
        }
        (
            Permission::AudioCapture(_)
            | Permission::UiSurface(_)
            | Permission::UiNotify(_)
            | Permission::PluginManage(_)
            | Permission::SearchRead(_)
            | Permission::SearchSystem(_)
            | Permission::BrainConverse(_)
            | Permission::BrainAsk(_)
            | Permission::PermManage(_)
            | Permission::ConnectorManage(_)
            | Permission::ViewManage(_)
            | Permission::LogRead(_)
            | Permission::UpdateManage(_)
            | Permission::ThemeManage(_)
            | Permission::AccountManage(_)
            | Permission::AgentsManage(_)
            | Permission::MemoryRead(_)
            | Permission::MemoryWrite(_)
            | Permission::StudioManage(_)
            | Permission::ComputerSee(_)
            | Permission::ComputerControl(_),
            Target::None,
        ) => true,
        (Permission::ComputerSee(s), Target::App(app)) => app_in(&s.apps, *app),
        (Permission::ComputerControl(s), Target::App(app)) => app_in(&s.apps, *app),
        (Permission::SettingsRead(s), Target::Setting(setting)) => {
            s.keys.iter().any(|p| setting_match(p, setting))
        }
        // settings.list: the scope only narrows what is listed.
        (Permission::SettingsRead(_), Target::None) => true,
        // data.*: the scope narrows which items the call sees.
        (Permission::DataRead(_), Target::None) => true,
        (Permission::ShellOpen(s), Target::Scheme(scheme)) => {
            s.schemes.iter().flatten().any(|allowed| allowed == scheme)
        }
        (Permission::ShellOpen(s), Target::Path(path)) => {
            s.paths.as_ref().is_some_and(|paths| path_in(paths, path))
        }
        _ => false,
    }
}

/// computer:*: an absent list covers every app, so only it covers an absent scope list.
fn apps_cover(granted: &Option<Vec<String>>, asked: &Option<Vec<String>>) -> bool {
    narrows(granted.as_deref(), asked.as_deref(), |g, a| g == a)
}

/// Whether a computer scope's apps hold `app`; one without a list holds every app and none.
fn app_in(apps: &Option<Vec<String>>, app: Option<&str>) -> bool {
    apps.as_ref()
        .is_none_or(|apps| app.is_some_and(|app| apps.iter().any(|a| a == app)))
}

fn path_in(patterns: &[String], path: &str) -> bool {
    normalize(path).is_some_and(|path| patterns.iter().any(|p| glob_match(p, &path)))
}
