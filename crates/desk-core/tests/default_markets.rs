//! The default look markets (ADR 0060, ADR 0091): the defaults of desk.theme.markets and
//! desk.design.markets are this repository's two indexes, themes and design systems, and every one in them
//! lists, installs as the kind its index says, and reads installed afterwards. A bundle of another kind
//! than its index says is refused. The network is a map the test fills from the repository.

mod support;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

const RUNTIME: &str = "desk";
const RAW: &str = "https://raw.githubusercontent.com/endue-ai/Desk/main/";
const FOLDERS: [&str; 2] = ["market/themes", "market/design-systems"];

/// The repository's market folders served at their raw URLs, plus any page a test adds.
fn web(extra: &[(String, Vec<u8>)]) -> Arc<Mutex<BTreeMap<String, Vec<u8>>>> {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut pages = BTreeMap::new();
    for folder in FOLDERS {
        for file in fs::read_dir(repo.join(folder)).unwrap().flatten() {
            let name = file.file_name().to_string_lossy().into_owned();
            pages.insert(
                format!("{RAW}{folder}/{name}"),
                fs::read(file.path()).unwrap(),
            );
        }
    }
    pages.extend(extra.iter().cloned());
    Arc::new(Mutex::new(pages))
}

fn desk(name: &str, pages: Arc<Mutex<BTreeMap<String, Vec<u8>>>>) -> Core {
    let home = home(name);
    let core = Core::new(roots(&home)).with_themes_dir(home.join("data/themes"));
    let fetch = move |url: &str| {
        pages
            .lock()
            .unwrap()
            .get(url)
            .cloned()
            .ok_or(format!("{url}: 404"))
    };
    let core = core.with_theme_fetch(Box::new(fetch));
    grant(&core, RUNTIME, json!({ "permission": "theme:manage" }));
    grant(&core, RUNTIME, plugin_manage());
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for policy in ["plugins/theme", "plugins/design"] {
        let installed = core.install_plugin(&repo.join(policy), true);
        assert!(installed.error.is_none(), "{policy}: {:?}", installed.error);
    }
    core
}

fn theme(core: &Core, method: &str, mut params: Value) -> Result<Value, BridgeError> {
    params["scope"] = json!({ "permission": "theme:manage" });
    call(core, RUNTIME, &format!("theme.{method}"), params)
}

fn install(core: &Core, listed: &Value) -> Result<Value, BridgeError> {
    let entry = &listed["theme"];
    let params =
        json!({ "url": entry["url"], "sha256": entry["sha256"], "market": listed["market"] });
    theme(core, "import", params)
}

#[test]
fn every_theme_and_design_system_in_the_default_markets_lists_and_installs() {
    let core = desk("markets-default", web(&[]));
    let all = theme(&core, "market.list", json!({})).unwrap();
    assert_eq!(all["problems"], json!([]));
    let looks = all["themes"].as_array().unwrap().clone();
    let designs = looks
        .iter()
        .filter(|l| l["theme"]["kind"] == "design-system")
        .count();
    assert!(designs >= 2 && looks.len() - designs >= 2, "{all}");
    for listed in &looks {
        let id = listed["theme"]["id"].as_str().unwrap();
        assert!(id.starts_with("market."), "{id}");
        let folder = FOLDERS[usize::from(listed["theme"]["kind"] == "design-system")];
        assert_eq!(listed["market"], json!(format!("{RAW}{folder}/index.json")));
        assert_eq!(listed["state"], "available");
        let plugin = install(&core, listed).unwrap_or_else(|e| panic!("{id}: {}", e.message));
        let kind = listed["theme"]["kind"].as_str().unwrap_or("theme");
        assert_eq!(plugin["plugin"]["manifest"]["kind"], kind, "{id}");
    }
    for listed in theme(&core, "market.list", json!({})).unwrap()["themes"]
        .as_array()
        .unwrap()
    {
        assert_eq!(listed["state"], "installed");
    }
}

#[test]
fn a_bundle_of_another_kind_than_its_index_says_is_refused() {
    // The design system market's index, with a theme's bundle where a design system's should be.
    let index = format!("{RAW}market/design-systems/index.json");
    let pages = web(&[]);
    let lagoon = format!("{RAW}market/themes/lagoon.desk-theme");
    let mut bundle: Value = serde_json::from_slice(&pages.lock().unwrap()[&lagoon]).unwrap();
    bundle["manifest"]["id"] = json!("market.shore");
    let bytes = bundle.to_string().into_bytes();
    let swapped = format!("{RAW}market/design-systems/bubble.desk-design");
    let mut listed: Value = serde_json::from_slice(&pages.lock().unwrap()[&index]).unwrap();
    listed["themes"][1]["id"] = json!("market.shore");
    listed["themes"][1]["sha256"] = json!(desk_update::verify::sha256_hex(&bytes));
    listed["themes"][1]["size"] = json!(bytes.len());
    pages.lock().unwrap().insert(swapped.clone(), bytes);
    pages
        .lock()
        .unwrap()
        .insert(index, listed.to_string().into_bytes());
    let core = desk("markets-kind", pages);
    let all = theme(&core, "market.list", json!({})).unwrap();
    let entry = all["themes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["theme"]["url"] == json!(swapped));
    let refused = install(&core, entry.expect("the swapped entry is listed")).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidParams);
    assert!(
        refused.message.contains("not of the kind its market lists"),
        "{}",
        refused.message
    );
}
