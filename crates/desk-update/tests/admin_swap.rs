//! macOS: the administrator's step that swaps the app in where the desk may not write (#99, ADR
//! 0163), run whole as this user by a stand-in prompt that opens the read-only folders as root
//! would (`support/prompt.rs`): it is asked once, swaps the checked app in for an app in a folder
//! the desk may not write or an app it may not move, leaves nothing beside the app, and installs
//! only the bytes that were checked. A real prompt never shows.
#![cfg(target_os = "macos")]

mod support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use desk_update::install::Relaunch;
use desk_update::verify::sha256_hex;
use desk_update::{State, Status};
use support::bundle::{Entry, ID, app_tar_gz, info_plist, installed, names, tar_gz};
use support::mac::{BETA, Desk, desk, publish, running};
use support::prompt::{Approves, writes_anyway};
use support::{Key, Origin, dir, shared};

const NEXT: &str = "0.5.0-rc.2";

fn mode(path: &Path, mode: u32) {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o7777
}

/// The next build's `.app.tar.gz`, with a file only its owner could read on the build machine.
fn next_build() -> Vec<u8> {
    let app = "endue Desk.app/Contents";
    tar_gz(&[
        Entry(
            &format!("{app}/Info.plist"),
            info_plist("endue-desk", ID).into_bytes(),
            0o644,
        ),
        Entry(
            &format!("{app}/MacOS/endue-desk"),
            b"0.5.0-rc.2".to_vec(),
            0o755,
        ),
        Entry(
            &format!("{app}/Resources/private.dat"),
            b"p".to_vec(),
            0o600,
        ),
    ])
}

/// A desk installed in `<root>/Applications` with 0.5.0-rc.2 staged, its `locked` folder made
/// read-only before it applies through `prompt`; none when this user writes there anyway (root).
fn apply(
    root: &Path,
    locked: impl Fn(&Path) -> std::path::PathBuf,
    prompt: impl FnOnce(&Path) -> Approves,
) -> Option<(Desk, Status, std::sync::Arc<Approves>, Vec<u8>)> {
    let key = Key::new();
    let app = installed(&root.join("Applications"), "endue-desk", "0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = next_build();
    publish(&origin, &key, &key, NEXT, NEXT, &bytes);
    let locked = locked(&app);
    let prompt = shared(prompt(&locked));
    let desk = desk(root, &app, &key, origin, prompt.clone());
    assert_eq!(desk.updater.check_now(BETA).state, State::Staged);
    mode(&locked, 0o555);
    if writes_anyway(&locked) {
        eprintln!("skipped: this user writes to read-only folders (root)");
        mode(&locked, 0o755);
        return None;
    }
    let status = desk.updater.apply_now().unwrap();
    mode(&locked, 0o755);
    Some((desk, status, prompt, bytes))
}

#[test]
fn macos_asks_once_and_an_administrators_step_swaps_the_checked_app_in() {
    let root = dir("admin-swap");
    let apps = root.join("Applications");
    let app = apps.join("endue Desk.app");
    let parent = |app: &Path| app.parent().unwrap().to_path_buf();
    let opening = |locked: &Path| Approves::opening(vec![locked.to_path_buf()]);
    let Some((desk, status, prompt, bytes)) = apply(&root, parent, opening) else {
        return;
    };
    assert_eq!(status.state, State::Applying, "{status:?}");
    let asked = prompt.asked.lock().unwrap();
    assert_eq!(asked.len(), 1, "the OS asked once");
    assert!(asked[0].why.contains(NEXT), "{:?}", asked[0].why);
    let archive = desk.updates.join(NEXT).join("install.app.tar.gz");
    let text = |path: &Path| path.to_string_lossy().into_owned();
    assert_eq!(asked[0].args[0], "-c");
    assert!(
        asked[0].args[1].contains("renamex_np"),
        "the step is admin.sh"
    );
    assert_eq!(
        asked[0].args[2..],
        [
            "desk-update".to_owned(),
            text(&archive),
            sha256_hex(&bytes),
            text(&app),
            "endue Desk.app".to_owned(),
            "endue-desk".to_owned()
        ]
    );
    assert_eq!(running(&app), [("endue-desk".into(), "0.5.0-rc.2".into())]);
    // Whoever runs the app reads all of it; nobody but its owner writes it.
    let contents = app.join("Contents");
    assert_eq!(mode_of(&contents.join("Resources/private.dat")), 0o644);
    assert_eq!(mode_of(&contents.join("MacOS/endue-desk")), 0o755);
    assert_eq!(names(&apps), ["endue Desk.app"], "nothing left beside");
    let staged = status.release.unwrap().file;
    assert_eq!(names(&desk.updates.join(NEXT)), [staged], "no archive left");
    assert_eq!(
        *desk.restarts.lock().unwrap(),
        [Relaunch::program(app.join("Contents/MacOS/endue-desk"))]
    );
    let _ = fs::remove_dir_all(root);
}

/// The folder is the person's, the app another user's: the desk may write beside it but not move it.
#[test]
fn an_app_the_desk_may_not_move_is_swapped_in_by_an_administrator_too() {
    let root = dir("admin-swap-app");
    let app = root.join("Applications/endue Desk.app");
    let itself = |app: &Path| app.to_path_buf();
    let opening = |locked: &Path| Approves::opening(vec![locked.to_path_buf()]);
    let Some((desk, status, prompt, _)) = apply(&root, itself, opening) else {
        return;
    };
    assert_eq!(status.state, State::Applying, "{status:?}");
    assert_eq!(prompt.asked.lock().unwrap().len(), 1);
    assert_eq!(running(&app), [("endue-desk".into(), "0.5.0-rc.2".into())]);
    assert_eq!(names(&root.join("Applications")), ["endue Desk.app"]);
    assert_eq!(desk.restarts.lock().unwrap().len(), 1);
    let _ = fs::remove_dir_all(root);
}

/// Something with the person's rights rewrites the archive between the desk's check and the
/// administrator's step: the step finds another SHA-256 and installs nothing.
#[test]
fn the_administrators_step_installs_only_the_bytes_that_were_checked() {
    let root = dir("admin-swap-tampered");
    let apps = root.join("Applications");
    let app = apps.join("endue Desk.app");
    let parent = |app: &Path| app.parent().unwrap().to_path_buf();
    let forged = app_tar_gz("endue-desk", ID, "forged");
    let tampering = move |locked: &Path| {
        Approves::opening(vec![locked.to_path_buf()])
            .then(move |step| fs::write(&step.args[3], &forged).unwrap())
    };
    let Some((desk, status, prompt, _)) = apply(&root, parent, tampering) else {
        return;
    };
    assert_eq!(status.state, State::Failed);
    let reason = status.reason.unwrap();
    assert!(
        reason.contains("the update changed after Desk checked it"),
        "{reason}"
    );
    assert!(reason.contains(&app.display().to_string()), "{reason}");
    assert!(status.staged, "the build stays for another try");
    assert_eq!(prompt.asked.lock().unwrap().len(), 1);
    assert_eq!(running(&app), [("endue-desk".into(), "0.5.0-rc.1".into())]);
    assert_eq!(names(&apps), ["endue Desk.app"], "the step's folder went");
    assert!(desk.restarts.lock().unwrap().is_empty());
    let _ = fs::remove_dir_all(root);
}
