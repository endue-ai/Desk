//! The permission engine: everything is denied unless a grant covers the call's scope and the scope
//! covers the call's target.

use desk_bridge::{Grant, Permission};

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
}

/// A denied call: the scope that was missing and why.
#[derive(Debug, Clone, PartialEq)]
pub struct Denied {
    pub permission: Permission,
    pub reason: String,
}

/// Grants per caller. Not thread-safe on its own; `Core` wraps it in a mutex.
#[derive(Debug, Default)]
pub struct PermissionEngine {
    grants: Vec<(String, Grant)>,
    next_id: u64,
}

impl PermissionEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that the person granted `permission` to `caller`.
    pub fn grant(&mut self, caller: &str, permission: Permission) -> Grant {
        self.next_id += 1;
        let grant = Grant {
            grant_id: format!("g{}", self.next_id),
            permission,
            granted_at: rfc3339_now(),
            expires_at: None,
        };
        self.grants.push((caller.to_owned(), grant.clone()));
        grant
    }

    /// Remove one of `caller`'s grants. Returns whether a grant was removed.
    pub fn revoke(&mut self, caller: &str, grant_id: &str) -> bool {
        let before = self.grants.len();
        self.grants
            .retain(|(owner, grant)| !(owner == caller && grant.grant_id == grant_id));
        self.grants.len() != before
    }

    /// `caller`'s grants, oldest first.
    pub fn grants(&self, caller: &str) -> Vec<Grant> {
        self.grants
            .iter()
            .filter(|(owner, _)| owner == caller)
            .map(|(_, grant)| grant.clone())
            .collect()
    }

    /// Allow a call when its scope covers the target and one of the caller's grants covers the scope.
    /// Returns the id of the grant that allowed it.
    pub fn authorize(
        &self,
        caller: &str,
        scope: &Permission,
        target: &Target<'_>,
    ) -> Result<String, Denied> {
        let denied = |reason: String| Denied {
            permission: scope.clone(),
            reason,
        };
        if !scope_allows(scope, target) {
            return Err(denied(format!("the scope does not cover {target:?}")));
        }
        self.grants
            .iter()
            .find(|(owner, grant)| owner == caller && covers(&grant.permission, scope))
            .map(|(_, grant)| grant.grant_id.clone())
            .ok_or_else(|| denied("no grant covers the scope".to_owned()))
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
        _ => false,
    }
}

fn scope_allows(scope: &Permission, target: &Target<'_>) -> bool {
    match (scope, target) {
        (Permission::FsRead(s), Target::Path(path)) => path_in(&s.paths, path),
        (Permission::FsWrite(s), Target::Path(path)) => path_in(&s.paths, path),
        (Permission::ProcSpawn(s), Target::Command(command)) => {
            s.commands.iter().any(|c| c == command)
        }
        (Permission::NetFetch(s), Target::Host(host)) => {
            s.hosts.iter().any(|h| host_match(h, host))
        }
        (
            Permission::AudioCapture(_)
            | Permission::UiSurface(_)
            | Permission::UiNotify(_)
            | Permission::PluginManage(_),
            Target::None,
        ) => true,
        _ => false,
    }
}

fn path_in(patterns: &[String], path: &str) -> bool {
    normalize(path).is_some_and(|path| patterns.iter().any(|p| glob_match(p, &path)))
}
