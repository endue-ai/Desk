//! Both tags are already public when Desk first comes online. The smoke runner builds this test
//! against the pre-transition updater and the new updater, sharing one signed catalog and install.
mod support;

use desk_update::{Config, Prefs, State, Updater};
use serde_json::json;
use std::{env, fs, path::Path, process::Command, sync::Arc};
use support::*;

const OLD: &str = "endue-ai/Desk";
const NEW: &str = "endue-ai/endue";
const INSTALLED: &str = "0.3.0";
const BRIDGE: &str = "0.3.1";
const RENAMED: &str = "0.4.0";

fn publish(catalog: &Path, script: &Path, repo: &str, version: &str, floor: &str, key: &Key) {
    let folder = catalog.join(version);
    fs::create_dir_all(&folder).unwrap();
    let app = if version == BRIDGE {
        "endue-desk"
    } else {
        "endue"
    };
    let name = format!("{app}_{version}_linux-x86_64.deb");
    let bytes = artifact(version, DEB);
    fs::write(folder.join(&name), &bytes).unwrap();
    fs::write(
        folder.join(format!("{name}.sig")),
        key.sign(&bytes, Some(version)),
    )
    .unwrap();
    let generate = |args: &[&str], name: &str| {
        let result = Command::new("node")
            .arg(script)
            .args(args)
            .env("GITHUB_REPOSITORY", repo)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        fs::write(folder.join(name), &result.stdout).unwrap();
        fs::write(
            folder.join(format!("{name}.sig")),
            key.sign(&result.stdout, None),
        )
        .unwrap();
    };
    generate(
        &[
            "manifest",
            folder.to_str().unwrap(),
            version,
            "c46d12b",
            floor,
        ],
        "release.json",
    );
    generate(
        &["manual", folder.join("release.json").to_str().unwrap()],
        "UPGRADE_PATH.json",
    );
}

fn catalog(root: &Path) -> Arc<Origin> {
    let origin = shared(Origin::default());
    let page = [RENAMED, BRIDGE].map(|v| {
        json!({"tag_name": format!("v{v}"), "draft": false,
        "prerelease": false, "assets": [{"name":"UPGRADE_PATH.json"}]})
    });
    for repo in [OLD, NEW] {
        origin.put(
            &format!("https://api.github.com/repos/{repo}/releases?per_page=30&page=1"),
            serde_json::to_vec(&page).unwrap(),
        );
        for version in [BRIDGE, RENAMED] {
            for file in fs::read_dir(root.join(version)).unwrap() {
                let file = file.unwrap();
                let url = format!(
                    "https://github.com/{repo}/releases/download/v{version}/{}",
                    file.file_name().to_str().unwrap()
                );
                origin.put(&url, fs::read(file.path()).unwrap());
            }
        }
    }
    origin
}

fn client(
    root: &Path,
    repo: &str,
    version: &str,
    origin: Arc<Origin>,
    recorder: Arc<Recorder>,
) -> Updater {
    let cfg = Config {
        base: format!("https://github.com/{repo}/releases"),
        pubkey: fs::read_to_string(root.join("public")).unwrap(),
        version: version.to_string(),
        commit: None,
        targets: vec![DEB.into()],
        dir: root.join("state"),
    };
    Updater::new(cfg, origin, recorder, Prefs::default()).unwrap()
}

fn install(root: &Path, origin: Arc<Origin>, repo: &str, from: &str, to: &str) {
    let installed = root.join("installed");
    assert_eq!(fs::read(&installed).unwrap(), artifact(from, DEB));
    let recorder = shared(Recorder::default());
    let updater = client(root, repo, from, origin, recorder.clone());
    let status = updater.check_now(Prefs::default());
    assert_eq!(status.state, State::Staged, "{:?}", status.reason);
    assert_eq!(status.release.unwrap().version, to);
    updater.apply_now().unwrap();
    let applied = recorder.installed.lock().unwrap();
    assert_eq!(*applied, [(to.to_owned(), artifact(to, DEB))]);
    fs::write(installed, &applied[0].1).unwrap();
}

#[test]
fn published_rename_catalog_installs_both_hops() {
    let smoke = env::var_os("DESK_RENAME_SMOKE_DIR");
    let root = smoke
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| dir("rename"));
    let hop = env::var("DESK_RENAME_SMOKE_HOP").unwrap_or_else(|_| "both".into());
    assert!(matches!(hop.as_str(), "old" | "new" | "both"));
    if hop != "new" {
        let script = env::var_os("DESK_RENAME_SMOKE_PUBLISHER")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/github-upgrade-path.mjs")
            });
        let key = Key::new();
        publish(&root, &script, OLD, BRIDGE, INSTALLED, &key);
        publish(&root, &script, NEW, RENAMED, BRIDGE, &key);
        fs::write(root.join("public"), key.public()).unwrap();
        fs::write(root.join("installed"), artifact(INSTALLED, DEB)).unwrap();
        install(&root, catalog(&root), OLD, INSTALLED, BRIDGE);
    }
    if hop != "old" {
        let bad = catalog(&root);
        let url =
            format!("https://github.com/{NEW}/releases/download/v{RENAMED}/UPGRADE_PATH.json");
        bad.put(&url, b"{}".to_vec());
        let recorder = shared(Recorder::default());
        let bridge = client(&root, NEW, BRIDGE, bad, recorder.clone());
        let status = bridge.check_now(Prefs::default());
        assert_eq!(status.state, State::Failed);
        assert!(status.reason.unwrap().contains("signature"));
        assert!(bridge.apply_now().is_err());
        assert!(recorder.installed.lock().unwrap().is_empty());
        install(&root, catalog(&root), NEW, BRIDGE, RENAMED);
    }
    if smoke.is_none() {
        fs::remove_dir_all(root).unwrap();
    }
}
