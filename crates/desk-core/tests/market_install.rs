//! The market for every kind (ADR 0107, specs/market/v0): market.list merges the market indexes and
//! the theme markets, plugin.install lands a bundle with the permissions the person accepted and
//! records it in plugins.lock, a sha256 mismatch and a widened update without consent are refused,
//! code installs from the endue index only, and plugin.remove takes back what the market installed.
//! The network is a map the test gives, never the real one.

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use desk_bridge::ErrorCode;
use desk_core::{Core, ThemeFetch};
use desk_update::verify::sha256_hex;
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

const RUNTIME: &str = "desk";
const ENDUE: &str = "https://market.endue.test/market/";
const VIEWS: &str = "https://market.endue.test/market/views/index.json";
const ACME: &str = "https://market.acme.test/index.json";
const THEMES: &str = "https://market.endue.test/market/themes/index.json";

#[derive(Clone, Default)]
struct Web(Arc<Mutex<BTreeMap<String, Vec<u8>>>>);

impl Web {
    fn put(&self, url: &str, bytes: Vec<u8>) {
        self.0.lock().unwrap().insert(url.to_owned(), bytes);
    }

    fn fetch(&self) -> Box<ThemeFetch> {
        let web = self.clone();
        Box::new(move |url: &str| {
            let page = web.0.lock().unwrap().get(url).cloned();
            page.ok_or_else(|| format!("{url} answered 404"))
        })
    }
}

/// A desk with a market folder, a lock, the test's network and its endue index under `ENDUE`.
fn desk(home: &Path, web: &Web) -> Core {
    let core = Core::new(roots(home))
        .with_plugin_store(home.join("data/plugins.json"))
        .with_lock_file(home.join(".desk/plugins.lock"))
        .with_themes_dir(home.join("data/themes"))
        .with_market_dir(market_dir(home))
        .with_endue_market(ENDUE)
        .with_theme_fetch(web.fetch());
    grant(&core, RUNTIME, plugin_manage());
    grant(&core, RUNTIME, json!({ "permission": "theme:manage" }));
    grant(&core, RUNTIME, json!({ "permission": "perm:manage" }));
    let set = |key: &str, value: Value| {
        let params = json!({ "key": key, "value": value });
        call(&core, RUNTIME, "settings.set", params).unwrap();
    };
    set("market.indexes", json!([VIEWS, ACME]));
    set("theme.markets", json!([THEMES]));
    set("design.markets", json!([]));
    core
}

fn market_dir(home: &Path) -> PathBuf {
    home.join("data/plugins")
}

/// A .desk-plugin: a view plugin, or a ui plugin (code) with one page.
fn bundle(id: &str, kind: &str, version: &str, permissions: &Value) -> Vec<u8> {
    let mut manifest = json!({ "id": id, "name": id, "version": version, "kind": kind, "permissions": permissions });
    let mut files = json!({});
    if kind == "view" {
        manifest["view"] = json!({
            "id": id, "version": version, "title": "Board",
            "requires": { "tasks": { "kinds": ["task"] } },
            "layout": { "type": "list", "binding": { "kinds": ["task"], "sources": ["$tasks"] } }
        });
    } else {
        manifest["entry"] = json!("ui/index.html");
        let page = base64::engine::general_purpose::STANDARD.encode("<p>tracker</p>");
        files = json!({ "ui/index.html": page });
    }
    let bundle = json!({ "format": "desk-plugin/1", "manifest": manifest, "files": files });
    serde_json::to_vec_pretty(&bundle).unwrap()
}

/// An index entry for `bytes` at `url`.
fn entry(
    id: &str,
    kind: &str,
    version: &str,
    url: &str,
    bytes: &[u8],
    permissions: &Value,
) -> Value {
    json!({
        "id": id, "kind": kind, "name": id, "version": version, "publisher": "Fixture",
        "license": "CC0-1.0", "url": url, "sha256": sha256_hex(bytes), "size": bytes.len(),
        "permissions": permissions
    })
}

fn index(entries: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({ "format": "desk-market-index/1", "entries": entries })).unwrap()
}

/// Publish a plugin at `url` in `market`'s index (replacing the index with these entries).
fn publish(web: &Web, market: &str, plugins: &[(&str, &str, &str, &str, Value)]) {
    let mut entries = Vec::new();
    for (id, kind, version, url, permissions) in plugins {
        let bytes = bundle(id, kind, version, permissions);
        entries.push(entry(
            id,
            if *kind == "view" { "view" } else { "plugin" },
            version,
            url,
            &bytes,
            permissions,
        ));
        web.put(url, bytes);
    }
    web.put(market, index(entries));
}

fn tasks() -> Value {
    json!([{ "permission": "data:read", "kinds": ["task"] }])
}

fn list(core: &Core) -> Vec<Value> {
    let listed = call(
        core,
        RUNTIME,
        "market.list",
        json!({ "scope": plugin_manage() }),
    )
    .unwrap();
    listed["entries"].as_array().unwrap().clone()
}

fn listing<'a>(entries: &'a [Value], id: &str) -> &'a Value {
    entries
        .iter()
        .find(|e| e["entry"]["id"] == id)
        .unwrap_or_else(|| panic!("no {id}: {entries:?}"))
}

fn install(core: &Core, id: &str, accept: Value) -> Result<Value, desk_bridge::BridgeError> {
    let params = json!({ "id": id, "accept": accept, "scope": plugin_manage() });
    call(core, RUNTIME, "plugin.install", params)
}

fn granted(core: &Core, caller: &str) -> Vec<Value> {
    let listed = call(
        core,
        RUNTIME,
        "perm.list",
        json!({ "scope": { "permission": "perm:manage" } }),
    )
    .unwrap();
    let grants = listed["grants"].as_array().unwrap();
    grants
        .iter()
        .filter(|g| g["caller"] == caller)
        .map(|g| g["grant"]["permission"].clone())
        .collect()
}

fn installed(core: &Core, id: &str) -> Option<String> {
    let plugin = core.plugins().into_iter().find(|p| p.id == id)?;
    plugin.manifest.map(|m| m.version)
}

fn lock_text(home: &Path) -> String {
    fs::read_to_string(home.join(".desk/plugins.lock")).unwrap_or_default()
}

fn theme_index(web: &Web) {
    let lagoon = fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../market/themes/lagoon.desk-theme"),
    )
    .unwrap();
    let theme = json!({
        "id": "market.lagoon", "name": "Lagoon", "version": "1.0.0", "author": "Team endue",
        "license": "CC0-1.0", "preview": ["#0f8b8d"], "url": "lagoon.desk-theme",
        "sha256": sha256_hex(&lagoon), "size": lagoon.len()
    });
    web.put(
        THEMES,
        serde_json::to_vec(&json!({ "format": "desk-theme-index/1", "themes": [theme] })).unwrap(),
    );
    web.put(
        "https://market.endue.test/market/themes/lagoon.desk-theme",
        lagoon,
    );
}

#[test]
fn market_list_merges_every_kind_with_its_state_and_what_it_would_add() {
    let (home, web) = (home("market-list"), Web::default());
    let core = desk(&home, &web);
    publish(
        &web,
        VIEWS,
        &[(
            "market.week",
            "view",
            "1.0.0",
            "https://market.endue.test/market/views/week.desk-plugin",
            json!([]),
        )],
    );
    publish(
        &web,
        ACME,
        &[
            (
                "acme.tracker",
                "ui",
                "2.1.0",
                "https://market.acme.test/tracker.desk-plugin",
                tasks(),
            ),
            (
                "acme.board",
                "view",
                "1.0.0",
                "https://market.acme.test/board.desk-plugin",
                tasks(),
            ),
            (
                "market.week",
                "view",
                "9.9.9",
                "https://market.acme.test/week.desk-plugin",
                json!([]),
            ),
        ],
    );
    theme_index(&web);

    let entries = list(&core);
    let ids: Vec<&str> = entries
        .iter()
        .map(|e| e["entry"]["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        ["market.week", "acme.tracker", "acme.board", "market.lagoon"],
        "the first market wins"
    );
    let week = listing(&entries, "market.week");
    assert_eq!(
        (
            week["market"].as_str(),
            week["verified"].as_bool(),
            week["state"].as_str()
        ),
        (Some(VIEWS), Some(true), Some("available"))
    );
    assert_eq!(week["entry"]["version"], "1.0.0");
    let tracker = listing(&entries, "acme.tracker");
    assert_eq!(
        (
            tracker["entry"]["kind"].as_str(),
            tracker["verified"].as_bool()
        ),
        (Some("plugin"), Some(false))
    );
    assert_eq!(tracker["added"], tasks(), "a new install adds all it asks");
    let lagoon = listing(&entries, "market.lagoon");
    assert_eq!(
        (
            lagoon["entry"]["kind"].as_str(),
            lagoon["verified"].as_bool()
        ),
        (Some("theme"), Some(true))
    );
    assert_eq!(lagoon["entry"]["publisher"], "Team endue");

    install(&core, "market.week", json!([])).unwrap();
    let after = list(&core);
    let week = listing(&after, "market.week");
    assert_eq!(
        (week["state"].as_str(), week["installed"].as_str()),
        (Some("installed"), Some("1.0.0"))
    );
    install(&core, "market.lagoon", json!([])).unwrap();
    assert_eq!(
        listing(&list(&core), "market.lagoon")["state"],
        "installed",
        "a theme goes through theme.import"
    );
}

#[test]
fn plugin_install_lands_a_view_plugin_records_it_in_the_lock_and_grants_what_was_accepted() {
    let (home, web) = (home("market-install"), Web::default());
    let core = desk(&home, &web);
    let url = "https://market.acme.test/board.desk-plugin";
    publish(&web, ACME, &[("acme.board", "view", "1.0.0", url, tasks())]);
    web.put(VIEWS, index(vec![]));

    let answer = install(&core, "acme.board", tasks()).unwrap();
    assert_eq!(answer["plugin"]["id"], "acme.board");
    assert_eq!(answer["plugin"]["status"], "ready");
    assert!(market_dir(&home).join("acme.board/plugin.json").is_file());
    assert_eq!(installed(&core, "acme.board").as_deref(), Some("1.0.0"));
    assert!(
        lock_text(&home).contains(&format!("source: \"url:{url}\"")),
        "{}",
        lock_text(&home)
    );
    assert_eq!(
        granted(&core, "acme.board"),
        tasks().as_array().unwrap().clone()
    );

    drop(core);
    let core = desk(&home, &web);
    core.install_market_plugins();
    assert_eq!(
        installed(&core, "acme.board").as_deref(),
        Some("1.0.0"),
        "it comes back"
    );
    assert_eq!(
        granted(&core, "acme.board"),
        tasks().as_array().unwrap().clone(),
        "with its grants"
    );
}

#[test]
fn a_sha256_mismatch_is_refused_and_nothing_lands() {
    let (home, web) = (home("market-sha"), Web::default());
    let core = desk(&home, &web);
    let url = "https://market.acme.test/board.desk-plugin";
    publish(
        &web,
        ACME,
        &[("acme.board", "view", "1.0.0", url, json!([]))],
    );
    web.put(VIEWS, index(vec![]));
    web.put(url, bundle("acme.board", "view", "1.0.1", &json!([])));

    let refused = install(&core, "acme.board", json!([])).unwrap_err();
    assert_eq!(
        refused.code,
        ErrorCode::InvalidParams,
        "{}",
        refused.message
    );
    assert!(refused.message.contains("sha256"), "{}", refused.message);
    assert!(!market_dir(&home).join("acme.board").exists());
    assert_eq!(installed(&core, "acme.board"), None);
}

#[test]
fn an_update_that_widens_permissions_needs_them_accepted_again() {
    let (home, web) = (home("market-widen"), Web::default());
    let core = desk(&home, &web);
    web.put(VIEWS, index(vec![]));
    let one = "https://market.acme.test/board-1.desk-plugin";
    publish(&web, ACME, &[("acme.board", "view", "1.0.0", one, tasks())]);
    install(&core, "acme.board", tasks()).unwrap();

    let fetch = json!({ "permission": "net:fetch", "hosts": ["api.acme.test"] });
    let wider = json!([tasks()[0], fetch]);
    let two = "https://market.acme.test/board-2.desk-plugin";
    publish(
        &web,
        ACME,
        &[("acme.board", "view", "2.0.0", two, wider.clone())],
    );
    let board = list(&core)
        .into_iter()
        .find(|e| e["entry"]["id"] == "acme.board")
        .unwrap();
    assert_eq!(
        (board["state"].as_str(), board["installed"].as_str()),
        (Some("update"), Some("1.0.0"))
    );
    assert_eq!(board["added"], json!([fetch]), "only what the update adds");

    let refused = install(&core, "acme.board", tasks()).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert!(refused.message.contains("net:fetch"), "{}", refused.message);
    assert_eq!(
        installed(&core, "acme.board").as_deref(),
        Some("1.0.0"),
        "the old one stays"
    );

    install(&core, "acme.board", wider).unwrap();
    assert_eq!(installed(&core, "acme.board").as_deref(), Some("2.0.0"));
    assert!(granted(&core, "acme.board").contains(&fetch));
}

#[test]
fn a_code_plugin_installs_from_the_endue_index_only() {
    let (home, web) = (home("market-code"), Web::default());
    let core = desk(&home, &web);
    web.put(VIEWS, index(vec![]));
    publish(
        &web,
        ACME,
        &[
            (
                "acme.tracker",
                "ui",
                "2.1.0",
                "https://market.acme.test/tracker.desk-plugin",
                json!([]),
            ),
            (
                "acme.board",
                "view",
                "1.0.0",
                "https://market.acme.test/board.desk-plugin",
                json!([]),
            ),
        ],
    );
    let refused = install(&core, "acme.tracker", json!([])).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert!(
        refused.message.contains("not verified"),
        "{}",
        refused.message
    );
    assert_eq!(installed(&core, "acme.tracker"), None);
    install(&core, "acme.board", json!([])).unwrap();
    assert_eq!(
        installed(&core, "acme.board").as_deref(),
        Some("1.0.0"),
        "data from anywhere"
    );

    publish(
        &web,
        VIEWS,
        &[(
            "acme.tracker",
            "ui",
            "2.1.0",
            "https://market.endue.test/market/views/tracker.desk-plugin",
            json!([]),
        )],
    );
    install(&core, "acme.tracker", json!([])).unwrap();
    assert_eq!(
        installed(&core, "acme.tracker").as_deref(),
        Some("2.1.0"),
        "code from the endue index"
    );
}

#[test]
fn plugin_remove_drops_a_market_plugin_its_folder_and_its_lock_line() {
    let (home, web) = (home("market-remove"), Web::default());
    let core = desk(&home, &web);
    publish(
        &web,
        VIEWS,
        &[(
            "market.week",
            "view",
            "1.0.0",
            "https://market.endue.test/market/views/week.desk-plugin",
            tasks(),
        )],
    );
    install(&core, "market.week", tasks()).unwrap();
    assert!(lock_text(&home).contains("market.week"));

    let remove = |id: &str| {
        call(
            &core,
            RUNTIME,
            "plugin.remove",
            json!({ "plugin": id, "scope": plugin_manage() }),
        )
    };
    assert_eq!(remove("market.week").unwrap(), json!({}));
    assert_eq!(installed(&core, "market.week"), None);
    assert!(!market_dir(&home).join("market.week").exists());
    assert!(!lock_text(&home).contains("market.week"));
    assert!(granted(&core, "market.week").is_empty(), "its grants go");
    assert_eq!(remove("market.week").unwrap_err().code, ErrorCode::NotFound);

    let builtin = home.join("app/alpha");
    fs::create_dir_all(builtin.join("ui")).unwrap();
    let manifest =
        json!({ "id": "desk.alpha", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" });
    fs::write(builtin.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(builtin.join("ui/index.html"), "<p>a</p>").unwrap();
    core.install_plugin(&builtin, true);
    assert_eq!(
        remove("desk.alpha").unwrap_err().code,
        ErrorCode::InvalidParams,
        "a built-in stays"
    );
}
