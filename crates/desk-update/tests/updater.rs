//! The updater over a fake origin and installer: it stages the next build by itself, waits when
//! told to, drops what the channel took down, refuses stale or forged indexes, and applies only
//! bytes it checked again.

mod support;

use std::fs;
use std::sync::{Arc, Mutex};

use desk_update::{Channel, Prefs, State, Status, Updater};
use support::*;

const CANARY: Prefs = Prefs {
    channel: Channel::Canary,
    auto: true,
    check: true,
};

struct Desk {
    origin: Arc<Origin>,
    installer: Arc<Recorder>,
    updater: Updater,
    seen: Arc<Mutex<Vec<Status>>>,
    dir: std::path::PathBuf,
}

/// A desk at 0.1.0 whose canary channel lists 0.2.0 for Linux, signed by `key`.
fn desk(tag: &str, key: &Key) -> Desk {
    let origin = shared(Origin::default());
    let listed = origin.release(key, "0.2.0", &[LINUX, MAC], "0.1.0");
    origin.index(key, "canary", 1, vec![listed]);
    restart(key, origin, &dir(tag))
}

fn restart(key: &Key, origin: Arc<Origin>, dir: &std::path::Path) -> Desk {
    let installer = shared(Recorder::default());
    let updater = Updater::new(
        config(dir, key, "0.1.0"),
        origin.clone(),
        installer.clone(),
        CANARY,
    )
    .unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    updater.listen(move |status| log.lock().unwrap().push(status.clone()));
    Desk {
        origin,
        installer,
        updater,
        seen,
        dir: dir.to_path_buf(),
    }
}

fn states(desk: &Desk) -> Vec<State> {
    let mut states: Vec<State> = desk.seen.lock().unwrap().iter().map(|s| s.state).collect();
    states.dedup();
    states
}

#[test]
fn stages_the_next_build_without_asking() {
    let key = Key::new();
    let desk = desk("stages", &key);
    let status = desk.updater.check_now(CANARY);
    assert_eq!(status.state, State::Staged);
    assert!(status.staged);
    assert!(status.checked_at.is_some());
    let release = status.release.unwrap();
    assert_eq!(
        (release.version.as_str(), release.target.as_str()),
        ("0.2.0", LINUX)
    );
    assert_eq!(
        release.notes.as_deref(),
        Some("https://github.com/endue-ai/Desk/releases/tag/v0.2.0")
    );
    assert_eq!(
        states(&desk),
        [
            State::Checking,
            State::Available,
            State::Downloading,
            State::Staged
        ]
    );
    assert_eq!(*desk.installer.prepared.lock().unwrap(), ["0.2.0"]);
    let file = desk.dir.join("0.2.0").join(&release.file);
    assert_eq!(fs::read(file).unwrap(), artifact("0.2.0", LINUX));
    // The build is still staged after a restart, before any check.
    let again = restart(&key, desk.origin.clone(), &desk.dir);
    assert_eq!(again.updater.status().state, State::Staged);
    assert_eq!(again.updater.status().release.unwrap().version, "0.2.0");
}

#[test]
fn waits_in_available_when_auto_is_off() {
    let key = Key::new();
    let desk = desk("waits", &key);
    let ask = Prefs {
        auto: false,
        ..CANARY
    };
    let status = desk.updater.check_now(ask);
    assert_eq!(status.state, State::Available);
    assert!(!status.staged);
    assert!(
        desk.origin.downloads.lock().unwrap().is_empty(),
        "nothing downloads unasked"
    );
    let status = desk.updater.download_now().unwrap();
    assert_eq!(status.state, State::Staged);
    assert_eq!(desk.origin.downloads.lock().unwrap().len(), 1);
    assert!(
        desk.updater.download_now().is_err(),
        "nothing waits once it is staged"
    );
}

#[test]
fn drops_a_staged_build_the_index_no_longer_lists() {
    let key = Key::new();
    let desk = desk("drops", &key);
    assert_eq!(desk.updater.check_now(CANARY).state, State::Staged);
    desk.origin.index(&key, "canary", 2, vec![]);
    let status = desk.updater.check_now(CANARY);
    assert_eq!(status.state, State::UpToDate);
    assert_eq!(status.release, None);
    assert!(
        !desk.dir.join("0.2.0").exists(),
        "the taken-down build is removed"
    );
    assert!(desk.updater.apply_now().is_err(), "and never applied");
}

#[test]
fn refuses_an_index_older_than_one_seen() {
    let key = Key::new();
    let desk = desk("stale", &key);
    desk.origin.index(&key, "canary", 5, vec![]);
    assert_eq!(desk.updater.check_now(CANARY).state, State::UpToDate);
    let listed = desk.origin.release(&key, "0.3.0", &[LINUX], "0.1.0");
    desk.origin.index(&key, "canary", 4, vec![listed]);
    let status = desk.updater.check_now(CANARY);
    assert_eq!(status.state, State::Failed);
    assert!(
        status
            .reason
            .unwrap()
            .contains("older than one already seen")
    );
    assert!(desk.origin.downloads.lock().unwrap().is_empty());
}

#[test]
fn refuses_an_index_whose_signature_fails() {
    let key = Key::new();
    let desk = desk("forged", &key);
    let forger = Key::new();
    let listed = desk.origin.release(&forger, "0.9.0", &[LINUX], "0.1.0");
    desk.origin.index(&forger, "canary", 9, vec![listed]);
    let status = desk.updater.check_now(CANARY);
    assert_eq!(status.state, State::Failed);
    let reason = status.reason.unwrap();
    assert!(
        reason.contains("channel index") && reason.contains("does not match"),
        "{reason}"
    );
    assert!(desk.origin.downloads.lock().unwrap().is_empty());
}

#[test]
fn apply_checks_the_bytes_again_and_hands_them_to_the_installer() {
    let key = Key::new();
    let desk = desk("apply", &key);
    let release = desk.updater.check_now(CANARY).release.unwrap();
    let status = desk.updater.apply_now().unwrap();
    assert_eq!(status.state, State::Applying);
    let installed = desk.installer.installed.lock().unwrap().clone();
    assert_eq!(installed, [("0.2.0".to_owned(), artifact("0.2.0", LINUX))]);
    // Bytes that changed on disk after staging are never installed.
    let tampered = flipped(&artifact("0.2.0", LINUX));
    fs::write(desk.dir.join("0.2.0").join(&release.file), tampered).unwrap();
    let status = desk.updater.apply_now().unwrap();
    assert_eq!(status.state, State::Failed);
    assert!(status.reason.unwrap().contains("sha256"));
    assert_eq!(desk.installer.installed.lock().unwrap().len(), 1);
    assert!(
        desk.updater.apply_now().is_err(),
        "the damaged build was dropped"
    );
}

/// The same length, one byte different.
fn flipped(bytes: &[u8]) -> Vec<u8> {
    let mut copy = bytes.to_vec();
    copy[7] ^= 0x20;
    copy
}

#[test]
fn a_failed_install_keeps_the_build_staged() {
    let key = Key::new();
    let desk = desk("refused", &key);
    desk.updater.check_now(CANARY);
    *desk.installer.refuse.lock().unwrap() = Some("Desk could not replace the app".to_owned());
    let status = desk.updater.apply_now().unwrap();
    assert_eq!(status.state, State::Failed);
    assert!(status.staged);
    assert_eq!(
        status.reason.as_deref(),
        Some("Desk could not replace the app")
    );
    *desk.installer.refuse.lock().unwrap() = None;
    assert_eq!(desk.updater.apply_now().unwrap().state, State::Applying);
    assert_eq!(desk.installer.installed.lock().unwrap().len(), 1);
}

#[test]
fn reports_progress_while_downloading() {
    let key = Key::new();
    let desk = desk("progress", &key);
    desk.updater.check_now(CANARY);
    let size = artifact("0.2.0", LINUX).len() as u64;
    let progress: Vec<(Option<u64>, Option<u64>)> = desk
        .seen
        .lock()
        .unwrap()
        .iter()
        .filter(|s| s.state == State::Downloading)
        .map(|s| (s.received, s.total))
        .collect();
    assert_eq!(progress.first(), Some(&(Some(0), Some(size))));
    assert_eq!(progress.last(), Some(&(Some(size), Some(size))));
    assert_eq!(progress.len(), 11, "the start and one per tenth");
    assert!(progress.windows(2).all(|w| w[0].0 < w[1].0));
}
