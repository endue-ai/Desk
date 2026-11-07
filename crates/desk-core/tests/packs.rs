//! Packs (ADR 0108): a data-only plugin of kind `pack` brings the plugins nested in it (a connector,
//! a view) and installs, lists and removes them with it; a plugin it only names must be on the desk;
//! a pack installs from the market with what its nested plugins ask, and nested code follows the
//! endue-index rule (ADR 0107). The network is a map the test gives.

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use desk_bridge::{ErrorCode, PluginStatus};
use desk_core::{Core, ThemeFetch};
use desk_update::verify::sha256_hex;
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

const RUNTIME: &str = "desk";
const ACME: &str = "https://market.acme.test/index.json";
const ENDUE: &str = "https://market.endue.test/market/";

fn view(id: &str) -> Value {
    json!({
        "id": id, "version": "0.1.0", "title": "Board",
        "requires": { "tasks": { "kinds": ["task"] } },
        "layout": { "type": "list", "binding": { "kinds": ["task"], "sources": ["$tasks"] } }
    })
}

/// An http connector manifest, as a pack nests it.
fn connector(id: &str) -> Value {
    json!({
        "id": id, "version": "0.1.0", "kind": "connector",
        "permissions": [{ "permission": "net:fetch", "hosts": ["api.acme.test"] }],
        "connector": {
            "binding": "http", "auth": { "kind": "none" }, "sync": { "mode": "pull" },
            "resources": [{ "kind": "task" }],
            "http": {
                "baseUrl": "https://api.acme.test",
                "requests": [{ "path": "/tickets", "items": "", "map": "ticket" }],
                "maps": { "ticket": { "kind": "task", "fields": { "id": "/id", "title": "/title" } } }
            }
        }
    })
}

fn pack(id: &str, plugins: &[&str]) -> Value {
    json!({
        "id": id, "name": "Acme", "version": "0.1.0", "kind": "pack",
        "pack": { "services": ["acme"], "plugins": plugins },
        "view": view(&format!("{id}.home"))
    })
}

/// A pack folder at `parent/<folder>` with `nested` plugin manifests under `plugins/`.
fn pack_dir(parent: &Path, folder: &str, manifest: &Value, nested: &[Value]) -> PathBuf {
    let dir = parent.join(folder);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    for plugin in nested {
        let id = plugin["id"].as_str().unwrap();
        let sub = dir.join("plugins").join(id);
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("plugin.json"), plugin.to_string()).unwrap();
    }
    dir
}

fn desk(home: &Path) -> Core {
    let core = Core::new(roots(home))
        .with_plugin_store(home.join("data/plugins.json"))
        .with_lock_file(home.join(".desk/plugins.lock"));
    grant(&core, RUNTIME, plugin_manage());
    grant(&core, RUNTIME, json!({ "permission": "view:manage" }));
    core
}

fn status(core: &Core, id: &str) -> Option<PluginStatus> {
    core.plugins()
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.status)
}

fn views(core: &Core) -> Vec<String> {
    let listed = call(
        core,
        RUNTIME,
        "view.list",
        json!({ "scope": { "permission": "view:manage" } }),
    )
    .unwrap();
    let all = listed["views"].as_array().unwrap();
    all.iter()
        .map(|v| v["id"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_pack_installs_the_plugins_it_brings_and_its_views() {
    let home = home("pack-install");
    let core = desk(&home);
    let dir = pack_dir(
        &home.join("plugins"),
        "acme",
        &pack("acme.pack", &["acme.tickets"]),
        &[connector("acme.tickets")],
    );
    let info = core.install_plugin(&dir, false);
    assert_eq!(info.status, PluginStatus::Ready, "{:?}", info.error);
    assert_eq!(
        status(&core, "acme.tickets"),
        Some(PluginStatus::Ready),
        "the nested connector comes with it"
    );
    assert!(
        views(&core).contains(&"acme.pack.home".to_owned()),
        "{:?}",
        views(&core)
    );
    let lock = fs::read_to_string(home.join(".desk/plugins.lock")).unwrap();
    assert!(
        lock.contains("id: acme.pack") && lock.contains("id: acme.tickets"),
        "{lock}"
    );
}

#[test]
fn removing_a_pack_removes_what_it_brought() {
    let home = home("pack-remove");
    let core = desk(&home);
    let alone = home.join("plugins/board");
    fs::create_dir_all(&alone).unwrap();
    let board = json!({ "id": "acme.board", "version": "0.1.0", "kind": "view", "view": view("acme.board") });
    fs::write(alone.join("plugin.json"), board.to_string()).unwrap();
    core.install_plugin(&alone, false);
    let manifest = pack("acme.pack", &["acme.tickets", "acme.board"]);
    let dir = pack_dir(
        &home.join("plugins"),
        "acme",
        &manifest,
        &[connector("acme.tickets")],
    );
    core.install_plugin(&dir, false);
    assert_eq!(status(&core, "acme.pack"), Some(PluginStatus::Ready));

    assert!(core.remove_plugin("acme.pack"));
    assert_eq!(status(&core, "acme.pack"), None);
    assert_eq!(
        status(&core, "acme.tickets"),
        None,
        "what it brought goes with it"
    );
    assert_eq!(
        status(&core, "acme.board"),
        Some(PluginStatus::Ready),
        "what it only named stays"
    );
    assert!(!views(&core).contains(&"acme.pack.home".to_owned()));
    let lock = fs::read_to_string(home.join(".desk/plugins.lock")).unwrap();
    assert!(!lock.contains("acme.tickets"), "{lock}");
}

#[test]
fn a_pack_names_only_plugins_it_brings_or_the_desk_has() {
    let home = home("pack-missing");
    let core = desk(&home);
    let dir = pack_dir(
        &home.join("plugins"),
        "acme",
        &pack("acme.pack", &["acme.tickets", "acme.gone"]),
        &[connector("acme.tickets")],
    );
    let info = core.install_plugin(&dir, false);
    assert_eq!(info.status, PluginStatus::Failed);
    assert!(info.error.unwrap_or_default().contains("acme.gone"));
}

#[derive(Clone, Default)]
struct Web(Arc<Mutex<BTreeMap<String, Vec<u8>>>>);

impl Web {
    fn fetch(&self) -> Box<ThemeFetch> {
        let web = self.clone();
        Box::new(move |url: &str| {
            web.0
                .lock()
                .unwrap()
                .get(url)
                .cloned()
                .ok_or_else(|| format!("{url} answered 404"))
        })
    }
}

/// A .desk-plugin of a pack with `nested` plugins as files under plugins/<id>/.
fn pack_bundle(manifest: &Value, nested: &[Value]) -> Vec<u8> {
    let mut files = serde_json::Map::new();
    for plugin in nested {
        let path = format!("plugins/{}/plugin.json", plugin["id"].as_str().unwrap());
        files.insert(
            path,
            json!(base64::engine::general_purpose::STANDARD.encode(plugin.to_string())),
        );
    }
    serde_json::to_vec(&json!({ "format": "desk-plugin/1", "manifest": manifest, "files": files }))
        .unwrap()
}

fn market_desk(home: &Path, web: &Web, bundle: &[u8], permissions: &Value) -> Core {
    let url = "https://market.acme.test/acme.desk-plugin";
    let entry = json!({
        "id": "acme.pack", "kind": "pack", "name": "Acme", "version": "0.1.0", "publisher": "Acme",
        "license": "CC0-1.0", "url": url, "sha256": sha256_hex(bundle), "size": bundle.len(),
        "permissions": permissions
    });
    web.0.lock().unwrap().insert(url.into(), bundle.to_vec());
    let index = json!({ "format": "desk-market-index/1", "entries": [entry] });
    web.0
        .lock()
        .unwrap()
        .insert(ACME.into(), serde_json::to_vec(&index).unwrap());
    let core = desk(home)
        .with_market_dir(home.join("data/plugins"))
        .with_endue_market(ENDUE)
        .with_theme_fetch(web.fetch());
    for (key, value) in [
        ("market.indexes", json!([ACME])),
        ("theme.markets", json!([])),
        ("design.markets", json!([])),
    ] {
        call(
            &core,
            RUNTIME,
            "settings.set",
            json!({ "key": key, "value": value }),
        )
        .unwrap();
    }
    core
}

#[test]
fn a_pack_installs_from_the_market() {
    let home = home("pack-market");
    let web = Web::default();
    let asked = json!([{ "permission": "net:fetch", "hosts": ["api.acme.test"] }]);
    let bundle = pack_bundle(
        &pack("acme.pack", &["acme.tickets"]),
        &[connector("acme.tickets")],
    );
    let core = market_desk(&home, &web, &bundle, &asked);
    let install = |accept: Value| {
        call(
            &core,
            RUNTIME,
            "plugin.install",
            json!({ "id": "acme.pack", "accept": accept, "scope": plugin_manage() }),
        )
    };
    assert_eq!(
        install(json!([])).unwrap_err().code,
        ErrorCode::PermissionDenied,
        "its connector reaches a host"
    );
    let installed = install(asked.clone()).unwrap();
    assert_eq!(installed["plugin"]["id"], "acme.pack");
    assert_eq!(status(&core, "acme.tickets"), Some(PluginStatus::Ready));

    let ui =
        json!({ "id": "acme.panel", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" });
    let coded = pack_bundle(&pack("acme.pack", &["acme.panel"]), &[ui]);
    let home = home_again("pack-market-code");
    let core = market_desk(&home, &Web::default(), &coded, &json!([]));
    let refused = call(
        &core,
        RUNTIME,
        "plugin.install",
        json!({ "id": "acme.pack", "accept": [], "scope": plugin_manage() }),
    )
    .unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert!(
        refused.message.contains("not verified"),
        "{}",
        refused.message
    );
}

fn home_again(tag: &str) -> PathBuf {
    home(tag)
}
