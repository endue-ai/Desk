//! fs.stat, fs.mkdir, fs.rename, fs.copy and fs.trash (ADR 0125) over desk-sys's primitives. Each is
//! checked against the caller's fs scopes, a rename's and a copy's at both ends before anything
//! changes; rename, copy and mkdir push what undoes them (`undo.rs`). A name already taken is
//! `already_exists`, never an overwrite; the home folder and the roots are never moved or trashed.

use std::io;
use std::path::PathBuf;

use desk_bridge::{
    BridgeError, BridgeRequest, EntryKind, ErrorCode, FsCopyParams, FsCopyResult, FsMkdirParams,
    FsMkdirResult, FsRenameParams, FsRenameResult, FsStatParams, FsStatResult, FsTrashParams,
    FsTrashResult, Permission, RequestId,
};
use desk_plugin_host::rfc3339;
use desk_sys::fs as sysfs;

use super::moves::sys;
use crate::handler::{Answer, Core, denied, error, json};
use crate::paths::normalize;
use crate::perm::{Denied, Target, scope_allows};

impl Core {
    /// The five methods, which `handle` routes here as one.
    pub(crate) fn fs_op(&self, caller: &str, request: BridgeRequest) -> (RequestId, Answer) {
        use BridgeRequest as R;
        match request {
            R::FsStat(r) => (r.id, self.fs_stat(caller, r.params)),
            R::FsMkdir(r) => (r.id, self.fs_mkdir(caller, r.params)),
            R::FsRename(r) => (r.id, self.fs_rename(caller, r.params)),
            R::FsCopy(r) => (r.id, self.fs_copy(caller, r.params)),
            R::FsTrash(r) => (r.id, self.fs_trash(caller, r.params)),
            _ => unreachable!("handle routes only fs.stat, mkdir, rename, copy and trash here"),
        }
    }

    fn fs_stat(&self, caller: &str, params: FsStatParams) -> Answer {
        let path = self.authorize(caller, &Permission::FsRead(params.scope), &params.path)?;
        let stat = sysfs::stat(&path).map_err(sys)?;
        json(FsStatResult {
            kind: match stat.kind {
                sysfs::EntryKind::File => EntryKind::File,
                sysfs::EntryKind::Dir => EntryKind::Dir,
                sysfs::EntryKind::Symlink => EntryKind::Symlink,
            },
            size: stat.size,
            modified_at: stat.modified.map(rfc3339),
            read_only: stat.readonly,
        })
    }

    fn fs_mkdir(&self, caller: &str, params: FsMkdirParams) -> Answer {
        let scope = Permission::FsWrite(params.scope);
        let parents = params.parents.unwrap_or(false);
        let bridge = not_a_root(&params.path)?;
        let path = self.authorize(caller, &scope, &params.path)?;
        if parents {
            // The folders it creates above the path must be inside the scope too. The grant was
            // checked above, once: a second check would find a once grant already spent.
            self.parents_in_scope(&scope, &bridge)?;
        }
        let made = sysfs::mkdir(&path, parents).map_err(sys)?;
        let created = created_paths(&bridge, made.len());
        self.push_mkdir(caller, &params.path, parents, &created);
        json(FsMkdirResult { created })
    }

    fn fs_rename(&self, caller: &str, params: FsRenameParams) -> Answer {
        not_a_root(&params.from)?;
        let scope = Permission::FsWrite(params.scope);
        let from_scope = params.from_scope.map(Permission::FsWrite);
        let source = (from_scope.as_ref().unwrap_or(&scope), params.from.as_str());
        let (from, to) = self.authorize_ends(caller, source, (&scope, &params.to))?;
        let crossed_devices = self.move_path(&from, &to)?;
        self.push_rename(caller, &params.from, &params.to, crossed_devices);
        json(FsRenameResult { crossed_devices })
    }

    fn fs_copy(&self, caller: &str, params: FsCopyParams) -> Answer {
        let scope = Permission::FsWrite(params.scope);
        let from_scope = Permission::FsRead(params.from_scope);
        let source = (&from_scope, params.from.as_str());
        let (from, to) = self.authorize_ends(caller, source, (&scope, &params.to))?;
        let bytes_copied = sysfs::copy(&from, &to).map_err(sys)?;
        self.push_copy(caller, &params.from, &params.to, bytes_copied);
        json(FsCopyResult { bytes_copied })
    }

    fn fs_trash(&self, caller: &str, params: FsTrashParams) -> Answer {
        not_a_root(&params.path)?;
        let path = self.authorize(caller, &Permission::FsWrite(params.scope), &params.path)?;
        self.trash_path(&path)?;
        json(FsTrashResult {})
    }

    /// Check both ends of a rename or a copy. Each scope must cover its path before any grant is
    /// checked, so a refusal at one end spends no once grant at the other; one scope for both ends
    /// is checked against the grants once.
    fn authorize_ends(
        &self,
        caller: &str,
        (from_scope, from): (&Permission, &str),
        (to_scope, to): (&Permission, &str),
    ) -> Result<(PathBuf, PathBuf), BridgeError> {
        for (scope, path) in [(from_scope, from), (to_scope, to)] {
            covers(scope, path)?;
        }
        let from = self.authorize(caller, from_scope, from)?;
        let to = if to_scope == from_scope {
            self.resolve(to)?
        } else {
            self.authorize(caller, to_scope, to)?
        };
        Ok((from, to))
    }

    /// Refuse when a folder above `bridge` (a normalized path) that is missing, and so would be
    /// created, is outside `scope`.
    fn parents_in_scope(&self, scope: &Permission, bridge: &str) -> Result<(), BridgeError> {
        let above = prefixes(bridge);
        for parent in above.iter().rev().skip(1) {
            match std::fs::symlink_metadata(self.resolve(parent)?) {
                Ok(_) => break,
                Err(err) if err.kind() == io::ErrorKind::NotFound => covers(scope, parent)?,
                Err(err) => return Err(sys(err)),
            }
        }
        Ok(())
    }
}

/// `permission_denied` unless `scope` covers `path`.
fn covers(scope: &Permission, path: &str) -> Result<(), BridgeError> {
    let target = Target::Path(path);
    if scope_allows(scope, &target) {
        return Ok(());
    }
    Err(denied(Denied {
        reason: format!("the scope does not cover {target:?}"),
        permission: scope.clone(),
    }))
}

/// `path` normalized, unless it is a root (`/`, a drive, `~`, `${...}`), which is never created,
/// moved or trashed.
pub(super) fn not_a_root(path: &str) -> Result<String, BridgeError> {
    let normalized = normalize(path).ok_or_else(|| {
        error(
            ErrorCode::InvalidParams,
            format!("not a rooted path: {path}"),
        )
    })?;
    if is_root(&normalized) {
        let why = format!("{path} is a root or the home folder; it is never moved or trashed");
        return Err(error(ErrorCode::InvalidParams, why));
    }
    Ok(normalized)
}

fn is_root(path: &str) -> bool {
    matches!(path, "" | "/" | "~")
        || (path.starts_with("${") && !path.contains('/'))
        || (path.len() == 2 && path.ends_with(':'))
}

/// Every folder from the root down to `bridge` (a normalized path, not a root), outermost first,
/// `bridge` last: `~/a/b` is `~/a`, `~/a/b`.
fn prefixes(bridge: &str) -> Vec<&str> {
    let mut out: Vec<&str> = bridge
        .match_indices('/')
        .map(|(at, _)| &bridge[..at])
        .filter(|prefix| !is_root(prefix))
        .collect();
    out.push(bridge);
    out
}

/// The bridge paths of the `count` folders fs.mkdir created for `bridge`: the innermost of its
/// prefixes, outermost first.
pub(super) fn created_paths(bridge: &str, count: usize) -> Vec<String> {
    let all = prefixes(bridge);
    let skip = all.len().saturating_sub(count);
    all[skip..].iter().map(|p| (*p).to_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_stop_at_the_root() {
        assert_eq!(prefixes("~/a/b"), ["~/a", "~/a/b"]);
        assert_eq!(prefixes("/srv/x"), ["/srv", "/srv/x"]);
        assert_eq!(prefixes("C:/Users/me"), ["C:/Users", "C:/Users/me"]);
        assert_eq!(created_paths("~/a/b/c", 2), ["~/a/b", "~/a/b/c"]);
    }

    #[test]
    fn roots_are_never_moved() {
        for root in ["/", "~", "${home}", "~/", "C:/", "~/a/.."] {
            assert!(not_a_root(root).is_err(), "{root}");
        }
        assert_eq!(not_a_root("${home}/a/./b").unwrap(), "~/a/b");
    }
}
