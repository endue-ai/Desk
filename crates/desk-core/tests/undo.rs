//! Undo on the command registry (ADR 0077): an invocation of a command that names an `undo` lands on
//! one desk-level stack when its provider answers ok; cmd.undo runs the inverse with `{ args, result }`
//! and cmd.redo runs the command again; a write that kept a version lands there too, undone by
//! restoring that version. How a command names its undo, and who hears of one: `undo_declared.rs`.

mod support;
mod undo_support;

use std::fs;

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;
use undo_support::*;

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
