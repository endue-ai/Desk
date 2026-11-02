//! The history side of `Core` (ADR 0076): every fs.write over a file whose bytes differ keeps the old
//! bytes first (`write_keeping`), fs.history lists what was kept under `fs:read`, and fs.restore
//! writes a version back through the same write under `fs:write`, so what it replaces is kept too.
//! The bounds are desk.files' `history-max-bytes` and `history-max-versions`, read on every write.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

use desk_bridge::{
    BridgeError, ErrorCode, FsHistoryParams, FsHistoryResult, FsRestoreParams, FsRestoreResult,
    LogLevel, Permission,
};
use desk_sys::fs as sysfs;

use crate::handler::{Answer, Core, error, io_error, json};
use crate::history::{History, Kept, Limits, real_path};

/// The settings' owner and their defaults: 256 MiB in all, 50 versions per path.
const OWNER: &str = "desk.files";
const MAX_BYTES: u64 = 256 * 1024 * 1024;
const MAX_VERSIONS: u64 = 50;

impl Core {
    /// Keep the history in `dir` (`history` in the app's data folder, next to `store.json`) and
    /// start with what it holds. An index that cannot be read is set aside as `<name>.broken` with
    /// one warning on the `core` log channel; nothing here stops the core. Without it no write keeps
    /// a version.
    pub fn with_history_dir(self, dir: PathBuf) -> Self {
        let (history, warnings) = History::open(dir);
        *self.history() = Some(history);
        for warning in warnings {
            self.log(LogLevel::Warn, warning, None);
        }
        self
    }

    /// Write `bytes` over `path` as fs.write does, keeping the bytes it replaces first. Answers the
    /// bytes written and the kept version's id.
    pub(crate) fn write_keeping(
        &self,
        caller: &str,
        path: &Path,
        bytes: &[u8],
        create_dirs: bool,
    ) -> Result<(u64, Option<String>), BridgeError> {
        let limits = self.history_limits();
        let now = self.clock.now();
        let real = real_path(path);
        let mut warning = None;
        let result = {
            let mut guard = self.history();
            let kept = match guard.as_mut() {
                None => Ok(Kept::Nothing),
                Some(history) => history.keep(&real, path, bytes, caller, now, limits),
            };
            let version = match kept {
                Ok(Kept::Version(id)) => Some(id),
                Ok(Kept::Nothing) => None,
                Ok(Kept::TooLarge(size)) => {
                    warning = Some(format!(
                        "fs history: {} is {size} bytes, more than {OWNER}.history-max-bytes; written without a version",
                        path.display()
                    ));
                    None
                }
                Err(why) => {
                    warning = Some(format!(
                        "fs history: could not keep the bytes of {} before a write: {why}",
                        path.display()
                    ));
                    None
                }
            };
            match sysfs::write(path, bytes, create_dirs) {
                Ok(written) => Ok((written, version)),
                Err(why) => {
                    if let (Some(history), Some(id)) = (guard.as_mut(), &version) {
                        history.take_back(&real, id);
                    }
                    Err(io_error(why))
                }
            }
        };
        if let Some(warning) = warning {
            self.log(LogLevel::Warn, warning, None);
        }
        result
    }

    pub(crate) fn fs_history(&self, caller: &str, params: FsHistoryParams) -> Answer {
        let path = self.authorize(caller, &Permission::FsRead(params.scope), &params.path)?;
        let mut versions = self
            .history()
            .as_ref()
            .map(|history| history.versions(&real_path(&path)))
            .unwrap_or_default();
        if let Some(limit) = params.limit {
            versions.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
        }
        json(FsHistoryResult { versions })
    }

    pub(crate) fn fs_restore(&self, caller: &str, params: FsRestoreParams) -> Answer {
        let path = self.authorize(caller, &Permission::FsWrite(params.scope), &params.path)?;
        let (bytes_written, version) = self.restore_version(caller, &path, &params.version)?;
        json(FsRestoreResult {
            bytes_written,
            version,
        })
    }

    /// Write version `id` of `path` back as `caller`, as fs.restore does once authorized.
    pub(crate) fn restore_version(
        &self,
        caller: &str,
        path: &Path,
        id: &str,
    ) -> Result<(u64, Option<String>), BridgeError> {
        let bytes = self
            .history()
            .as_ref()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "this desk keeps no history"))
            .and_then(|history| history.read(&real_path(path), id))
            .map_err(|why| match why.kind() {
                io::ErrorKind::NotFound => error(
                    ErrorCode::NotFound,
                    format!("{} has no version {id}", path.display()),
                ),
                _ => io_error(why),
            })?;
        self.write_keeping(caller, path, &bytes, false)
    }

    /// The bounds in force: desk.files' settings, or their defaults when unset or not a count.
    fn history_limits(&self) -> Limits {
        let count = |key: &str, default: u64| {
            self.setting_in_force(OWNER, key)
                .and_then(|value| value.as_u64())
                .unwrap_or(default)
        };
        Limits {
            max_bytes: count("history-max-bytes", MAX_BYTES),
            max_versions: usize::try_from(count("history-max-versions", MAX_VERSIONS))
                .unwrap_or(usize::MAX),
        }
    }

    fn history(&self) -> MutexGuard<'_, Option<History>> {
        self.history
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
