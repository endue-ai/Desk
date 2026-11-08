//! The paths desk.describe names (#333): plugin.list carries the folder each plugin was installed
//! from, and init.get says where init.yaml is, rooted at `~` inside the home folder.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use desk_bridge::{BridgeRequest, BridgeResponse, Permission, PluginManagePermission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_dir(tag: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-paths-{tag}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Value {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(err) => panic!("{method}: {:?}", err.error),
    }
}

fn plugin(parent: &Path, folder: &str, id: &str) -> PathBuf {
    let dir = parent.join(folder);
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({ "id": id, "version": "0.1.0", "kind": "policy", "contributes": {} });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    dir
}

/// A path as the bridge writes it: forward slashes.
fn bridge_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[test]
fn plugin_list_names_each_plugins_folder() {
    let parent = temp_dir("plugins");
    let files = plugin(&parent, "files", "desk.files");
    let keys = plugin(&parent, "keys", "desk.keys");
    let core = Core::new(Roots {
        home: temp_dir("home"),
    });
    core.install_plugins_in(&parent, true);
    core.grant(
        "desk",
        Permission::PluginManage(PluginManagePermission {
            permission: Default::default(),
        }),
    );
    let listed = call(
        &core,
        "desk",
        "plugin.list",
        json!({ "scope": { "permission": "plugin:manage" } }),
    );
    let folders: Vec<(String, String)> = listed["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["id"].as_str().unwrap().to_owned(),
                p["folder"].as_str().unwrap_or("").to_owned(),
            )
        })
        .collect();
    assert_eq!(
        folders,
        vec![
            ("desk.files".to_owned(), bridge_path(&files)),
            ("desk.keys".to_owned(), bridge_path(&keys)),
        ]
    );
    // Absolute on every platform (`/…`, or `C:/…` on Windows) and with forward slashes, as the
    // bridge's `Path` wants.
    assert!(
        folders
            .iter()
            .all(|(_, folder)| Path::new(folder).is_absolute() && !folder.contains('\\'))
    );
}

#[test]
fn init_get_names_the_init_file() {
    let home = temp_dir("home-init");
    fs::create_dir_all(home.join(".desk")).unwrap();
    let inside = home.join(".desk").join("init.yaml");
    fs::write(&inside, "settings:\n  desk.theme.scheme: light\n").unwrap();
    let core = Core::new(Roots { home: home.clone() }).with_init_file(inside);
    let init = call(&core, "desk", "init.get", json!({}));
    assert_eq!(init["file"], "~/.desk/init.yaml");
    assert_eq!(init["settings"], json!({ "desk.theme.scheme": "light" }));
    // Any caller may ask: it sees the file, never another caller's settings.
    assert_eq!(
        call(&core, "example.notes", "init.get", json!({}))["file"],
        "~/.desk/init.yaml"
    );

    let elsewhere = temp_dir("elsewhere").join("init.yaml");
    fs::write(&elsewhere, "settings: {}\n").unwrap();
    let core = Core::new(Roots { home }).with_init_file(elsewhere.clone());
    let init = call(&core, "desk", "init.get", json!({}));
    assert_eq!(init["file"], bridge_path(&elsewhere));
}
