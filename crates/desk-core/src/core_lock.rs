//! plugins.lock on the core's side (ADR 0079): with `with_lock_file`, the core rewrites the lock after
//! every install, removal, version change and turn on or off (every `plugin.changed`), only when its
//! text changes, atomically. A whole folder of installs writes once. Folder digests are kept by
//! plugin revision, so only installs and reloads hash a folder.

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

use desk_bridge::{LockedPlugin, PluginChange, PluginStatus, PluginsLock};

use crate::handler::Core;
use crate::lock::{LOCK_VERSION, folder_sha256, folder_source, render};

/// What the core keeps for plugins.lock.
#[derive(Default)]
pub(crate) struct LockState {
    path: Option<PathBuf>,
    /// Open holds (a folder being installed); the lock is written when the last one ends.
    holds: u32,
    /// Folder digests by plugin id: (revision, sha256).
    digests: BTreeMap<String, (u64, String)>,
    /// The text last written or read, to write only changes.
    last: Option<String>,
    writes: u64,
}

/// Holds the lock's writes until it drops, then writes once.
pub(crate) struct LockHold<'a>(&'a Core);

impl Drop for LockHold<'_> {
    fn drop(&mut self) {
        let last = {
            let mut state = self.0.lock_state();
            state.holds = state.holds.saturating_sub(1);
            state.holds == 0
        };
        if last {
            self.0.write_lock();
        }
    }
}

impl Core {
    /// Keep the plugin set in `path` (`~/.desk/plugins.lock` in the app). Nothing is written until a
    /// plugin is installed, removed or turned on or off.
    pub fn with_lock_file(self, path: PathBuf) -> Self {
        self.lock_state().path = Some(path);
        self
    }

    /// How many times the lock was written: tests check that a folder writes it once.
    #[doc(hidden)]
    pub fn lock_writes(&self) -> u64 {
        self.lock_state().writes
    }

    /// Remove an installed plugin: it unloads, leaves the registry and plugin.list, its views go, and
    /// `plugin.changed` says `removed`. Its folder stays on disk. Returns whether it was installed.
    pub fn remove_plugin(&self, id: &str) -> bool {
        let Some(mut info) = self.registry().get(id) else {
            return false;
        };
        self.remove_pack_plugins(&info);
        self.unloaded(id);
        if let Some(host) = self.connector_host() {
            host.remove(id);
        }
        self.registry().remove(id);
        self.lock_state().digests.remove(id);
        info.enabled = false;
        self.plugin_views_changed(&info);
        self.plugin_changed(id, PluginChange::Removed, info.revision);
        true
    }

    /// Hold the lock's writes until the returned guard drops.
    pub(crate) fn hold_lock(&self) -> LockHold<'_> {
        self.lock_state().holds += 1;
        LockHold(self)
    }

    /// Write the lock as the registry stands, when there is a lock file, no hold, and new text.
    pub(crate) fn write_lock(&self) {
        let path = {
            let state = self.lock_state();
            match (&state.path, state.holds) {
                (Some(path), 0) => path.clone(),
                _ => return,
            }
        };
        let plugins = self.plugins();
        let mut locked = Vec::new();
        for info in plugins.iter().filter(|p| p.status == PluginStatus::Ready) {
            let (Some(manifest), Some(folder)) = (&info.manifest, &info.folder) else {
                continue;
            };
            let Some(sha256) = self.digest(&info.id, info.revision, Path::new(folder)) else {
                continue;
            };
            let source = if let Some(source) = self.market_source(&info.id) {
                source
            } else if info.built_in {
                "builtin".to_owned()
            } else {
                folder_source(Path::new(folder), self.home())
            };
            let enabled = self
                .registry()
                .kept_enabled(&info.id)
                .unwrap_or(info.enabled);
            locked.push(LockedPlugin {
                id: info.id.clone(),
                version: manifest.version.clone(),
                source,
                sha256,
                enabled,
            });
        }
        let text = render(&PluginsLock {
            version: LOCK_VERSION,
            plugins: locked,
        });
        let mut state = self.lock_state();
        if state.last.is_none() {
            state.last = fs::read_to_string(&path).ok();
        }
        if state.last.as_deref() == Some(text.as_str()) {
            return;
        }
        // A refused write leaves the old lock; the next change tries again.
        if write_atomic(&path, &text).is_ok() {
            state.last = Some(text);
            state.writes += 1;
        }
    }

    /// The folder's digest at this revision, hashing it only when the revision is new.
    fn digest(&self, id: &str, revision: u64, folder: &Path) -> Option<String> {
        if let Some((at, sha)) = self.lock_state().digests.get(id)
            && *at == revision
        {
            return Some(sha.clone());
        }
        let sha = folder_sha256(folder).ok()?;
        let entry = (revision, sha.clone());
        self.lock_state().digests.insert(id.to_owned(), entry);
        Some(sha)
    }

    pub(crate) fn lock_state(&self) -> MutexGuard<'_, LockState> {
        self.plugins_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Write `text` to a temp file beside `path`, then rename it over `path`.
fn write_atomic(path: &Path, text: &str) -> io::Result<()> {
    let parent = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = parent.join(format!(".{name}.{}.tmp", std::process::id()));
    let written = fs::File::create(&temp).and_then(|mut file| {
        file.write_all(text.as_bytes())?;
        file.sync_all()
    });
    let renamed = written.and_then(|()| fs::rename(&temp, path));
    if renamed.is_err() {
        let _ = fs::remove_file(&temp);
    }
    renamed
}
