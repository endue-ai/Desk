//! Safe mode (ADR 0061): a start that runs only the desk's own policy plugins, kind `policy` with an
//! id starting `desk.`. Every other plugin, libraries and the view plugins included, is held off for
//! this run without touching plugins.json; turning one on ends its hold.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_core::{Core, SafeReason};
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

fn repo_plugins() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins")
}

fn listed(core: &Core) -> Vec<Value> {
    grant(core, "desk", plugin_manage());
    call(
        core,
        "desk",
        "plugin.list",
        json!({ "scope": plugin_manage() }),
    )
    .unwrap()["plugins"]
        .as_array()
        .unwrap()
        .clone()
}

fn desk_policy(plugin: &Value) -> bool {
    plugin["manifest"]["kind"] == "policy"
        && plugin["id"]
            .as_str()
            .is_some_and(|id| id.starts_with("desk."))
}

#[test]
fn safe_mode_runs_only_the_desk_policy_plugins() {
    let home = home("safe-mode");
    let store = home.join("data/plugins.json");
    fs::create_dir_all(store.parent().unwrap()).unwrap();
    // The person turned desk.session off before: safe mode keeps that.
    let flags = r#"{ "enabled": { "desk.session": false } }"#;
    fs::write(&store, flags).unwrap();

    // What a normal start turns on, to compare.
    let normal = Core::new(roots(&home)).with_plugin_store(store.clone());
    normal.install_plugins_in(&repo_plugins(), true);
    let on_normally: Vec<String> = listed(&normal)
        .iter()
        .filter(|p| p["enabled"] == true && !desk_policy(p))
        .map(|p| p["id"].as_str().unwrap().to_owned())
        .collect();
    assert!(on_normally.iter().any(|id| id == "desk.palette"));
    assert!(on_normally.iter().any(|id| id == "endue.formats"));

    let core = Core::new(roots(&home))
        .with_plugin_store(store.clone())
        .with_safe_mode(SafeReason::Asked);
    core.install_plugins_in(&repo_plugins(), true);

    let plugins = listed(&core);
    for plugin in &plugins {
        let id = plugin["id"].as_str().unwrap();
        if desk_policy(plugin) {
            assert_eq!(
                plugin["enabled"],
                id != "desk.session",
                "{id}: a desk.* policy keeps the person's flag"
            );
        } else {
            assert_eq!(plugin["enabled"], false, "{id} is held off in safe mode");
        }
    }
    assert_eq!(
        fs::read_to_string(&store).unwrap(),
        flags,
        "plugins.json is untouched"
    );

    let safe = core.safe_mode().expect("safe mode is on");
    assert_eq!(safe.reason, SafeReason::Asked);
    let mut held = safe.held_off.clone();
    held.sort();
    let mut expected = on_normally.clone();
    expected.sort();
    assert_eq!(held, expected, "held_off names the plugins that were on");
    assert!(Core::new(roots(&home)).safe_mode().is_none());
}

#[test]
fn turning_a_plugin_on_in_safe_mode_ends_its_hold() {
    let home = home("safe-mode-on");
    let store = home.join("data/plugins.json");
    let core = Core::new(roots(&home))
        .with_plugin_store(store.clone())
        .with_safe_mode(SafeReason::CrashLoop);
    core.install_plugins_in(&repo_plugins(), true);
    let palette = |core: &Core| {
        listed(core)
            .into_iter()
            .find(|p| p["id"] == "desk.palette")
            .unwrap()
    };
    assert_eq!(palette(&core)["enabled"], false);

    call(
        &core,
        "desk",
        "plugin.setEnabled",
        json!({ "plugin": "desk.palette", "enabled": true, "scope": plugin_manage() }),
    )
    .unwrap();

    assert_eq!(palette(&core)["enabled"], true, "on for this start");
    let flags: Value = serde_json::from_str(&fs::read_to_string(&store).unwrap()).unwrap();
    assert_eq!(flags["enabled"]["desk.palette"], true, "and remembered");
    assert_eq!(core.safe_mode().unwrap().reason, SafeReason::CrashLoop);
}
