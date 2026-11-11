//! Undo on the command registry (ADR 0077): an invocation of a command that names an `undo` lands on
//! one desk-level stack when its provider answers ok; cmd.undo runs the inverse with `{ args, result }`
//! and cmd.redo runs the command again; a write that kept a version lands there too, undone by
//! restoring that version.

mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const DELETE: &str = "example.notes.delete";
const RESTORE: &str = "example.notes.restore";
const ALL: &str = r#"{ "permission": "cmd:invoke", "ids": ["*"] }"#;

fn all() -> Value {
    serde_json::from_str(ALL).unwrap()
}

/// A core keeping a history in the home's data folder, `desk` holding cmd:invoke over every
/// command, example.notes providing `delete` (undone by `restore`) and `restore`, and the
/// deliveries the router sees.
fn desk(tag: &str) -> (Core, Receiver<Delivery>, std::path::PathBuf) {
    let home = home(tag);
    let core = Core::new(roots(&home)).with_history_dir(home.join(".data/history"));
    grant(&core, "desk", all());
    let register = |id: &str, undo: Option<&str>| {
        let mut params = json!({ "id": id, "title": id });
        if let Some(undo) = undo {
            params["undo"] = json!(undo);
        }
        call(&core, NOTES, "cmd.register", params).unwrap();
    };
    register(DELETE, Some(RESTORE));
    register(RESTORE, None);
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries, home)
}

/// Invoke `id` as `caller` and answer it as its provider with `answer` (`Err` for a failure).
fn run(core: &Core, caller: &str, id: &str, args: Value, answer: Result<Value, &str>) {
    let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
    let params = json!({ "id": id, "args": args, "scope": scope });
    let invoked = call(core, caller, "cmd.invoke", params).unwrap();
    let invocation = invoked["invocationId"].clone();
    let params = match answer {
        Ok(result) => json!({ "invocationId": invocation, "result": result }),
        Err(message) => {
            json!({ "invocationId": invocation, "error": { "code": "failed", "message": message } })
        }
    };
    call(core, NOTES, "cmd.answer", params).unwrap();
}

fn undo(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    call(core, caller, "cmd.undo", json!({ "scope": all() }))
}

fn redo(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    call(core, caller, "cmd.redo", json!({ "scope": all() }))
}

/// The args of the latest `cmd.invoked` of `id`.
fn invoked_args(deliveries: &Receiver<Delivery>, id: &str) -> Value {
    let invoked = named(deliveries, "cmd.invoked");
    let last = invoked.iter().rev().find(|d| d.data()["id"] == id);
    last.unwrap_or_else(|| panic!("no cmd.invoked of {id}"))
        .data()["args"]
        .clone()
}

#[test]
fn undo_runs_the_inverse_with_args_and_result_newest_first() {
    let (core, deliveries, _) = desk("undo-order");
    run(
        &core,
        "desk",
        DELETE,
        json!({ "name": "a" }),
        Ok(json!({ "kept": "trash/a" })),
    );
    run(
        &core,
        "desk",
        DELETE,
        json!({ "name": "b" }),
        Ok(json!({ "kept": "trash/b" })),
    );

    let first = undo(&core, "desk").unwrap();
    assert_eq!(first["undone"]["command"], DELETE);
    assert_eq!(first["undone"]["inverse"], RESTORE);
    assert_eq!(first["undone"]["caller"], "desk");
    assert!(first["invocationId"].is_string(), "{first}");
    assert_eq!(
        invoked_args(&deliveries, RESTORE),
        json!({ "args": { "name": "b" }, "result": { "kept": "trash/b" } })
    );
    undo(&core, "desk").unwrap();
    assert_eq!(
        invoked_args(&deliveries, RESTORE),
        json!({ "args": { "name": "a" }, "result": { "kept": "trash/a" } })
    );
    let empty = undo(&core, "desk").unwrap();
    assert!(empty.get("undone").is_none(), "{empty}");
}

#[test]
fn redo_runs_the_command_again_once_and_a_new_invocation_clears_it() {
    let (core, deliveries, _) = desk("undo-redo");
    run(
        &core,
        "desk",
        DELETE,
        json!({ "name": "a" }),
        Ok(json!({ "kept": "trash/a" })),
    );
    undo(&core, "desk").unwrap();
    let again = redo(&core, "desk").unwrap();
    assert_eq!(again["undone"]["command"], DELETE);
    assert_eq!(invoked_args(&deliveries, DELETE), json!({ "name": "a" }));
    let invocation = again["invocationId"].clone();
    call(
        &core,
        NOTES,
        "cmd.answer",
        json!({ "invocationId": invocation, "result": { "kept": "trash/a2" } }),
    )
    .unwrap();
    assert!(
        redo(&core, "desk").unwrap().get("undone").is_none(),
        "redone once"
    );
    // The redone invocation is on the stack again.
    undo(&core, "desk").unwrap();
    assert_eq!(
        invoked_args(&deliveries, RESTORE),
        json!({ "args": { "name": "a" }, "result": { "kept": "trash/a2" } })
    );
    // A new invocation clears what is left to redo.
    run(
        &core,
        "desk",
        DELETE,
        json!({ "name": "b" }),
        Ok(json!({ "kept": "trash/b" })),
    );
    assert!(redo(&core, "desk").unwrap().get("undone").is_none());
}

#[test]
fn a_command_without_undo_is_not_pushed() {
    let (core, _, _) = desk("undo-none");
    call(
        &core,
        NOTES,
        "cmd.register",
        json!({ "id": "example.notes.save", "title": "Save" }),
    )
    .unwrap();
    run(
        &core,
        "desk",
        "example.notes.save",
        json!({}),
        Ok(json!("saved")),
    );
    // A failed answer of an undoable command is not pushed either.
    run(
        &core,
        "desk",
        DELETE,
        json!({ "name": "a" }),
        Err("no such note"),
    );
    assert!(undo(&core, "desk").unwrap().get("undone").is_none());
}

#[test]
fn a_write_then_undo_restores_the_bytes_and_redo_puts_them_back() {
    let (core, _, home) = desk("undo-write");
    let write = json!({ "permission": "fs:write", "paths": ["~/Documents/**"] });
    grant(&core, NOTES, write.clone());
    let file = home.join("Documents/hello.md");
    let params = json!({ "path": "~/Documents/hello.md", "content": "# Changed", "scope": write });
    call(&core, NOTES, "fs.write", params).unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "# Changed");

    let undone = undo(&core, "desk").unwrap();
    assert_eq!(undone["undone"]["command"], "fs.write");
    assert_eq!(undone["undone"]["inverse"], "fs.restore");
    assert_eq!(undone["undone"]["caller"], NOTES);
    assert_eq!(undone["undone"]["args"]["path"], "~/Documents/hello.md");
    assert_eq!(fs::read_to_string(&file).unwrap(), "# Hello");
    redo(&core, "desk").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "# Changed");
    undo(&core, "desk").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "# Hello");
}

#[test]
fn the_stack_is_the_desks_not_the_callers() {
    let (core, deliveries, _) = desk("undo-desk");
    grant(
        &core,
        "example.one",
        json!({ "permission": "cmd:invoke", "ids": ["example.notes.*"] }),
    );
    run(
        &core,
        "example.one",
        DELETE,
        json!({ "name": "a" }),
        Ok(json!({ "kept": "trash/a" })),
    );
    // Another caller, holding only the inverse, undoes what example.one did.
    let narrow = json!({ "permission": "cmd:invoke", "ids": [RESTORE] });
    grant(&core, "example.two", narrow.clone());
    let undone = call(&core, "example.two", "cmd.undo", json!({ "scope": narrow })).unwrap();
    assert_eq!(undone["undone"]["caller"], "example.one");
    assert_eq!(
        invoked_args(&deliveries, RESTORE)["args"],
        json!({ "name": "a" })
    );
}

#[test]
fn undo_needs_a_cmd_invoke_scope_covering_the_inverse() {
    let (core, _, _) = desk("undo-scope");
    run(
        &core,
        "desk",
        DELETE,
        json!({ "name": "a" }),
        Ok(json!({ "kept": "trash/a" })),
    );
    let other = json!({ "permission": "cmd:invoke", "ids": ["example.other.*"] });
    grant(&core, "example.weak", other.clone());
    let refused = call(&core, "example.weak", "cmd.undo", json!({ "scope": other }));
    assert_eq!(refused.unwrap_err().code, ErrorCode::PermissionDenied);
    let stranger = call(&core, "example.none", "cmd.undo", json!({ "scope": all() }));
    assert_eq!(stranger.unwrap_err().code, ErrorCode::PermissionDenied);
    // The entry stayed.
    assert_eq!(undo(&core, "desk").unwrap()["undone"]["command"], DELETE);
}

/// Register `id`, undone by `inverse`, and `inverse` with `args_schema` (none: unchecked args).
fn register_pair(core: &Core, id: &str, inverse: &str, args_schema: Option<Value>) {
    let params = json!({ "id": id, "title": id, "undo": inverse });
    call(core, NOTES, "cmd.register", params).unwrap();
    let mut params = json!({ "id": inverse, "title": inverse });
    if let Some(schema) = args_schema {
        params["argsSchema"] = schema;
    }
    call(core, NOTES, "cmd.register", params).unwrap();
}

#[test]
fn an_entry_whose_inverse_cannot_run_leaves_the_stack_and_the_one_before_is_next() {
    let (core, deliveries, _) = desk("undo-blocked");
    // An inverse whose declared args refuse the { args, result } cmd.undo hands it.
    let none = json!({ "type": "object", "properties": {}, "additionalProperties": false });
    register_pair(
        &core,
        "example.notes.tile",
        "example.notes.untile",
        Some(none),
    );
    // An inverse that is gone by the time of the undo (its plugin turned off).
    register_pair(&core, "example.notes.pin", "example.notes.unpin", None);
    let ok = |id: &str, n: i64| run(&core, "desk", id, json!({ "n": n }), Ok(json!(n)));
    ok(DELETE, 1);
    ok("example.notes.pin", 2);
    ok("example.notes.tile", 3);
    call(
        &core,
        NOTES,
        "cmd.unregister",
        json!({ "id": "example.notes.unpin" }),
    )
    .unwrap();

    let refused = undo(&core, "desk").unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidParams, "{refused:?}");
    assert!(
        refused.message.contains("example.notes.tile"),
        "{refused:?}"
    );
    let gone = undo(&core, "desk").unwrap_err();
    assert_eq!(gone.code, ErrorCode::NotFound, "{gone:?}");
    assert!(gone.message.contains("example.notes.pin"), "{gone:?}");
    // Neither blocks the entry before them, and neither waits on the redo side.
    let undone = undo(&core, "desk").unwrap();
    assert_eq!(undone["undone"]["command"], DELETE);
    assert_eq!(
        invoked_args(&deliveries, RESTORE),
        json!({ "args": { "n": 1 }, "result": 1 })
    );
    assert_eq!(redo(&core, "desk").unwrap()["undone"]["command"], DELETE);
    assert!(redo(&core, "desk").unwrap().get("undone").is_none());
}

#[test]
fn the_stack_keeps_200_entries() {
    let (core, _, _) = desk("undo-200");
    for n in 0..205 {
        run(&core, "desk", DELETE, json!({ "name": n }), Ok(json!(n)));
    }
    for n in (5..205).rev() {
        assert_eq!(undo(&core, "desk").unwrap()["undone"]["args"]["name"], n);
    }
    assert!(undo(&core, "desk").unwrap().get("undone").is_none());
}

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
