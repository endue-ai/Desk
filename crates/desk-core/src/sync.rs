//! Sync for init.yaml: the same setup on every desk a person uses, through endue. Three versions
//! decide what happens: the file here, endue's copy and the base (the last version both agreed on).
//! A side that changed since the base wins over one that did not; when both changed, nothing is
//! overwritten: endue's copy is saved next to init.yaml and `Keep` settles it.
//!
//! endue does not serve sync yet. `MockRemote` stands in for it behind `SyncRemote`, so the path from
//! the core to the server is the one the real client will take.

use std::fmt;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use crate::init::{Init, InitFile};

/// endue's copy of init.yaml.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    /// Goes up with every push endue accepts.
    pub revision: u64,
    pub text: String,
}

/// Why the remote did not do what it was asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteFailure {
    /// endue's copy is no longer the one the push started from; this is the copy it holds now.
    Stale(Snapshot),
    /// No connection. Nothing changed; try again later.
    Unreachable(String),
    /// endue said no, for example because nobody is signed in.
    Refused(String),
}

/// Where init.yaml syncs to: endue, or a stand-in for it.
pub trait SyncRemote: Send + Sync {
    /// endue's copy, or `None` while it holds none.
    fn pull(&self) -> Result<Option<Snapshot>, RemoteFailure>;

    /// Store `text` if endue's copy is still at revision `base` (`None`: no copy yet). A remote that
    /// holds no copy accepts any push.
    fn push(&self, base: Option<u64>, text: &str) -> Result<Snapshot, RemoteFailure>;
}

/// What a sync did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncOutcome {
    /// Both sides already hold the same file.
    UpToDate { revision: u64 },
    /// endue took this desk's init.yaml.
    Pushed { revision: u64 },
    /// init.yaml now holds endue's copy, and its setup is in force.
    Pulled { revision: u64 },
    /// Both sides changed. init.yaml is untouched and endue's copy is in init.remote.yaml.
    Conflict { revision: u64 },
}

/// Why a sync did not happen. Nothing changed on either side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncError {
    /// init.yaml says `sync.enabled: false`, or this desk has no remote.
    Off,
    Unreachable(String),
    Refused(String),
    /// init.yaml does not parse, so it is not pushed.
    InvalidLocal(String),
    /// endue's copy does not parse (or there is none to keep), so it is not pulled.
    InvalidRemote(String),
    /// A file could not be read or written.
    Io(String),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Off => write!(f, "sync is off"),
            Self::Unreachable(why) => write!(f, "endue is unreachable: {why}"),
            Self::Refused(why) => write!(f, "endue refused: {why}"),
            Self::InvalidLocal(why) => write!(f, "init.yaml does not parse: {why}"),
            Self::InvalidRemote(why) => write!(f, "endue's copy does not parse: {why}"),
            Self::Io(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for SyncError {}

/// Which side a conflict keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Keep {
    /// Push init.yaml (merged by hand, or as it is) over endue's copy.
    Local,
    /// Replace init.yaml with endue's copy.
    Remote,
}

/// The last version both sides agreed on.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Base {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
}

/// What a sync does, decided from the base, the file here and endue's copy.
#[derive(Debug, PartialEq)]
enum Step {
    Agree(Snapshot),
    Push(Option<u64>),
    Pull(Snapshot),
    Conflict(Snapshot),
}

fn decide(base: &Base, local: &str, remote: Option<Snapshot>) -> Step {
    let Some(remote) = remote else {
        return Step::Push(None);
    };
    let digest = digest(local);
    if self::digest(&remote.text) == digest {
        return Step::Agree(remote);
    }
    let local_changed = base.digest.as_deref() != Some(digest.as_str());
    let remote_changed = base.revision != Some(remote.revision);
    // A desk that never synced and holds only the defaults takes endue's copy.
    let fresh = base.revision.is_none() && Init::parse(local).is_ok_and(|init| init.is_default());
    match (local_changed, remote_changed) {
        (false, _) => Step::Pull(remote),
        (true, false) => Step::Push(Some(remote.revision)),
        (true, true) if fresh => Step::Pull(remote),
        (true, true) => Step::Conflict(remote),
    }
}

/// A stable digest of the text (FNV-1a, 64 bits): it only tells versions apart.
fn digest(text: &str) -> String {
    let hash = text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}")
}

/// One desk's sync: the remote and the base, kept in a JSON file or in memory.
pub(crate) struct Syncer {
    remote: Arc<dyn SyncRemote>,
    state_file: Option<PathBuf>,
    /// Held for a whole sync, so syncs run one at a time; the init file is locked only briefly.
    base: Mutex<Base>,
}

impl Syncer {
    pub(crate) fn new(remote: Arc<dyn SyncRemote>, state_file: Option<PathBuf>) -> Self {
        let base = state_file
            .as_deref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self {
            remote,
            state_file,
            base: Mutex::new(base),
        }
    }

    pub(crate) fn sync(&self, init: &Mutex<InitFile>) -> Result<SyncOutcome, SyncError> {
        let mut base = lock(&self.base);
        let local = lock(init).read().map_err(io)?;
        let remote = self.remote.pull().map_err(failed)?;
        match decide(&base, &local, remote) {
            Step::Agree(remote) => {
                self.record(&mut base, remote.revision, &local);
                lock(init).drop_remote_copy();
                Ok(SyncOutcome::UpToDate {
                    revision: remote.revision,
                })
            }
            Step::Push(at) => self.push(&mut base, init, at, &local),
            Step::Pull(remote) => self.pull(&mut base, init, &local, remote),
            Step::Conflict(remote) => conflict(init, remote),
        }
    }

    pub(crate) fn resolve(
        &self,
        init: &Mutex<InitFile>,
        keep: Keep,
    ) -> Result<SyncOutcome, SyncError> {
        let mut base = lock(&self.base);
        let local = lock(init).read().map_err(io)?;
        let remote = self.remote.pull().map_err(failed)?;
        match (keep, remote) {
            (Keep::Local, remote) => {
                let at = remote.map(|r| r.revision);
                self.push(&mut base, init, at, &local)
            }
            (Keep::Remote, Some(remote)) => self.pull(&mut base, init, &local, remote),
            (Keep::Remote, None) => Err(SyncError::InvalidRemote(
                "endue holds no copy of init.yaml yet".to_owned(),
            )),
        }
    }

    fn push(
        &self,
        base: &mut Base,
        init: &Mutex<InitFile>,
        at: Option<u64>,
        local: &str,
    ) -> Result<SyncOutcome, SyncError> {
        Init::parse(local).map_err(SyncError::InvalidLocal)?;
        match self.remote.push(at, local) {
            Ok(pushed) => {
                self.record(base, pushed.revision, local);
                lock(init).drop_remote_copy();
                Ok(SyncOutcome::Pushed {
                    revision: pushed.revision,
                })
            }
            Err(RemoteFailure::Stale(current)) => conflict(init, current),
            Err(other) => Err(failed(other)),
        }
    }

    fn pull(
        &self,
        base: &mut Base,
        init: &Mutex<InitFile>,
        local: &str,
        remote: Snapshot,
    ) -> Result<SyncOutcome, SyncError> {
        Init::parse(&remote.text).map_err(SyncError::InvalidRemote)?;
        let mut file = lock(init);
        if !file.replace(local, &remote.text).map_err(io)? {
            // The person saved an edit while endue answered: both sides changed after all.
            drop(file);
            return conflict(init, remote);
        }
        file.drop_remote_copy();
        self.record(base, remote.revision, &remote.text);
        Ok(SyncOutcome::Pulled {
            revision: remote.revision,
        })
    }

    fn record(&self, base: &mut Base, revision: u64, text: &str) {
        let agreed = Base {
            revision: Some(revision),
            digest: Some(digest(text)),
        };
        if *base == agreed {
            return;
        }
        *base = agreed;
        let Some(path) = &self.state_file else { return };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&*base) {
            let _ = fs::write(path, text);
        }
    }
}

fn conflict(init: &Mutex<InitFile>, remote: Snapshot) -> Result<SyncOutcome, SyncError> {
    lock(init).save_remote_copy(&remote.text).map_err(io)?;
    Ok(SyncOutcome::Conflict {
        revision: remote.revision,
    })
}

fn failed(failure: RemoteFailure) -> SyncError {
    match failure {
        RemoteFailure::Unreachable(why) => SyncError::Unreachable(why),
        RemoteFailure::Refused(why) => SyncError::Refused(why),
        RemoteFailure::Stale(current) => {
            SyncError::Refused(format!("endue moved on to revision {}", current.revision))
        }
    }
}

fn io(error: std::io::Error) -> SyncError {
    SyncError::Io(error.to_string())
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(revision: u64, text: &str) -> Option<Snapshot> {
        Some(Snapshot {
            revision,
            text: text.to_owned(),
        })
    }

    fn base(revision: u64, text: &str) -> Base {
        Base {
            revision: Some(revision),
            digest: Some(digest(text)),
        }
    }

    #[test]
    fn the_side_that_changed_wins() {
        let was = "profile: a\n";
        assert_eq!(
            decide(&base(1, was), was, snapshot(1, was)),
            Step::Agree(snapshot(1, was).unwrap())
        );
        assert_eq!(
            decide(&base(1, was), "profile: b\n", snapshot(1, was)),
            Step::Push(Some(1))
        );
        assert_eq!(
            decide(&base(1, was), was, snapshot(2, "profile: c\n")),
            Step::Pull(snapshot(2, "profile: c\n").unwrap())
        );
        assert_eq!(
            decide(&base(1, was), "profile: b\n", snapshot(2, "profile: c\n")),
            Step::Conflict(snapshot(2, "profile: c\n").unwrap())
        );
        assert_eq!(
            decide(&base(1, was), "profile: b\n", snapshot(2, "profile: b\n")),
            Step::Agree(snapshot(2, "profile: b\n").unwrap())
        );
    }

    #[test]
    fn a_first_sync_uploads_or_takes_the_copy_only_over_defaults() {
        let never = Base::default();
        assert_eq!(decide(&never, "profile: a\n", None), Step::Push(None));
        assert_eq!(
            decide(
                &never,
                "sync: { enabled: true }\n",
                snapshot(4, "profile: c\n")
            ),
            Step::Pull(snapshot(4, "profile: c\n").unwrap())
        );
        assert_eq!(
            decide(&never, "profile: a\n", snapshot(4, "profile: c\n")),
            Step::Conflict(snapshot(4, "profile: c\n").unwrap())
        );
    }

    #[test]
    fn digests_are_stable() {
        assert_eq!(digest(""), "cbf29ce484222325");
        assert_eq!(digest("a"), "af63dc4c8601ec8c");
    }
}
