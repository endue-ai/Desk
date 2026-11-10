//! A macOS desk for the installer tests: a release of an `.app.tar.gz` on beta, and a desk at
//! 0.5.0-rc.1 installed as an app, updating through `PackageInstaller` with the prompt it is given.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use desk_update::install::{Elevate, Layout, PackageInstaller, Relaunch};
use desk_update::verify::sha256_hex;
use desk_update::{Channel, Config, Prefs, Transport, Updater};
use serde_json::json;

use super::bundle::names;
use super::{BASE, Key, Origin, shared};

pub const APP_TARGET: &str = "darwin-aarch64-app";
pub const BETA: Prefs = Prefs {
    channel: Channel::Beta,
    auto: true,
    check: true,
};

/// Publish `version` on beta with `bytes` as its `.app.tar.gz`; the artifact signed by `signer` for
/// `signed_for`, the documents by `key`.
pub fn publish(
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
pub struct Desk {
    pub updater: Updater,
    pub restarts: Arc<Mutex<Vec<Relaunch>>>,
    pub updates: PathBuf,
}

/// The desk installed as `app`, its updates folder in `root`, asking `elevate` for an administrator.
pub fn desk(
    root: &Path,
    app: &Path,
    key: &Key,
    transport: Arc<dyn Transport>,
    elevate: Arc<dyn Elevate>,
) -> Desk {
    let updates = root.join("updates");
    let restarts = Arc::new(Mutex::new(Vec::new()));
    let asked = restarts.clone();
    let installer = PackageInstaller::new(
        Layout::App {
            app: app.to_path_buf(),
        },
        &updates,
        elevate,
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
pub fn running(app: &Path) -> Vec<(String, String)> {
    let macos = app.join("Contents/MacOS");
    names(&macos)
        .into_iter()
        .map(|name| {
            let text = fs::read_to_string(macos.join(&name)).unwrap();
            (name, text)
        })
        .collect()
}
