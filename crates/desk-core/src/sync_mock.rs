//! `MockRemote`: a stand-in for endue's sync until endue serves it. It keeps endue's copy of
//! init.yaml in memory, or in a JSON file so the copy survives restarts. Clones share one copy, so
//! two cores holding clones act as two desks of one person.

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::sync::{RemoteFailure, Snapshot, SyncRemote, lock};

#[derive(Debug, Clone, Default)]
pub struct MockRemote {
    state: Arc<Mutex<State>>,
}

#[derive(Debug, Default)]
struct State {
    file: Option<PathBuf>,
    copy: Option<Snapshot>,
    offline: bool,
}

impl MockRemote {
    /// A copy in memory only.
    pub fn new() -> Self {
        Self::default()
    }

    /// A copy kept in `file`, loaded now and written on every push.
    pub fn with_file(file: PathBuf) -> Self {
        let copy = fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok());
        Self {
            state: Arc::new(Mutex::new(State {
                file: Some(file),
                copy,
                offline: false,
            })),
        }
    }

    /// While offline, every call fails as `Unreachable`.
    pub fn set_offline(&self, offline: bool) {
        lock(&self.state).offline = offline;
    }

    /// The copy it holds.
    pub fn copy(&self) -> Option<Snapshot> {
        lock(&self.state).copy.clone()
    }
}

impl SyncRemote for MockRemote {
    fn pull(&self) -> Result<Option<Snapshot>, RemoteFailure> {
        let state = lock(&self.state);
        reachable(&state)?;
        Ok(state.copy.clone())
    }

    fn push(&self, base: Option<u64>, text: &str) -> Result<Snapshot, RemoteFailure> {
        let mut state = lock(&self.state);
        reachable(&state)?;
        let revision = match &state.copy {
            Some(copy) if Some(copy.revision) != base => {
                return Err(RemoteFailure::Stale(copy.clone()));
            }
            Some(copy) => copy.revision + 1,
            None => 1,
        };
        let pushed = Snapshot {
            revision,
            text: text.to_owned(),
        };
        if let Some(file) = &state.file {
            if let Some(parent) = file.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let json = serde_json::to_string_pretty(&pushed)
                .map_err(|e| RemoteFailure::Refused(e.to_string()))?;
            fs::write(file, json).map_err(|e| RemoteFailure::Refused(e.to_string()))?;
        }
        state.copy = Some(pushed.clone());
        Ok(pushed)
    }
}

fn reachable(state: &State) -> Result<(), RemoteFailure> {
    if state.offline {
        return Err(RemoteFailure::Unreachable(
            "the mock endue is offline".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_push_only_from_its_current_revision() {
        let remote = MockRemote::new();
        assert_eq!(remote.pull(), Ok(None));
        assert_eq!(remote.push(Some(7), "a").map(|s| s.revision), Ok(1));
        assert_eq!(remote.push(Some(1), "b").map(|s| s.revision), Ok(2));
        let stale = remote.push(Some(1), "c");
        assert!(matches!(
            stale,
            Err(RemoteFailure::Stale(Snapshot { revision: 2, .. }))
        ));
        remote.set_offline(true);
        assert!(matches!(remote.pull(), Err(RemoteFailure::Unreachable(_))));
    }

    #[test]
    fn keeps_its_copy_in_a_file() {
        let file = std::env::temp_dir()
            .join(format!("desk-sync-mock-{}", std::process::id()))
            .join("remote.json");
        MockRemote::with_file(file.clone())
            .push(None, "profile: a\n")
            .unwrap();
        let again = MockRemote::with_file(file.clone());
        assert_eq!(
            again.copy().map(|s| s.text).as_deref(),
            Some("profile: a\n")
        );
        let _ = fs::remove_dir_all(file.parent().unwrap());
    }
}
