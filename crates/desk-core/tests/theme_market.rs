//! The theme market (ADR 0060): theme.market.list reads the indexes desk.theme.markets lists and
//! merges them by id, theme.market.fetch checks a bundle to preview it without installing it, and
//! theme.import by url installs a market theme with where it came from, so an update replaces it only
//! while the person has not changed it. The network is a map the test gives, never the real one.

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, ThemeFetch};
use desk_update::verify::sha256_hex;
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

const RUNTIME: &str = "desk";
const ONE: &str = "https://one.example.com/themes/index.json";
const TWO: &str = "https://two.example.com/index.json";
const GONE: &str = "https://gone.example.com/index.json";
const BAD: &str = "https://bad.example.com/index.json";
const PLAIN: &str = "http://plain.example.com/index.json";
const DUSK: &str = "https://one.example.com/themes/dusk.desk-theme";

type Answer = Result<Value, BridgeError>;

/// The network as the test sets it: bytes by URL, and every URL asked for.
#[derive(Clone, Default)]
struct Web {
    pages: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
    asked: Arc<Mutex<Vec<String>>>,
}

impl Web {
    fn put(&self, url: &str, bytes: Vec<u8>) {
        self.pages.lock().unwrap().insert(url.to_owned(), bytes);
    }

    fn asked(&self) -> Vec<String> {
        std::mem::take(&mut *self.asked.lock().unwrap())
    }

    fn fetch(&self) -> Box<ThemeFetch> {
        let web = self.clone();
        Box::new(move |url: &str| {
            web.asked.lock().unwrap().push(url.to_owned());
            let page = web.pages.lock().unwrap().get(url).cloned();
            page.ok_or_else(|| format!("{url} answered 404"))
        })
    }
}

fn themes(home: &Path) -> PathBuf {
    home.join("data/themes")
}

/// A desk with a user themes folder and `web` as its network; the runtime holds theme:manage.
fn desk(home: &Path, web: &Web) -> Core {
    let core = Core::new(roots(home)).with_themes_dir(themes(home));
    let core = core.with_theme_fetch(web.fetch());
    grant(&core, RUNTIME, json!({ "permission": "theme:manage" }));
    grant(&core, RUNTIME, plugin_manage());
    core
}

/// desk.theme.markets as the runtime sets it.
fn markets(core: &Core, urls: &[&str]) {
    let params = json!({ "key": "theme.markets", "value": urls });
    call(core, RUNTIME, "settings.set", params).unwrap();
}

/// A market theme's .desk-theme: a palette in both schemes, as theme.export writes one.
fn bundle(id: &str, version: &str, primary: &str) -> Vec<u8> {
    let manifest = json!({
        "id": id, "name": id.trim_start_matches("market."), "version": version, "kind": "theme",
        "theme": {
            "author": "Team endue", "license": "CC0-1.0",
            "light": { "colors": { "background": "#f7f3ea", "primary": primary } },
            "dark": { "colors": { "background": "#15130f", "primary": primary } }
        }
    });
    let bundle = json!({ "format": "desk-theme/1", "manifest": manifest, "files": {} });
    let mut bytes = serde_json::to_vec_pretty(&bundle).unwrap();
    bytes.push(b'\n');
    bytes
}

fn entry(id: &str, version: &str, url: &str, bytes: &[u8]) -> Value {
    json!({
        "id": id, "name": id.trim_start_matches("market."), "version": version,
        "author": "Team endue", "license": "CC0-1.0", "preview": ["#f7f3ea", "#8a4b2a"],
        "url": url, "sha256": sha256_hex(bytes), "size": bytes.len()
    })
}

fn index(entries: &[Value]) -> Vec<u8> {
    json!({ "format": "desk-theme-index/1", "themes": entries })
        .to_string()
        .into_bytes()
}

/// Put `bytes` on market ONE as market.dusk at `version`: the index and the bundle.
fn publish(web: &Web, version: &str, bytes: &[u8]) {
    let listed = entry("market.dusk", version, "dusk.desk-theme", bytes);
    web.put(ONE, index(&[listed]));
    web.put(DUSK, bytes.to_vec());
}

/// theme.<method> as the runtime, under its theme:manage scope.
fn theme(core: &Core, method: &str, mut params: Value) -> Answer {
    params["scope"] = json!({ "permission": "theme:manage" });
    call(core, RUNTIME, &format!("theme.{method}"), params)
}

fn list(core: &Core) -> Value {
    theme(core, "market.list", json!({})).unwrap()
}

fn ids(listed: &Value) -> Vec<&str> {
    let themes = listed["themes"].as_array().unwrap();
    themes
        .iter()
        .map(|t| t["theme"]["id"].as_str().unwrap())
        .collect()
}

fn listed<'a>(listed: &'a Value, id: &str) -> &'a Value {
    let themes = listed["themes"].as_array().unwrap();
    themes.iter().find(|t| t["theme"]["id"] == id).unwrap()
}

/// theme.import of a listed theme by its url, sha256 and market, as the studio's Install does.
fn install(core: &Core, id: &str) -> Answer {
    let all = list(core);
    let found = listed(&all, id);
    let (theme_entry, market) = (&found["theme"], &found["market"]);
    let params =
        json!({ "url": theme_entry["url"], "sha256": theme_entry["sha256"], "market": market });
    theme(core, "import", params)
}

fn code(answer: Answer) -> ErrorCode {
    answer.expect_err("the call is refused").code
}

/// theme.<method> refused as invalid_params: why.
fn refused(core: &Core, method: &str, params: Value) -> String {
    let why = theme(core, method, params).expect_err("the call is refused");
    assert_eq!(why.code, ErrorCode::InvalidParams, "{}", why.message);
    why.message
}

/// Params for the bundle `bytes` at `url`, from `market` when one is named.
fn by_url(url: &str, bytes: &[u8], market: Option<&str>) -> Value {
    let mut params = json!({ "url": url, "sha256": sha256_hex(bytes) });
    if let Some(market) = market {
        params["market"] = json!(market);
    }
    params
}

fn installed(core: &Core, id: &str) -> Option<String> {
    let plugin = core.plugins().into_iter().find(|p| p.id == id)?;
    Some(plugin.manifest?.version)
}

fn entries(home: &Path) -> Vec<String> {
    let names = fs::read_dir(themes(home)).unwrap().flatten();
    names
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect()
}

#[test]
fn indexes_are_fetched_in_order_and_merged_by_id_the_first_market_winning() {
    let home = home("market-list");
    let web = Web::default();
    let dusk = bundle("market.dusk", "1.0.0", "#8a4b2a");
    let tide = bundle("market.tide", "1.0.0", "#1f6f8b");
    let moss = bundle("market.moss", "1.0.0", "#4e7a3a");
    let cdn = "https://cdn.example.com/tide.desk-theme";
    let one = [
        entry("market.dusk", "1.0.0", "dusk.desk-theme", &dusk),
        entry("market.tide", "1.0.0", cdn, &tide),
    ];
    let two = [
        entry("market.tide", "2.0.0", "tide.desk-theme", &tide),
        entry("market.moss", "1.0.0", "folder/moss.desk-theme", &moss),
    ];
    web.put(ONE, index(&one));
    web.put(TWO, index(&two));
    web.put(BAD, b"<html>not an index</html>".to_vec());
    let core = desk(&home, &web);
    // No market is listed until a layer names one.
    assert_eq!(list(&core), json!({ "themes": [], "problems": [] }));
    assert!(web.asked().is_empty());

    markets(&core, &[ONE, GONE, TWO, BAD, PLAIN]);
    let all = list(&core);
    assert_eq!(ids(&all), ["market.dusk", "market.tide", "market.moss"]);
    let first = listed(&all, "market.tide");
    assert_eq!(first["market"], ONE);
    assert_eq!(first["theme"]["version"], "1.0.0");
    assert_eq!(first["theme"]["url"], cdn);
    let dusk_url = &listed(&all, "market.dusk")["theme"]["url"];
    assert_eq!(
        dusk_url, DUSK,
        "a relative url is resolved against its index"
    );
    let moss_url = &listed(&all, "market.moss")["theme"]["url"];
    assert_eq!(moss_url, "https://two.example.com/folder/moss.desk-theme");
    for theme in all["themes"].as_array().unwrap() {
        assert_eq!(theme["state"], "available");
        assert!(theme.get("installed").is_none(), "{theme}");
    }
    let problems = all["problems"].as_array().unwrap();
    let failed: Vec<&str> = problems
        .iter()
        .map(|p| p["market"].as_str().unwrap())
        .collect();
    assert_eq!(failed, [GONE, BAD, PLAIN]);
    // Only https indexes are asked for, each once; no bundle is downloaded to list them.
    assert_eq!(web.asked(), [ONE, GONE, TWO, BAD]);

    let scope = json!({ "scope": { "permission": "theme:manage" } });
    let other = call(&core, "example.plugin", "theme.market.list", scope);
    assert_eq!(code(other), ErrorCode::PermissionDenied);
}

#[test]
fn a_bundle_whose_sha256_differs_is_refused() {
    let home = home("market-sha");
    let web = Web::default();
    let published = bundle("market.dusk", "1.0.0", "#8a4b2a");
    publish(&web, "1.0.0", &published);
    web.put(DUSK, bundle("market.dusk", "1.0.0", "#ff0000"));
    let core = desk(&home, &web);
    markets(&core, &[ONE]);
    let all = list(&core);
    let theme_entry = &listed(&all, "market.dusk")["theme"];
    let (url, sha256) = (&theme_entry["url"], &theme_entry["sha256"]);

    let fetch = json!({ "url": url, "sha256": sha256 });
    let why = refused(&core, "market.fetch", fetch.clone());
    assert!(why.contains("sha256"), "{why}");
    let params = json!({ "url": url, "sha256": sha256, "market": ONE });
    refused(&core, "import", params.clone());
    assert_eq!(installed(&core, "market.dusk"), None);
    assert!(entries(&home).is_empty(), "{:?}", entries(&home));

    web.put(DUSK, published.clone());
    let fetched = theme(&core, "market.fetch", fetch).unwrap();
    assert_eq!(fetched["bundle"]["manifest"]["id"], "market.dusk");
    // A preview installs nothing and leaves nothing behind.
    assert_eq!(installed(&core, "market.dusk"), None);
    assert!(entries(&home).is_empty(), "{:?}", entries(&home));
    let landed = theme(&core, "import", params).unwrap();
    assert_eq!(landed["plugin"]["id"], "market.dusk");
    assert_eq!(listed(&list(&core), "market.dusk")["state"], "installed");

    // A bundle its index lists, with its right sha256, that is not a valid theme is refused too.
    let mut wrong: Value =
        serde_json::from_slice(&bundle("market.moss", "1.0.0", "#4e7a3a")).unwrap();
    wrong["manifest"]["theme"]["dark"]["colors"]["background"] = json!("url(x.png)");
    let wrong = wrong.to_string().into_bytes();
    let moss = "https://one.example.com/moss.desk-theme";
    web.put(ONE, index(&[entry("market.moss", "1.0.0", moss, &wrong)]));
    web.put(moss, wrong.clone());
    let why = refused(&core, "market.fetch", by_url(moss, &wrong, None));
    assert!(why.contains("background"), "{why}");
}

#[test]
fn an_update_replaces_an_untouched_market_theme_and_leaves_an_edited_one() {
    let home = home("market-update");
    let web = Web::default();
    publish(&web, "1.0.0", &bundle("market.dusk", "1.0.0", "#8a4b2a"));
    let core = desk(&home, &web);
    markets(&core, &[ONE]);
    install(&core, "market.dusk").unwrap();
    let state = |core: &Core| listed(&list(core), "market.dusk").clone();
    let again = |core: &Core| code(install(core, "market.dusk"));
    assert_eq!(state(&core)["state"], "installed");
    assert_eq!(state(&core)["installed"], "1.0.0");
    assert!(themes(&home).join(".market/market.dusk.json").is_file());

    publish(&web, "1.1.0", &bundle("market.dusk", "1.1.0", "#9a5b3a"));
    assert_eq!(state(&core)["state"], "update");
    assert_eq!(state(&core)["installed"], "1.0.0");
    install(&core, "market.dusk").unwrap();
    assert_eq!(installed(&core, "market.dusk").as_deref(), Some("1.1.0"));
    assert_eq!(state(&core)["state"], "installed");

    // The person changes it by hand: it is theirs now, and no update replaces it.
    let manifest = themes(&home).join("market.dusk/plugin.json");
    let mut mine: Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    mine["description"] = json!("Mine now");
    fs::write(&manifest, serde_json::to_vec_pretty(&mine).unwrap()).unwrap();
    assert_eq!(state(&core)["state"], "edited");
    publish(&web, "1.2.0", &bundle("market.dusk", "1.2.0", "#aa6b4a"));
    assert_eq!(state(&core)["state"], "edited");
    assert_eq!(again(&core), ErrorCode::AlreadyExists);
    let kept: Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
    assert_eq!(kept["description"], "Mine now");
    assert_eq!(kept["version"], "1.1.0");

    // Removing it forgets where it came from; the market's theme installs again.
    theme(&core, "remove", json!({ "theme": "market.dusk" })).unwrap();
    assert!(!themes(&home).join(".market/market.dusk.json").exists());
    assert_eq!(state(&core)["state"], "available");
    install(&core, "market.dusk").unwrap();
    assert_eq!(state(&core)["state"], "installed");

    // One brought in from a file is not as a market published it: the market never replaces it.
    theme(&core, "remove", json!({ "theme": "market.dusk" })).unwrap();
    let file: Value = serde_json::from_slice(&bundle("market.dusk", "1.2.0", "#aa6b4a")).unwrap();
    theme(&core, "import", json!({ "bundle": file })).unwrap();
    assert_eq!(state(&core)["state"], "edited");
    assert_eq!(again(&core), ErrorCode::AlreadyExists);
}

#[test]
fn a_market_bundle_installs_only_under_the_id_its_index_lists() {
    let home = home("market-ids");
    let web = Web::default();
    let calm = "https://one.example.com/themes/calm.desk-theme";
    let lost = "https://two.example.com/lost.desk-theme";
    let other = bundle("market.other", "1.0.0", "#2f5d50");
    let stray = bundle("market.stray", "1.0.0", "#5d2f50");
    web.put(ONE, index(&[entry("market.calm", "1.0.0", calm, &other)]));
    web.put(TWO, index(&[entry("market.stray", "1.0.0", lost, &stray)]));
    web.put(calm, other.clone());
    web.put(lost, stray.clone());
    let core = desk(&home, &web);
    markets(&core, &[ONE]);

    // ONE lists market.calm, but the bundle at its url says market.other: no preview, no install.
    for (method, market) in [("market.fetch", None), ("import", Some(ONE))] {
        let why = refused(&core, method, by_url(calm, &other, market));
        assert!(why.contains("market.calm"), "{why}");
        assert!(why.contains("market.other"), "{why}");
    }
    // A url no market in force lists: ONE does not, and TWO, which does, is not in force.
    web.asked();
    refused(&core, "market.fetch", by_url(lost, &stray, None));
    refused(&core, "import", by_url(lost, &stray, Some(ONE)));
    refused(&core, "import", by_url(lost, &stray, Some(TWO)));
    let asked = web.asked();
    assert!(!asked.contains(&lost.to_owned()), "{asked:?}");
    assert!(entries(&home).is_empty(), "{:?}", entries(&home));

    // A bundle from a file installs under its own id, as before; one with its entry's id installs.
    let file: Value = serde_json::from_slice(&other).unwrap();
    let landed = theme(&core, "import", json!({ "bundle": file })).unwrap();
    assert_eq!(landed["plugin"]["id"], "market.other");
    publish(&web, "1.0.0", &bundle("market.dusk", "1.0.0", "#8a4b2a"));
    let dusk = install(&core, "market.dusk").unwrap();
    assert_eq!(dusk["plugin"]["id"], "market.dusk");
}
