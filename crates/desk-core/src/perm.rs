//! The permission engine: everything is denied unless a grant covers the call's scope and the scope
//! covers the call's target. `always` grants are kept in the grant file when there is one (ADR 0029);
//! a `once` grant is spent by the first call it allows.

use std::path::PathBuf;

use desk_bridge::{CallerGrant, EventName, Grant, GrantDuration, Permission};

use crate::grants;
use crate::paths::{glob_match, host_covers, host_match, normalize, pattern_covers};
use crate::time::rfc3339_now;

/// What a call touches, checked against its scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target<'a> {
    /// The permission has no target of its own (audio, ui).
    None,
    Path(&'a str),
    Command(&'a str),
    Host(&'a str),
    /// A command id in the command registry (cmd.invoke).
    CommandId(&'a str),
    /// Event names (events.subscribe).
    Events(&'a [EventName]),
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
        (Permission::AudioCapture(g), Permission::AudioCapture(s)) => {
            s.wake_word != Some(true) || g.wake_word == Some(true)
        }
        (Permission::UiSurface(_), Permission::UiSurface(_)) => true,
        (Permission::UiNotify(_), Permission::UiNotify(_)) => true,
        (Permission::PluginManage(_), Permission::PluginManage(_)) => true,
        (Permission::BrainConverse(_), Permission::BrainConverse(_)) => true,
        (Permission::CmdInvoke(g), Permission::CmdInvoke(s)) => {
            s.ids.iter().all(|a| g.ids.iter().any(|p| star_match(p, a)))
        }
        (Permission::EventsSubscribe(g), Permission::EventsSubscribe(s)) => {
            s.names.iter().all(|name| g.names.contains(name))
        }
        (Permission::PermManage(_), Permission::PermManage(_)) => true,
        _ => false,
    }
}

/// `*` in `pattern` matches any run of characters, dots included; everything else is literal. A `*`
/// in `text` is literal too, so a grant of `desk.*` covers a scope of `desk.theme.*`.
pub fn star_match(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    let (first, last) = (parts[0], parts[parts.len() - 1]);
    if parts.len() == 1 {
        return pattern == text;
    }
    if !text.starts_with(first) || text.len() < first.len() + last.len() || !text.ends_with(last) {
        return false;
    }
    let mut rest = &text[first.len()..text.len() - last.len()];
    for part in &parts[1..parts.len() - 1] {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    true
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
            | Permission::BrainConverse(_)
            | Permission::PermManage(_),
            Target::None,
        ) => true,
        _ => false,
    }
}

fn path_in(patterns: &[String], path: &str) -> bool {
    normalize(path).is_some_and(|path| patterns.iter().any(|p| glob_match(p, &path)))
}
