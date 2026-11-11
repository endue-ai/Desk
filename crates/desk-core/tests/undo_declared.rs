//! How a command's undo is named and heard (ADR 0077): cmd.list names the inverse, a manifest's
//! `undo` applies to the command its plugin registers, and cmd.undone reaches the undoer and the
//! subscribers. The stack itself (undo, redo, its scope and its size): `undo.rs`.

mod support;
mod undo_support;

use std::fs;
use std::path::Path;

use desk_core::Core;
use serde_json::json;
use support::*;
use undo_support::*;

#[test]
fn cmd_list_names_the_inverse() {
    let (core, _, _) = desk("undo-list");
    let listed = call(&core, "desk", "cmd.list", json!({ "scope": all() })).unwrap();
    let commands = listed["commands"].as_array().unwrap();
    let of = |id: &str| commands.iter().find(|c| c["id"] == id).unwrap().clone();
    assert_eq!(of(DELETE)["undo"], RESTORE);
    assert!(of(RESTORE).get("undo").is_none());
}

#[test]
fn cmd_undone_reaches_the_undoer_and_subscribers() {
    let (core, deliveries, _) = desk("undo-event");
    let watch = json!({ "permission": "events:subscribe", "names": ["cmd.undone"] });
    grant(&core, "example.watch", watch.clone());
    let params = json!({ "names": ["cmd.undone"], "scope": watch });
    call(&core, "example.watch", "events.subscribe", params).unwrap();
    run(
        &core,
        "desk",
        DELETE,
        json!({ "name": "a" }),
        Ok(json!({ "kept": "trash/a" })),
    );
    undo(&core, "desk").unwrap();
    let undone = named(&deliveries, "cmd.undone");
    assert_eq!(undone.len(), 1, "{undone:?}");
    assert!(undone[0].is_for("desk") && undone[0].is_for("example.watch"));
    assert!(!undone[0].is_for("example.other"));
    assert_eq!(undone[0].data()["by"], "desk");
    assert_eq!(undone[0].data()["redo"], false);
    assert_eq!(undone[0].data()["entry"]["command"], DELETE);
}

/// A plugin whose manifest names `undo` for a command it then registers without one.
fn plugin_with_undo(core: &Core, home: &Path) {
    let dir = home.join("plugins/trash");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>trash</p>").unwrap();
    let manifest = json!({ "id": "example.trash", "version": "0.1.0", "kind": "ui",
        "entry": "ui/index.html", "contributes": { "commands": [
            { "id": "example.trash.empty", "title": "Empty", "undo": "example.trash.refill" },
            { "id": "example.trash.refill", "title": "Refill" } ] } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    for id in ["example.trash.empty", "example.trash.refill"] {
        call(
            core,
            "example.trash",
            "cmd.register",
            json!({ "id": id, "title": id }),
        )
        .unwrap();
    }
}

#[test]
fn a_manifests_undo_applies_to_the_command_its_plugin_registers() {
    let (core, deliveries, home) = desk("undo-manifest");
    plugin_with_undo(&core, &home);
    let listed = call(
        &core,
        "desk",
        "cmd.list",
        json!({ "scope": { "permission": "cmd:invoke", "ids": ["example.trash.*"] } }),
    )
    .unwrap();
    let empty = listed["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "example.trash.empty")
        .cloned()
        .unwrap();
    assert_eq!(empty["undo"], "example.trash.refill");

    let invoked = call(
        &core,
        "desk",
        "cmd.invoke",
        json!({ "id": "example.trash.empty", "scope": all() }),
    )
    .unwrap();
    call(
        &core,
        "example.trash",
        "cmd.answer",
        json!({ "invocationId": invoked["invocationId"], "result": 3 }),
    )
    .unwrap();
    assert_eq!(
        undo(&core, "desk").unwrap()["undone"]["inverse"],
        "example.trash.refill"
    );
    assert_eq!(
        invoked_args(&deliveries, "example.trash.refill"),
        json!({ "args": {}, "result": 3 })
    );
}
