//! The init side of `Core`: init.yaml read at start, the plugin setup it asks for, and its sync
//! through endue.

use std::path::PathBuf;
use std::sync::{Arc, MutexGuard};

use desk_bridge::InitGetResult;

use crate::handler::{Answer, Core, json};
use crate::init::{Init, InitFile};
use crate::sync::{Keep, SyncError, SyncOutcome, SyncRemote, Syncer, lock};

impl Core {
    /// Read the setup from `path` (init.yaml), writing the template there when there is none. Call it
    /// before installing plugins: the plugins it disables start disabled.
    pub fn with_init_file(self, path: PathBuf) -> Self {
        *self.init_file() = InitFile::open(path);
        self
    }

    /// Sync init.yaml through `remote` (endue, or `MockRemote` until endue serves sync). The last
    /// version both sides agreed on is kept in `state_file`, or in memory.
    pub fn with_sync(mut self, remote: Arc<dyn SyncRemote>, state_file: Option<PathBuf>) -> Self {
        self.sync = Some(Syncer::new(remote, state_file));
        self
    }

    /// The setup in force.
    pub fn init(&self) -> Init {
        self.init_file().init().clone()
    }

    /// Why init.yaml is not in force (it does not parse, or cannot be read). The last setup that
    /// parsed stays in force; at start, the defaults.
    pub fn init_problem(&self) -> Option<String> {
        self.init_file().problem().map(str::to_owned)
    }

    /// Read init.yaml again, then push it to endue, pull endue's copy, or report a conflict. A pulled
    /// copy is in force at once; the plugins it disables start disabled from the next start.
    pub fn sync_init(&self) -> Result<SyncOutcome, SyncError> {
        let syncer = self.syncer()?;
        syncer.sync(&self.init)
    }

    /// Settle a conflict: push init.yaml over endue's copy, or take endue's copy.
    pub fn resolve_init(&self, keep: Keep) -> Result<SyncOutcome, SyncError> {
        let syncer = self.syncer()?;
        syncer.resolve(&self.init, keep)
    }

    /// The remote copy of init.yaml, saved next to it after a conflict.
    pub fn init_remote_copy(&self) -> Option<PathBuf> {
        self.init_file().remote_copy_path()
    }

    /// init.get: the profile to start in and the caller's own settings (keys under `<caller>.`).
    pub(crate) fn init_get(&self, caller: &str) -> Answer {
        let file = self.init_file();
        let init = file.init();
        let prefix = format!("{caller}.");
        let settings = init
            .settings
            .iter()
            .filter(|(key, _)| key.starts_with(&prefix))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        json(InitGetResult {
            profile: init.profile.clone(),
            settings,
            problem: file.problem().map(str::to_owned),
        })
    }

    pub(crate) fn init_disables(&self, plugin: &str) -> bool {
        self.init_file()
            .init()
            .plugins
            .disabled
            .iter()
            .any(|id| id == plugin)
    }

    /// The syncer, once init.yaml (read again now) turns sync on.
    fn syncer(&self) -> Result<&Syncer, SyncError> {
        let syncer = self.sync.as_ref().ok_or(SyncError::Off)?;
        let mut file = self.init_file();
        file.reload();
        if file.init().sync.enabled {
            Ok(syncer)
        } else {
            Err(SyncError::Off)
        }
    }

    fn init_file(&self) -> MutexGuard<'_, InitFile> {
        lock(&self.init)
    }
}
