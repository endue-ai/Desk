//! init.yaml sync through endue, with `MockRemote` standing in for endue: two cores sharing one mock
//! are two desks of one person.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_core::{Core, Keep, MockRemote, Roots, SyncError, SyncOutcome, SyncRemote};

static COUNTER: AtomicU64 = AtomicU64::new(0);

const ON: &str = "sync:\n  enabled: true\n";

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "desk-sync-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// One desk: its own init.yaml and sync state in `dir`, endue's copy in `remote`.
struct Desk {
    dir: PathBuf,
    core: Core,
}

impl Desk {
    fn open(dir: &Path, remote: &MockRemote) -> Self {
        let core = Core::new(Roots {
            home: std::env::temp_dir(),
        })
        .with_init_file(dir.join("init.yaml"))
        .with_sync(Arc::new(remote.clone()), Some(dir.join("sync.json")));
        Self {
            dir: dir.to_path_buf(),
            core,
        }
    }

    /// A new desk whose init.yaml is `text`.
    fn new(tag: &str, remote: &MockRemote, text: &str) -> Self {
        let dir = temp_dir(tag);
        fs::write(dir.join("init.yaml"), text).unwrap();
        Self::open(&dir, remote)
    }

    fn edit(&self, text: &str) {
        fs::write(self.dir.join("init.yaml"), text).unwrap();
    }

    fn text(&self) -> String {
        fs::read_to_string(self.dir.join("init.yaml")).unwrap()
    }

    fn sync(&self) -> Result<SyncOutcome, SyncError> {
        self.core.sync_init()
    }
}

fn copy(remote: &MockRemote) -> String {
    remote.copy().expect("endue holds a copy").text
}

#[test]
fn sync_stays_off_until_init_yaml_turns_it_on() {
    let remote = MockRemote::new();
    let desk = Desk::new("off", &remote, "mode: focus\n");
    assert_eq!(desk.sync(), Err(SyncError::Off));
    assert_eq!(remote.copy(), None);

    let no_remote = Core::new(Roots {
        home: std::env::temp_dir(),
    });
    assert_eq!(no_remote.sync_init(), Err(SyncError::Off));

    desk.edit(&format!("mode: focus\n{ON}"));
    assert_eq!(desk.sync(), Ok(SyncOutcome::Pushed { revision: 1 }));
}

#[test]
fn a_new_desk_takes_the_setup_another_desk_pushed() {
    let remote = MockRemote::new();
    let first = Desk::new("first", &remote, &format!("mode: focus\n{ON}"));
    assert_eq!(first.sync(), Ok(SyncOutcome::Pushed { revision: 1 }));
    assert_eq!(copy(&remote), first.text());

    let second = Desk::new("second", &remote, ON);
    assert_eq!(second.sync(), Ok(SyncOutcome::Pulled { revision: 1 }));
    assert_eq!(second.text(), first.text());
    assert_eq!(
        second.core.init().mode,
        "focus",
        "the pulled setup is in force"
    );

    assert_eq!(first.sync(), Ok(SyncOutcome::UpToDate { revision: 1 }));
    assert_eq!(second.sync(), Ok(SyncOutcome::UpToDate { revision: 1 }));
}

#[test]
fn an_edit_on_one_desk_reaches_the_other() {
    let remote = MockRemote::new();
    let first = Desk::new("edit-a", &remote, &format!("mode: focus\n{ON}"));
    first.sync().unwrap();
    let second = Desk::new("edit-b", &remote, ON);
    second.sync().unwrap();

    first.edit(&format!("mode: write\n{ON}"));
    assert_eq!(first.sync(), Ok(SyncOutcome::Pushed { revision: 2 }));
    assert_eq!(second.sync(), Ok(SyncOutcome::Pulled { revision: 2 }));
    assert_eq!(second.core.init().mode, "write");
}

#[test]
fn edits_on_both_desks_conflict_and_neither_is_lost() {
    let remote = MockRemote::new();
    let first = Desk::new("both-a", &remote, &format!("mode: focus\n{ON}"));
    first.sync().unwrap();
    let second = Desk::new("both-b", &remote, ON);
    second.sync().unwrap();

    let theirs = format!("mode: write\n{ON}");
    let mine = format!("mode: read\n{ON}");
    first.edit(&theirs);
    first.sync().unwrap();
    second.edit(&mine);
    assert_eq!(second.sync(), Ok(SyncOutcome::Conflict { revision: 2 }));
    assert_eq!(second.text(), mine, "init.yaml is untouched");
    assert_eq!(copy(&remote), theirs, "endue's copy is untouched");
    let saved = second.core.init_remote_copy().unwrap();
    assert_eq!(fs::read_to_string(&saved).unwrap(), theirs);
    assert_eq!(second.sync(), Ok(SyncOutcome::Conflict { revision: 2 }));

    assert_eq!(
        second.core.resolve_init(Keep::Local),
        Ok(SyncOutcome::Pushed { revision: 3 })
    );
    assert_eq!(copy(&remote), mine);
    assert!(!saved.exists(), "the remote copy goes once settled");
    assert_eq!(first.sync(), Ok(SyncOutcome::Pulled { revision: 3 }));
}

#[test]
fn a_conflict_can_keep_endues_copy() {
    let remote = MockRemote::new();
    let first = Desk::new("keep-a", &remote, &format!("mode: focus\n{ON}"));
    first.sync().unwrap();
    let second = Desk::new("keep-b", &remote, &format!("mode: read\n{ON}"));
    assert_eq!(second.sync(), Ok(SyncOutcome::Conflict { revision: 1 }));
    assert_eq!(
        second.core.resolve_init(Keep::Remote),
        Ok(SyncOutcome::Pulled { revision: 1 })
    );
    assert_eq!(second.text(), first.text());
    assert_eq!(second.core.init().mode, "focus");
}

#[test]
fn offline_changes_nothing_and_the_next_sync_catches_up() {
    let remote = MockRemote::new();
    let desk = Desk::new("offline", &remote, &format!("mode: focus\n{ON}"));
    desk.sync().unwrap();
    remote.set_offline(true);
    desk.edit(&format!("mode: write\n{ON}"));
    assert!(matches!(desk.sync(), Err(SyncError::Unreachable(_))));
    assert_eq!(copy(&remote), format!("mode: focus\n{ON}"));

    remote.set_offline(false);
    assert_eq!(desk.sync(), Ok(SyncOutcome::Pushed { revision: 2 }));
}

#[test]
fn a_broken_file_is_not_pushed_and_a_broken_copy_is_not_pulled() {
    let remote = MockRemote::new();
    let desk = Desk::new("broken", &remote, &format!("mode: focus\n{ON}"));
    desk.sync().unwrap();

    desk.edit(&format!("mode: [\n{ON}"));
    assert!(matches!(desk.sync(), Err(SyncError::InvalidLocal(_))));
    assert_eq!(remote.copy().unwrap().revision, 1);

    desk.edit(&format!("mode: focus\n{ON}"));
    remote.push(Some(1), "plugins: 3\n").unwrap();
    assert!(matches!(desk.sync(), Err(SyncError::InvalidRemote(_))));
    assert_eq!(desk.text(), format!("mode: focus\n{ON}"));
}

#[test]
fn the_last_agreed_version_survives_a_restart() {
    let remote = MockRemote::new();
    let first = Desk::new("restart-a", &remote, &format!("mode: focus\n{ON}"));
    first.sync().unwrap();
    let second = Desk::new("restart-b", &remote, ON);
    second.sync().unwrap();
    second.edit(&format!("mode: write\n{ON}"));
    second.sync().unwrap();

    let restarted = Desk::open(&first.dir, &remote);
    assert_eq!(restarted.sync(), Ok(SyncOutcome::Pulled { revision: 2 }));
}
