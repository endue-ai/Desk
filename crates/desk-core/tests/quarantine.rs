//! Quarantine (ADR 0061): the runtime lists UI plugins whose frame failed three starts in a row
//! under `desk`'s store key `plugins.quarantined`, as `{ id, version, at }`. At install the core holds
//! such a plugin off for the run, as long as the installed version is the one that failed; a new
//! version is not held. plugins.json is never written for it.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

fn hello(parent: &Path, version: &str) -> PathBuf {
    let dir = parent.join("plugins/hello");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(
        dir.join("plugin.json"),
        json!({ "id": "example.hello", "version": version, "kind": "ui", "entry": "ui/index.html",
                "surfaces": [{ "id": "main", "title": "Hello", "placement": "center" }] })
        .to_string(),
    )
    .unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    dir
}

/// A data folder whose store lists example.hello 0.1.0 as quarantined.
fn data_folder(home: &Path) -> PathBuf {
    let data = home.join("data");
    fs::create_dir_all(&data).unwrap();
    let store = json!({ "desk": { "plugins.quarantined": [
        { "id": "example.hello", "version": "0.1.0", "at": "2026-11-02T09:00:00Z" }
    ] } });
    fs::write(data.join("store.json"), store.to_string()).unwrap();
    data
}

fn enabled(core: &Core) -> Value {
    grant(core, "desk", plugin_manage());
    let list = call(
        core,
        "desk",
        "plugin.list",
        json!({ "scope": plugin_manage() }),
    )
    .unwrap();
    list["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "example.hello")
        .unwrap()["enabled"]
        .clone()
}

#[test]
fn a_quarantined_plugin_is_held_off_until_its_version_changes() {
    let home = home("quarantine");
    let data = data_folder(&home);

    let core = Core::new(roots(&home))
        .with_store_file(data.join("store.json"))
        .with_plugin_store(data.join("plugins.json"));
    core.install_plugin(&hello(&home, "0.1.0"), false);
    assert_eq!(enabled(&core), false, "the version that failed is held off");
    assert!(
        !data.join("plugins.json").exists(),
        "plugins.json is not written"
    );

    // The person turns it on: it runs, and that is their choice to remember.
    call(
        &core,
        "desk",
        "plugin.setEnabled",
        json!({ "plugin": "example.hello", "enabled": true, "scope": plugin_manage() }),
    )
    .unwrap();
    assert_eq!(enabled(&core), true);

    // A new version is not held, even with the old entry still in the store.
    let other = home.join("other");
    let data = data_folder(&other);
    let updated = Core::new(roots(&other))
        .with_store_file(data.join("store.json"))
        .with_plugin_store(data.join("plugins.json"));
    updated.install_plugin(&hello(&other, "0.2.0"), false);
    assert_eq!(enabled(&updated), true, "a new version starts on");
}
