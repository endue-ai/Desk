//! The prompt policy (CORE-03): what the core decides around a prompt. A request that one of the
//! caller's lasting grants covers is answered with that grant; a refusal the person made is
//! remembered for the session, per caller and permission (scope included), and answers the same
//! request at once (`refused-earlier`) until the caller is granted a permission that covers it; and a
//! caller's third folder under one parent offers the parent folder with the prompt. Everything is
//! keyed by the caller id alone, so a plugin, the runtime and an agent are treated alike. Identical
//! waiting prompts are shared in `core_prompts`.

use std::collections::{BTreeMap, BTreeSet};

use desk_bridge::{Grant, GrantDuration, Permission};

use crate::handler::Core;
use crate::paths::normalize;
use crate::perm::covers;

/// How many folders under one parent a caller asks for before the parent is offered.
const FOLDERS_BEFORE_PARENT: usize = 3;

/// What the policy remembers for the session. `Core` keeps it with the prompts, under their lock.
#[derive(Default)]
pub(crate) struct Policy {
    /// The refusals the person made: who was refused which permission.
    refused: Vec<(String, Permission)>,
    /// The folders each caller was prompted for, by caller, permission name and parent folder.
    folders: BTreeMap<(String, &'static str, String), BTreeSet<String>>,
}

impl Policy {
    /// Whether the person refused `caller` exactly this permission earlier in the session.
    pub(crate) fn refused_earlier(&self, caller: &str, permission: &Permission) -> bool {
        self.refused
            .iter()
            .any(|(who, what)| who == caller && what == permission)
    }

    /// The person refused `caller` this permission.
    pub(crate) fn refuse(&mut self, caller: &str, permission: &Permission) {
        if !self.refused_earlier(caller, permission) {
            self.refused.push((caller.to_owned(), permission.clone()));
        }
    }

    /// `caller` was granted `granted`: the refusals it covers end.
    pub(crate) fn granted(&mut self, caller: &str, granted: &Permission) {
        self.refused
            .retain(|(who, what)| who != caller || !covers(granted, what));
    }

    /// Note a prompt for `permission` and return the parent folder to offer with it: on the third
    /// distinct folder under one parent, the same permission over `<parent>/**`, unless `offerable`
    /// says no to the parent or the person refused it to this caller.
    pub(crate) fn parent_offer(
        &mut self,
        caller: &str,
        permission: &Permission,
        offerable: impl Fn(&str) -> bool,
    ) -> Option<Permission> {
        let (name, path) = match permission {
            Permission::FsRead(p) if p.paths.len() == 1 => ("fs:read", &p.paths[0]),
            Permission::FsWrite(p) if p.paths.len() == 1 => ("fs:write", &p.paths[0]),
            _ => return None,
        };
        let (parent, folder) = folder_of(path)?;
        let key = (caller.to_owned(), name, parent.clone());
        let asked = self.folders.entry(key).or_default();
        asked.insert(folder);
        if asked.len() < FOLDERS_BEFORE_PARENT || !offerable(&parent) {
            return None;
        }
        let mut offer = permission.clone();
        let paths = vec![format!("{parent}/**")];
        match &mut offer {
            Permission::FsRead(p) => p.paths = paths,
            Permission::FsWrite(p) => p.paths = paths,
            _ => return None,
        }
        (!self.refused_earlier(caller, &offer)).then_some(offer)
    }
}

/// `<parent>/<name>/**` as its parent and its folder, when the folder has no wildcard and the parent
/// is below a root: `~/Pictures/2026/**` is `~/Pictures/2026` under `~/Pictures`; `~/Pictures/**`
/// (under `~`) and `/tmp/**` (under `/`) have no parent to offer.
fn folder_of(pattern: &str) -> Option<(String, String)> {
    let normalized = normalize(pattern)?;
    let folder = normalized.strip_suffix("/**")?;
    if folder.contains(['*', '?']) {
        return None;
    }
    let (parent, _) = folder.rsplit_once('/')?;
    parent
        .contains('/')
        .then(|| (parent.to_owned(), folder.to_owned()))
}

impl Core {
    /// One of `caller`'s lasting grants (`session` or `always`) that covers `permission`.
    pub(crate) fn lasting_grant(&self, caller: &str, permission: &Permission) -> Option<Grant> {
        self.permissions()
            .grants(caller)
            .into_iter()
            .find(|g| g.duration != GrantDuration::Once && covers(&g.permission, permission))
    }

    /// Whether `parent` may be offered: never the home folder or a folder holding it.
    pub(crate) fn offerable(&self, parent: &str) -> bool {
        self.resolve(parent)
            .is_ok_and(|parent| !self.home().starts_with(parent))
    }
}
