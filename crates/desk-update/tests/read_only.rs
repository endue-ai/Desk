//! An update into a folder the desk may not write (#99, ADR 0163). On macOS the OS asks once and an
//! administrator's step swaps the checked app in, and installs nothing but the bytes that were
//! checked; a declined prompt keeps the app and the build staged and says so once. A `.deb` asks
//! through `pkexec`; a Windows desk in a folder it may not write runs its installer through UAC and
//! hears of a declined prompt when it starts again; an AppImage says how to update it by hand. No
//! test shows a real prompt: each one is handed a stand-in (`support/prompt.rs`).

mod support;

use std::fs;
use std::path::Path;

use desk_update::install::{Layout, PackageInstaller, Relaunch, install};
use desk_update::{Config, State, Updater};
use support::bundle::{ID, app_tar_gz, chosen, installed, names};
use support::mac::{APP_TARGET, BETA, desk, publish, running};
use support::prompt::{Declines, Never, Records};
use support::{BASE, Key, Origin, dir, shared};

const NEXT: &str = "0.5.0-rc.2";

#[cfg(unix)]
fn mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

/// Make `path` read-only; false (and writable again) when this user writes there anyway (root).
#[cfg(unix)]
fn lock(path: &Path) -> bool {
    mode(path, 0o555);
    if support::prompt::writes_anyway(path) {
        eprintln!("skipped: this user writes to read-only folders (root)");
        mode(path, 0o755);
        return false;
    }
    true
}

/// The reason a cancelled prompt to `what` gives.
fn cancelled(what: &str) -> String {
    format!(
        "the administrator prompt to {what} was cancelled. Nothing changed; the update stays ready"
    )
}

#[cfg(unix)]
#[test]
fn a_declined_prompt_keeps_the_app_and_the_build_staged_and_says_so_once() {
    let (root, key) = (dir("read-only-declined"), Key::new());
    let apps = root.join("Applications");
    let app = installed(&apps, "endue-desk", "0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = app_tar_gz("endue-desk", ID, "0.5.0-rc.2");
    publish(&origin, &key, &key, NEXT, NEXT, &bytes);
    let prompt = shared(Declines::default());
    let desk = desk(&root, &app, &key, origin, prompt.clone());
    let staged = desk.updater.check_now(BETA).release.unwrap();
    if !lock(&apps) {
        return;
    }
    let status = desk.updater.apply_now().unwrap();
    mode(&apps, 0o755);
    assert_eq!(status.state, State::Failed);
    let replace = format!("replace {}", app.display());
    assert_eq!(status.reason.as_deref(), Some(cancelled(&replace).as_str()));
    assert!(status.staged, "the build stays for another try");
    assert_eq!(prompt.asked.lock().unwrap().len(), 1, "the OS asked once");
    assert!(desk.restarts.lock().unwrap().is_empty());
    assert_eq!(running(&app), [("endue-desk".into(), "0.5.0-rc.1".into())]);
    assert_eq!(names(&apps), ["endue Desk.app"]);
    assert_eq!(
        names(&desk.updates.join(NEXT)),
        [staged.file],
        "only the staged build is left"
    );
    // Said once: the next check shows the build ready again, and asks nobody.
    let next = desk.updater.check_now(BETA);
    assert_eq!((next.state, next.reason), (State::Staged, None));
    assert_eq!(prompt.asked.lock().unwrap().len(), 1);
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn an_archive_that_is_not_this_desk_is_refused_before_anyone_is_asked() {
    let root = dir("read-only-refused");
    let apps = root.join("Applications");
    let app = installed(&apps, "endue-desk", "0.5.0");
    let bytes = app_tar_gz("endue-desk", "ai.other.app", "x");
    let scratch = root.join("updates");
    if !lock(&apps) {
        return;
    }
    let refused = install(
        &Layout::App { app: app.clone() },
        &chosen("0.6.0", APP_TARGET, "d.app.tar.gz", &bytes),
        &bytes,
        &scratch,
        &Never,
    );
    mode(&apps, 0o755);
    let why = refused.unwrap_err();
    assert!(why.contains("not this desk (ai.endue.desk)"), "{why}");
    assert_eq!(names(&apps), ["endue Desk.app"]);
    assert!(names(&scratch.join("0.6.0")).is_empty(), "nothing kept");
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn an_appimage_in_a_read_only_folder_says_how_to_update_it_by_hand() {
    let root = dir("read-only-appimage");
    let apps = root.join("Apps");
    fs::create_dir_all(&apps).unwrap();
    let file = apps.join("endue-desk.AppImage");
    fs::write(&file, b"\x7fELF 0.5.0").unwrap();
    let bytes = b"\x7fELF 0.6.0".to_vec();
    let next = chosen("0.6.0", "linux-x86_64-appimage", "d.AppImage", &bytes);
    if !lock(&apps) {
        return;
    }
    let layout = Layout::AppImage { file: file.clone() };
    let refused = install(&layout, &next, &bytes, &root.join("updates"), &Never);
    mode(&apps, 0o755);
    let why = refused.unwrap_err();
    for says in [
        format!("no permission to write to {}", apps.display()),
        format!(
            "To update by hand, download {} and put it in place of {}",
            next.url,
            file.display()
        ),
        "move the AppImage to a folder you can write, such as ~/Applications".to_owned(),
    ] {
        assert!(why.contains(&says), "{why} does not say {says}");
    }
    assert_eq!(fs::read(&file).unwrap(), b"\x7fELF 0.5.0");
    assert_eq!(names(&apps), ["endue-desk.AppImage"]);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_deb_asks_once_through_pkexec_and_says_so_when_declined() {
    let root = dir("read-only-deb");
    let scratch = root.join("updates");
    let exe = Path::new("/usr/lib/endue-desk/endue-desk");
    let layout = Layout::Deb { exe: exe.into() };
    let deb = b"!<arch>\ndebian-binary 2.0\n".to_vec();
    let next = chosen("0.6.0", "linux-x86_64-deb", "d.deb", &deb);
    // Bytes that are not a .deb never reach the prompt.
    let why = install(&layout, &next, b"\x7fELF", &scratch, &Never).unwrap_err();
    assert!(why.contains("is not a .deb"), "{why}");
    let declines = Declines::default();
    let why = install(&layout, &next, &deb, &scratch, &declines).unwrap_err();
    assert_eq!(why, cancelled("install the package"));
    let package = scratch.join("0.6.0/install.deb");
    let asked = declines.asked.lock().unwrap();
    assert_eq!(asked.len(), 1);
    assert_eq!(
        (asked[0].program.as_str(), asked[0].args.clone()),
        ("dpkg", vec!["-i".to_owned(), package.display().to_string()])
    );
    assert!(!package.exists(), "the package goes either way");
    let approves = Records::default();
    let relaunch = install(&layout, &next, &deb, &scratch, &approves).unwrap();
    assert_eq!(relaunch, Relaunch::program(exe.into()));
    assert_eq!(approves.asked.lock().unwrap().len(), 1);
    let _ = fs::remove_dir_all(root);
}

/// The PowerShell script a Windows restart runs, decoded.
fn script(relaunch: &Relaunch) -> String {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&relaunch.args[5])
        .unwrap();
    let units: Vec<u16> = bytes
        .chunks(2)
        .map(|p| u16::from_le_bytes([p[0], p[1]]))
        .collect();
    String::from_utf16(&units).unwrap()
}

#[cfg(unix)]
#[test]
fn a_windows_desk_in_a_folder_it_may_not_write_runs_its_installer_through_uac() {
    let root = dir("read-only-nsis");
    let folder = root.join("Program Files/endue Desk");
    fs::create_dir_all(&folder).unwrap();
    let layout = Layout::Nsis {
        exe: folder.join("endue-desk.exe"),
    };
    let setup = b"MZ setup".to_vec();
    let next = chosen("0.6.0", "windows-x86_64-nsis", "s-setup.exe", &setup);
    let run = |scratch: &Path| script(&install(&layout, &next, &setup, scratch, &Never).unwrap());
    assert!(
        !run(&root.join("u1")).contains("-Verb RunAs"),
        "a folder it writes"
    );
    if !lock(&folder) {
        return;
    }
    let elevated = run(&root.join("u2"));
    mode(&folder, 0o755);
    assert!(
        elevated.contains("-Verb RunAs -Wait -PassThru -ErrorAction Stop"),
        "{elevated}"
    );
    let note = root.join("u2/0.6.0/install.outcome");
    assert!(elevated.contains(&note.display().to_string()), "{elevated}");
    assert!(names(&folder).is_empty(), "the folder's probe went");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_declined_uac_is_told_once_when_the_desk_starts_again() {
    let (root, key) = (dir("read-only-uac"), Key::new());
    let updates = root.join("updates");
    let origin = shared(Origin::default());
    let listed = origin.release(&key, "0.6.0", &["windows-x86_64-nsis"], "0.0.0");
    origin.index(&key, "beta", 1, vec![listed]);
    let exe = root.join("endue Desk/endue-desk.exe");
    let start = || {
        let layout = Layout::Nsis { exe: exe.clone() };
        let installer =
            PackageInstaller::new(layout, &updates, shared(Never), Box::new(|_| Ok(())));
        let config = Config {
            base: BASE.to_owned(),
            pubkey: key.public(),
            version: "0.5.0".to_owned(),
            commit: None,
            targets: vec!["windows-x86_64-nsis".to_owned()],
            dir: updates.clone(),
        };
        Updater::new(config, origin.clone(), shared(installer), BETA).unwrap()
    };
    assert_eq!(start().check_now(BETA).state, State::Staged);
    // The desk quit for the installer, UAC was declined, and the script left its note.
    let note = updates.join("0.6.0/install.outcome");
    fs::write(&note, "\u{feff}declined\r\n").unwrap();
    let again = start();
    let status = again.status();
    assert_eq!(status.state, State::Failed);
    assert_eq!(
        status.reason.as_deref(),
        Some(cancelled("run the installer").as_str())
    );
    assert!(status.staged);
    // Once: the desk after that finds the build ready, and so does the next check.
    assert_eq!(start().status().state, State::Staged);
    let next = again.check_now(BETA);
    assert_eq!((next.state, next.reason), (State::Staged, None));
    fs::write(&note, "failed 1603").unwrap();
    assert_eq!(
        start().status().reason.as_deref(),
        Some("the installer exited 1603; the update stays ready")
    );
    let _ = fs::remove_dir_all(root);
}
