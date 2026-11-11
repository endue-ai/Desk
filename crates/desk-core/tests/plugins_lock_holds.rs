//! Holds for this run against plugins.lock (ADR 0061, ADR 0079, ADR 0187): plugin.list names why a
//! plugin is off for this run only (`heldOff`: init, safe-mode, quarantine), the lock keeps the
//! remembered choice, and `desk_core::lock::plan`, what `desk plugin sync` does, leaves a held plugin
//! as it is. A sync right after a start therefore changes nothing.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_core::lock::{self, Plan};
use desk_core::{Core, SafeReason};
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

fn plugin(parent: &Path, folder: &str, id: &str) -> PathBuf {
    let dir = parent.join(folder);
    fs::create_dir_all(dir.join("ui")).unwrap();
    let manifest = json!({ "id": id, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(dir.join("ui/index.html"), format!("<p>{id}</p>")).unwrap();
    dir
}

/// A desk with init.yaml holding example.b off, its lock at `~/.desk/plugins.lock`.
fn desk(tag: &str, init: &str) -> (Core, PathBuf, PathBuf) {
    let home = home(tag);
    fs::create_dir_all(home.join(".desk")).unwrap();
    let init_file = home.join(".desk/init.yaml");
    fs::write(&init_file, init).unwrap();
    let lock = home.join(".desk/plugins.lock");
    let core = Core::new(roots(&home))
        .with_init_file(init_file)
        .with_plugin_store(home.join(".data/plugins.json"))
        .with_lock_file(lock.clone());
    grant(&core, "desk", plugin_manage());
    (core, home, lock)
}

fn listed(core: &Core, id: &str) -> Value {
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
        .find(|p| p["id"] == id)
        .unwrap()
        .clone()
}

fn install(core: &Core, home: &Path) {
    let parent = home.join("plugins");
    for (folder, id) in [("a", "example.a"), ("b", "example.b")] {
        core.install_plugin(&plugin(&parent, folder, id), false);
    }
}

const HOLDS_B: &str = "version: 0\nplugins:\n  disabled: [example.b]\n";

#[test]
fn a_sync_right_after_a_start_with_init_holds_changes_nothing() {
    let (core, home, lock_file) = desk("holds-init", HOLDS_B);
    install(&core, &home);

    let b = listed(&core, "example.b");
    assert_eq!(b["enabled"], false);
    assert_eq!(b["heldOff"], "init", "{b}");
    assert!(listed(&core, "example.a").get("heldOff").is_none());

    let written = lock::parse(&fs::read_to_string(&lock_file).unwrap()).unwrap();
    let line = written
        .plugins
        .iter()
        .find(|p| p.id == "example.b")
        .unwrap();
    assert!(
        line.enabled,
        "the lock keeps the remembered choice, holds aside"
    );

    let plan = lock::plan(&written, &core.plugins());
    assert_eq!(plan, Plan::default(), "nothing to turn on or off");
}

#[test]
fn a_sync_leaves_safe_modes_holds_alone() {
    let home = home("holds-safe");
    let lock_file = home.join(".desk/plugins.lock");
    let core = Core::new(roots(&home))
        .with_plugin_store(home.join(".data/plugins.json"))
        .with_lock_file(lock_file.clone())
        .with_safe_mode(SafeReason::Asked);
    grant(&core, "desk", plugin_manage());
    install(&core, &home);

    assert_eq!(listed(&core, "example.a")["heldOff"], "safe-mode");
    let written = lock::parse(&fs::read_to_string(&lock_file).unwrap()).unwrap();
    assert!(written.plugins.iter().all(|p| p.enabled));
    assert_eq!(lock::plan(&written, &core.plugins()), Plan::default());
}

#[test]
fn a_quarantined_plugin_is_listed_as_held_by_its_quarantine() {
    let home = home("holds-quarantine");
    let data = home.join("data");
    fs::create_dir_all(&data).unwrap();
    let store = json!({ "desk": { "plugins.quarantined": [
        { "id": "example.a", "version": "0.1.0", "at": "2026-11-02T09:00:00Z" }
    ] } });
    fs::write(data.join("store.json"), store.to_string()).unwrap();
    let core = Core::new(roots(&home))
        .with_store_file(data.join("store.json"))
        .with_plugin_store(data.join("plugins.json"));
    grant(&core, "desk", plugin_manage());
    install(&core, &home);
    assert_eq!(listed(&core, "example.a")["heldOff"], "quarantine");
    assert!(listed(&core, "example.b").get("heldOff").is_none());
}

#[test]
fn a_lock_that_says_off_turns_off_the_rest_and_leaves_a_held_plugin_as_it_is() {
    // The held one is off already; a sync after a start without the hold turns it off for good.
    let (core, home, lock_file) = desk("holds-off", HOLDS_B);
    install(&core, &home);
    let mut written = lock::parse(&fs::read_to_string(&lock_file).unwrap()).unwrap();
    for line in &mut written.plugins {
        line.enabled = false;
    }
    let plan = lock::plan(&written, &core.plugins());
    assert_eq!(plan.disable, ["example.a"], "the held one is off already");
    assert!(plan.enable.is_empty());
}

#[test]
fn turning_a_held_plugin_on_ends_its_hold() {
    let (core, home, _) = desk("holds-on", HOLDS_B);
    install(&core, &home);
    let params = json!({ "plugin": "example.b", "enabled": true, "scope": plugin_manage() });
    call(&core, "desk", "plugin.setEnabled", params).unwrap();
    let b = listed(&core, "example.b");
    assert_eq!(b["enabled"], true);
    assert!(b.get("heldOff").is_none(), "{b}");
}
