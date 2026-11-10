//! The installer a desk without Tauri supplies (ADR 0147), driven by the updater over a fake origin:
//! an `.app.tar.gz` swapped in for the installed app, and the failure paths that must leave the
//! running desk as it was: a bad signature, a partial download, no permission to write.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use desk_update::install::{Layout, PackageInstaller, Relaunch};
use desk_update::verify::sha256_hex;
use desk_update::{Channel, Config, Prefs, State, Transport, Updater};
use serde_json::json;
use support::bundle::{ID, app_tar_gz, installed, names};
use support::{BASE, Key, Origin, dir, shared};

const APP_TARGET: &str = "darwin-aarch64-app";
const BETA: Prefs = Prefs {
    channel: Channel::Beta,
    auto: true,
    check: true,
};

/// Publish `version` on beta with `bytes` as its `.app.tar.gz`; the artifact signed by `signer` for
/// `signed_for`, the documents by `key`.
fn publish(
    origin: &Origin,
    key: &Key,
    signer: &Key,
    version: &str,
    signed_for: &str,
    bytes: &[u8],
) {
    let file = format!("endue-desk_{version}_darwin-aarch64.app.tar.gz");
    let url = format!("{BASE}/releases/{version}/{file}");
    origin.put(&url, bytes.to_vec());
    let signature = signer.sign(bytes, Some(signed_for));
    let entry = json!({ "url": url, "signature": signature });
    let manifest = json!({
        "version": version,
        "platforms": { APP_TARGET: entry, "darwin-aarch64": entry },
        "desk": {
            "commit": "c46d12b",
            "artifacts": {
                APP_TARGET: { "sha256": sha256_hex(bytes), "size": bytes.len() },
                "darwin-aarch64": { "sha256": sha256_hex(bytes), "size": bytes.len() }
            }
        }
    });
    let path = format!("releases/{version}/release.json");
    let manifest = serde_json::to_vec(&manifest).unwrap();
    origin.put(
        &format!("{BASE}/{path}.sig"),
        key.sign(&manifest, None).into_bytes(),
    );
    origin.put(&format!("{BASE}/{path}"), manifest);
    let listed = json!({
        "version": version, "commit": "c46d12b", "date": "2026-11-20",
        "targets": [APP_TARGET, "darwin-aarch64"], "release": path
    });
    origin.index(key, "beta", 1, vec![listed]);
}

/// A desk at 0.5.0-rc.1 installed as `app`, with the restarts it asked for.
struct Desk {
    updater: Updater,
    restarts: Arc<Mutex<Vec<Relaunch>>>,
    updates: PathBuf,
}

fn desk(root: &Path, app: &Path, key: &Key, transport: Arc<dyn Transport>) -> Desk {
    let updates = root.join("updates");
    let restarts = Arc::new(Mutex::new(Vec::new()));
    let asked = restarts.clone();
    let installer = PackageInstaller::new(
        Layout::App {
            app: app.to_path_buf(),
        },
        &updates,
        Box::new(move |relaunch| {
            asked.lock().unwrap().push(relaunch);
            Ok(())
        }),
    );
    let config = Config {
        base: BASE.to_owned(),
        pubkey: key.public(),
        version: "0.5.0-rc.1".to_owned(),
        commit: None,
        targets: vec![APP_TARGET.to_owned(), "darwin-aarch64".to_owned()],
        dir: updates.clone(),
    };
    let updater = Updater::new(config, transport, shared(installer), BETA).unwrap();
    Desk {
        updater,
        restarts,
        updates,
    }
}

/// The installed app's executable and its contents.
fn running(app: &Path) -> Vec<(String, String)> {
    let macos = app.join("Contents/MacOS");
    names(&macos)
        .into_iter()
        .map(|name| {
            let text = fs::read_to_string(macos.join(&name)).unwrap();
            (name, text)
        })
        .collect()
}

#[test]
fn a_tauri_app_is_swapped_for_the_cef_app_and_restarts_into_it() {
    let (root, key) = (dir("installer-swap"), Key::new());
    let apps = root.join("Applications");
    let app = installed(&apps, "endue-desk", "tauri 0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = app_tar_gz("endue-desk-cef", ID, "cef 0.5.0-rc.2");
    publish(&origin, &key, &key, "0.5.0-rc.2", "0.5.0-rc.2", &bytes);
    let desk = desk(&root, &app, &key, origin);
    assert_eq!(desk.updater.check_now(BETA).state, State::Staged);
    assert_eq!(desk.updater.apply_now().unwrap().state, State::Applying);
    assert_eq!(
        running(&app),
        [("endue-desk-cef".to_owned(), "cef 0.5.0-rc.2".to_owned())],
        "the old executable went with the old app"
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
        [Relaunch::program(app.join("Contents/MacOS/endue-desk-cef"))]
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_bad_signature_never_reaches_the_app() {
    let (root, key) = (dir("installer-signature"), Key::new());
    let app = installed(&root.join("Applications"), "endue-desk-cef", "0.5.0-rc.1");
    let bytes = app_tar_gz("endue-desk-cef", ID, "forged");
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
        assert_eq!(
            running(&app),
            [("endue-desk-cef".into(), "0.5.0-rc.1".into())]
        );
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
    let app = installed(&root.join("Applications"), "endue-desk-cef", "0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = app_tar_gz("endue-desk-cef", ID, "0.5.0-rc.2");
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
    assert_eq!(
        running(&app),
        [("endue-desk-cef".into(), "0.5.0-rc.1".into())]
    );
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn no_permission_to_write_keeps_the_app_and_the_build_staged() {
    use std::os::unix::fs::PermissionsExt;
    let (root, key) = (dir("installer-permission"), Key::new());
    let apps = root.join("Applications");
    let app = installed(&apps, "endue-desk-cef", "0.5.0-rc.1");
    let origin = shared(Origin::default());
    let bytes = app_tar_gz("endue-desk-cef", ID, "0.5.0-rc.2");
    publish(&origin, &key, &key, "0.5.0-rc.2", "0.5.0-rc.2", &bytes);
    let desk = desk(&root, &app, &key, origin);
    assert_eq!(desk.updater.check_now(BETA).state, State::Staged);
    fs::set_permissions(&apps, fs::Permissions::from_mode(0o555)).unwrap();
    if fs::write(apps.join("probe"), b"").is_ok() {
        eprintln!("skipped: this user writes to read-only folders (root)");
        fs::set_permissions(&apps, fs::Permissions::from_mode(0o755)).unwrap();
        return;
    }
    let status = desk.updater.apply_now().unwrap();
    fs::set_permissions(&apps, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(status.state, State::Failed);
    let reason = status.reason.unwrap();
    assert!(reason.contains("no permission to write to"), "{reason}");
    assert!(reason.contains(&apps.display().to_string()), "{reason}");
    assert!(status.staged, "the build stays for another try");
    assert!(desk.restarts.lock().unwrap().is_empty());
    assert_eq!(
        running(&app),
        [("endue-desk-cef".into(), "0.5.0-rc.1".into())]
    );
    assert_eq!(names(&apps), ["endue Desk.app"]);
    // With the permission back, the same staged build goes in.
    assert_eq!(desk.updater.apply_now().unwrap().state, State::Applying);
    assert_eq!(
        running(&app),
        [("endue-desk-cef".into(), "0.5.0-rc.2".into())]
    );
    let _ = fs::remove_dir_all(root);
}
