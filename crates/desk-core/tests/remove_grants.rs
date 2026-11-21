//! Removing a plugin takes back every grant it held (issue 328, ADR 0029, ADR 0108): by
//! `Core::remove_plugin` or `plugin.remove`, a plugin and each plugin a pack nested lose their
//! session and `always` grants, the grant file forgets them, and a plugin installed later under the
//! same id starts with none. An update (removed and installed again from the market, or installed
//! over itself) holds what it holds today. The network is a map the test gives.

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use desk_core::{Core, ThemeFetch};
use desk_update::verify::sha256_hex;
use serde_json::{Value, json};
use support::{SayYes, call, grant, home, manage, notes_read, plugin_manage, roots};

const RUNTIME: &str = "desk";
const ACME: &str = "https://market.acme.test/index.json";
const ENDUE: &str = "https://market.endue.test/market/";
const PACK: &str = "acme.pack";
const NESTED: &str = "acme.tickets";

fn net() -> Value {
    json!({ "permission": "net:fetch", "hosts": ["api.acme.test"] })
}

/// An http connector manifest, as a pack nests it, declaring the notes it is granted for good too.
fn connector(id: &str) -> Value {
    json!({
        "id": id, "version": "0.1.0", "kind": "connector",
        "permissions": [net(), notes_read()],
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

fn pack(version: &str) -> Value {
    json!({
        "id": PACK, "name": "Acme", "version": version, "kind": "pack",
        "pack": { "services": ["acme"], "plugins": [NESTED] }
    })
}

/// A pack folder at `parent/acme` with its nested connector under `plugins/`.
fn pack_dir(parent: &Path) -> PathBuf {
    let dir = parent.join("acme");
    let sub = dir.join("plugins").join(NESTED);
    fs::create_dir_all(&sub).unwrap();
    fs::write(dir.join("plugin.json"), pack("0.1.0").to_string()).unwrap();
    fs::write(sub.join("plugin.json"), connector(NESTED).to_string()).unwrap();
    dir
}

/// A plain plugin folder for `id` at `parent/<folder>`.
fn plain_dir(parent: &Path, folder: &str, id: &str) -> PathBuf {
    let dir = parent.join(folder);
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({
        "id": id, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "permissions": [notes_read()]
    });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<!doctype html>").unwrap();
    dir
}

fn grant_file(home: &Path) -> PathBuf {
    home.join("data/grants.json")
}

/// A desk keeping its grants in the grant file, whose person says yes.
fn desk(home: &Path) -> Core {
    let core = Core::new(roots(home))
        .with_grant_file(grant_file(home))
        .with_prompter(SayYes)
        .with_plugin_store(home.join("data/plugins.json"))
        .with_lock_file(home.join(".desk/plugins.lock"));
    grant(&core, RUNTIME, plugin_manage());
    grant(&core, RUNTIME, manage());
    core
}

/// `caller` asks for `permission` for good, and the person says yes.
fn always(core: &Core, caller: &str, permission: Value) {
    let answer = call(
        core,
        caller,
        "perm.request",
        json!({ "permission": permission, "reason": "To work", "duration": "always" }),
    )
    .unwrap();
    assert_eq!(answer["granted"], true, "{answer}");
}

/// The permissions `perm.list` shows for `caller`.
fn held(core: &Core, caller: &str) -> Vec<Value> {
    let listed = call(
        core,
        RUNTIME,
        "perm.list",
        json!({ "caller": caller, "scope": manage() }),
    )
    .unwrap();
    listed["grants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["grant"]["permission"].clone())
        .collect()
}

/// The callers the grant file holds grants for.
fn filed(home: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(grant_file(home)) else {
        return Vec::new();
    };
    let value: Value = serde_json::from_str(&text).unwrap();
    value["grants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["caller"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn removing_a_pack_takes_back_every_grant_of_its_nested_plugins() {
    let home = home("remove-grants-pack");
    let core = desk(&home);
    core.install_plugin(&pack_dir(&home.join("plugins")), false);
    grant(&core, NESTED, net());
    always(&core, NESTED, notes_read());
    grant(&core, PACK, notes_read());
    assert_eq!(held(&core, NESTED).len(), 2);
    assert!(filed(&home).contains(&NESTED.to_owned()));

    assert!(core.remove_plugin(PACK));
    assert_eq!(
        held(&core, NESTED),
        Vec::<Value>::new(),
        "the nested plugin"
    );
    assert_eq!(held(&core, PACK), Vec::<Value>::new(), "the pack");
    assert!(
        !filed(&home).contains(&NESTED.to_owned()),
        "the grant file forgets it: {:?}",
        filed(&home)
    );
}

#[test]
fn removing_a_plugin_takes_back_its_grants_and_a_new_one_under_its_id_starts_with_none() {
    let home = home("remove-grants-plain");
    let core = desk(&home);
    core.install_plugin(
        &plain_dir(&home.join("plugins"), "files", "acme.files"),
        false,
    );
    grant(&core, "acme.files", net());
    always(&core, "acme.files", notes_read());
    assert_eq!(held(&core, "acme.files").len(), 2);

    assert!(core.remove_plugin("acme.files"));
    assert_eq!(held(&core, "acme.files"), Vec::<Value>::new());
    assert!(!filed(&home).contains(&"acme.files".to_owned()));

    // Another folder under the same id (a local folder, another market) inherits nothing.
    core.install_plugin(
        &plain_dir(&home.join("other"), "files", "acme.files"),
        false,
    );
    assert_eq!(held(&core, "acme.files"), Vec::<Value>::new());
    let again = desk(&home);
    assert_eq!(
        held(&again, "acme.files"),
        Vec::<Value>::new(),
        "after a restart"
    );
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

/// A .desk-plugin of the pack with its nested connector under plugins/<id>/.
fn pack_bundle(version: &str) -> Vec<u8> {
    let path = format!("plugins/{NESTED}/plugin.json");
    let nested = base64::engine::general_purpose::STANDARD.encode(connector(NESTED).to_string());
    serde_json::to_vec(&json!({
        "format": "desk-plugin/1", "manifest": pack(version), "files": { path: nested }
    }))
    .unwrap()
}

/// A market at ACME listing the pack at `version`.
fn list(web: &Web, version: &str) {
    let bundle = pack_bundle(version);
    let url = format!("https://market.acme.test/acme-{version}.desk-plugin");
    let entry = json!({
        "id": PACK, "kind": "pack", "name": "Acme", "version": version, "publisher": "Acme",
        "license": "CC0-1.0", "url": url, "sha256": sha256_hex(&bundle), "size": bundle.len(),
        "permissions": [net()]
    });
    let index = json!({ "format": "desk-market-index/1", "entries": [entry] });
    let mut map = web.0.lock().unwrap();
    map.insert(url, bundle);
    map.insert(ACME.into(), serde_json::to_vec(&index).unwrap());
}

fn market_desk(home: &Path, web: &Web) -> Core {
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

fn install(core: &Core) {
    call(
        core,
        RUNTIME,
        "plugin.install",
        json!({ "id": PACK, "accept": [net()], "scope": plugin_manage() }),
    )
    .unwrap();
}

fn remove(core: &Core) {
    call(
        core,
        RUNTIME,
        "plugin.remove",
        json!({ "plugin": PACK, "scope": plugin_manage() }),
    )
    .unwrap();
}

#[test]
fn a_market_pack_removed_through_plugin_remove_loses_its_nested_grants() {
    let home = home("remove-grants-market");
    let web = Web::default();
    list(&web, "0.1.0");
    let core = market_desk(&home, &web);
    install(&core);
    assert_eq!(held(&core, NESTED), vec![net()], "grant_pack granted it");
    always(&core, NESTED, notes_read());

    remove(&core);
    assert_eq!(held(&core, NESTED), Vec::<Value>::new());
    assert_eq!(held(&core, PACK), Vec::<Value>::new());
    assert!(!filed(&home).contains(&NESTED.to_owned()));
}

#[test]
fn a_market_update_keeps_todays_grants() {
    let home = home("remove-grants-update");
    let web = Web::default();
    list(&web, "0.1.0");
    let core = market_desk(&home, &web);
    install(&core);
    let (pack_first, nested_first) = (held(&core, PACK), held(&core, NESTED));
    assert_eq!(nested_first, vec![net()]);

    // Removed, then installed again: the same grants as after the first install.
    remove(&core);
    install(&core);
    assert_eq!(held(&core, PACK), pack_first);
    assert_eq!(held(&core, NESTED), nested_first);

    // A newer version installed over the one installed: no removal, the grants it holds stay.
    always(&core, NESTED, notes_read());
    list(&web, "0.2.0");
    install(&core);
    assert_eq!(held(&core, NESTED), vec![net(), notes_read(), net()]);
}
