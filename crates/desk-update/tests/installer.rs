//! The installer a desk without Tauri supplies (ADR 0147), driven by the updater over a fake origin:
//! an `.app.tar.gz` swapped in for the installed app, and the failure paths that must leave the
//! running desk as it was: a bad signature, a partial download. A folder the desk may not write is
//! `read_only.rs`'s.

mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;

use desk_update::install::Relaunch;
use desk_update::{State, Transport};
use support::bundle::{ID, app_tar_gz, installed, names};
use support::mac::{BETA, Desk, publish, running};
use support::prompt::Never;
use support::{Key, Origin, dir, shared};

/// The desk installed as `app`, in folders it may write: nobody is ever asked for an administrator.
fn desk(root: &Path, app: &Path, key: &Key, transport: Arc<dyn Transport>) -> Desk {
    support::mac::desk(root, app, key, transport, shared(Never))
}

#[test]
fn a_tauri_app_is_swapped_for_the_cef_app_and_restarts_into_it() {
    let (root, key) = (dir("installer-swap"), Key::new());
    let apps = root.join("Applications");
    let app = installed(&apps, "endue-desk", "tauri 0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = app_tar_gz("endue-desk", ID, "cef 0.5.0-rc.2");
    publish(&origin, &key, &key, "0.5.0-rc.2", "0.5.0-rc.2", &bytes);
    let desk = desk(&root, &app, &key, origin);
    assert_eq!(desk.updater.check_now(BETA).state, State::Staged);
    assert_eq!(desk.updater.apply_now().unwrap().state, State::Applying);
    assert_eq!(
        running(&app),
        [("endue-desk".to_owned(), "cef 0.5.0-rc.2".to_owned())],
        "the CEF app took the Tauri app's place"
    );
    let framework = app.join("Contents/Frameworks/Chromium Embedded Framework.framework");
    assert!(framework.join("Resources/icudtl.dat").is_file());
    assert_eq!(
        names(&apps),
        ["endue Desk.app"],
        "nothing left beside the app"
    );
    let restarts = desk.restarts.lock().unwrap();
    assert_eq!(
        *restarts,
        [Relaunch::program(app.join("Contents/MacOS/endue-desk"))]
    );
    let _ = fs::remove_dir_all(root);
}

/// The executable the desk starts again is the one the new app's Info.plist names: a CEF build from
/// before Stage 1 ended ran `endue-desk-cef`, and its update runs `endue-desk` (#97).
#[test]
fn a_renamed_executable_restarts_under_the_new_apps_name() {
    let (root, key) = (dir("installer-rename"), Key::new());
    let apps = root.join("Applications");
    let app = installed(&apps, "endue-desk-cef", "cef 0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = app_tar_gz("endue-desk", ID, "cef 0.5.0-rc.2");
    publish(&origin, &key, &key, "0.5.0-rc.2", "0.5.0-rc.2", &bytes);
    let desk = desk(&root, &app, &key, origin);
    assert_eq!(desk.updater.check_now(BETA).state, State::Staged);
    assert_eq!(desk.updater.apply_now().unwrap().state, State::Applying);
    assert_eq!(
        running(&app),
        [("endue-desk".to_owned(), "cef 0.5.0-rc.2".to_owned())],
        "the old executable went with the old app"
    );
    assert_eq!(
        *desk.restarts.lock().unwrap(),
        [Relaunch::program(app.join("Contents/MacOS/endue-desk"))]
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_bad_signature_never_reaches_the_app() {
    let (root, key) = (dir("installer-signature"), Key::new());
    let app = installed(&root.join("Applications"), "endue-desk", "0.5.0-rc.1");
    let bytes = app_tar_gz("endue-desk", ID, "forged");
    let forger = Key::new();
    // Another key's signature, and the updater key's on an older build passed off as this one.
    for (signer, signed_for, says) in [
        (&forger, "0.5.0-rc.2", "does not match"),
        (&key, "0.5.0-rc.0", "signed for 0.5.0-rc.0"),
    ] {
        let origin = shared(Origin::default());
        publish(&origin, &key, signer, "0.5.0-rc.2", signed_for, &bytes);
        let desk = desk(&root, &app, &key, origin);
        let status = desk.updater.check_now(BETA);
        assert_eq!(status.state, State::Failed);
        assert!(
            status.reason.as_deref().unwrap().contains(says),
            "{status:?}"
        );
        assert!(!status.staged);
        assert!(desk.updater.apply_now().is_err(), "nothing to apply");
        assert!(desk.restarts.lock().unwrap().is_empty());
        assert_eq!(running(&app), [("endue-desk".into(), "0.5.0-rc.1".into())]);
    }
    let _ = fs::remove_dir_all(root);
}

/// An origin whose downloads end halfway.
struct HalfWay(Arc<Origin>);

impl Transport for HalfWay {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        self.0.get(url)
    }

    fn download(
        &self,
        url: &str,
        progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<Vec<u8>, String> {
        let mut bytes = self.0.download(url, progress)?;
        bytes.truncate(bytes.len() / 2);
        Ok(bytes)
    }
}

#[test]
fn a_partial_download_is_never_staged_or_installed() {
    let (root, key) = (dir("installer-partial"), Key::new());
    let app = installed(&root.join("Applications"), "endue-desk", "0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = app_tar_gz("endue-desk", ID, "0.5.0-rc.2");
    publish(&origin, &key, &key, "0.5.0-rc.2", "0.5.0-rc.2", &bytes);
    let desk = desk(&root, &app, &key, shared(HalfWay(origin.clone())));
    let status = desk.updater.check_now(BETA);
    assert_eq!(status.state, State::Failed);
    assert!(!status.staged);
    assert!(desk.updater.apply_now().is_err());
    // A whole download, cut short on disk afterwards (a full disk, a crash), is not staged either.
    let desk = self::desk(&root, &app, &key, origin);
    let staged = desk.updater.check_now(BETA).release.unwrap();
    let file = desk.updates.join("0.5.0-rc.2").join(&staged.file);
    fs::write(&file, &bytes[..bytes.len() / 2]).unwrap();
    assert!(
        desk.updater.apply_now().is_err(),
        "a short file is not staged"
    );
    assert!(desk.restarts.lock().unwrap().is_empty());
    assert_eq!(running(&app), [("endue-desk".into(), "0.5.0-rc.1".into())]);
    let _ = fs::remove_dir_all(root);
}
