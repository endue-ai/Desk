//! The fs side of `Core` beyond reading: fs.write, and fs.watch with its `fs.changed` events. A
//! watch reports paths in the caller's own terms (under the path it asked for) and ends when the
//! caller's grants no longer cover it (after a revoke, or the call that spent a once grant).

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::MutexGuard;

use base64::Engine as _;
use desk_bridge::{
    BridgeEvent, Encoding, ErrorCode, FsChange, FsChangedData, FsChangedEvent, FsWatchParams,
    FsWatchResult, FsWriteParams, FsWriteResult, Permission,
};
use desk_sys::fs as sysfs;

use crate::handler::{Answer, Core, denied, error, io_error, json};
use crate::paths::normalize;
use crate::perm::{Denied, Target, scope_allows};

struct WatchEntry {
    caller: String,
    scope: Permission,
    path: String,
    _watch: sysfs::Watch,
}

/// The watches callers started, by id.
#[derive(Default)]
pub(crate) struct Watches {
    next: u64,
    entries: BTreeMap<String, WatchEntry>,
}

impl Core {
    pub(crate) fn fs_write(&self, caller: &str, params: FsWriteParams) -> Answer {
        let scope = Permission::FsWrite(params.scope);
        let path = self.authorize(caller, &scope, &params.path)?;
        let create_dirs = params.create_dirs.unwrap_or(false);
        if create_dirs && let Some((parent, _)) = params.path.rsplit_once('/') {
            // Folders it creates must be inside the scope too. The grant was checked above, once:
            // a second check would find a once grant already spent.
            let target = Target::Path(parent);
            if !parent.is_empty()
                && !parent.ends_with(':')
                && parent != "~"
                && !scope_allows(&scope, &target)
            {
                return Err(denied(Denied {
                    reason: format!("the scope does not cover {target:?}"),
                    permission: scope,
                }));
            }
        }
        let bytes = match params.encoding.unwrap_or(Encoding::Utf8) {
            Encoding::Utf8 => params.content.into_bytes(),
            Encoding::Base64 => base64::engine::general_purpose::STANDARD
                .decode(params.content)
                .map_err(|e| error(ErrorCode::InvalidParams, format!("not base64: {e}")))?,
        };
        let bytes_written = sysfs::write(&path, &bytes, create_dirs).map_err(io_error)?;
        json(FsWriteResult { bytes_written })
    }

    pub(crate) fn fs_watch(&self, caller: &str, params: FsWatchParams) -> Answer {
        let scope = Permission::FsRead(params.scope);
        let resolved = self.authorize(caller, &scope, &params.path)?;
        let base = normalize(&params.path).unwrap_or(params.path.clone());
        let mut watches = self.watches();
        watches.next += 1;
        let watch_id = format!("w-{}", watches.next);
        let events = self.events().clone();
        let (id, root) = (watch_id.clone(), resolved.clone());
        let watch = sysfs::watch_changes(
            &resolved,
            params.recursive.unwrap_or(false),
            move |changed, change| {
                let Some(path) = bridge_path(&root, &base, &changed) else {
                    return;
                };
                events.publish(BridgeEvent::FsChanged(FsChangedEvent {
                    event: Default::default(),
                    data: FsChangedData {
                        watch_id: id.clone(),
                        path,
                        change: match change {
                            sysfs::Change::Created => FsChange::Created,
                            sysfs::Change::Modified => FsChange::Modified,
                            sysfs::Change::Removed => FsChange::Removed,
                        },
                    },
                }));
            },
        )
        .map_err(io_error)?;
        watches.entries.insert(
            watch_id.clone(),
            WatchEntry {
                caller: caller.to_owned(),
                scope,
                path: params.path,
                _watch: watch,
            },
        );
        drop(watches);
        // One started under a once grant ends with the call that spent it.
        self.prune_watches(caller);
        json(FsWatchResult { watch_id })
    }

    /// Stop the caller's watches that its grants no longer cover.
    pub(crate) fn prune_watches(&self, caller: &str) {
        let keep: Vec<String> = {
            let watches = self.watches();
            let permissions = self.permissions();
            watches
                .entries
                .iter()
                .filter(|(_, w)| {
                    w.caller != caller
                        || permissions
                            .authorize(caller, &w.scope, &Target::Path(&w.path))
                            .is_ok()
                })
                .map(|(id, _)| id.clone())
                .collect()
        };
        self.watches().entries.retain(|id, _| keep.contains(id));
    }

    /// How many watches are running, for tests and diagnostics.
    pub fn watch_count(&self) -> usize {
        self.watches().entries.len()
    }

    fn watches(&self) -> MutexGuard<'_, Watches> {
        self.watches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// `changed` under `root` as a bridge path under `base` (the path the caller watched).
fn bridge_path(root: &Path, base: &str, changed: &Path) -> Option<String> {
    // Watchers may report canonical paths (/private/var on macOS) for a root given without them.
    let relative = changed
        .strip_prefix(root)
        .ok()
        .map(Path::to_path_buf)
        .or_else(|| {
            let canonical = root.canonicalize().ok()?;
            changed.strip_prefix(&canonical).ok().map(Path::to_path_buf)
        })?;
    let rest: Vec<String> = relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    let base = base.trim_end_matches('/');
    Some(if rest.is_empty() {
        base.to_owned()
    } else {
        format!("{base}/{}", rest.join("/"))
    })
}
