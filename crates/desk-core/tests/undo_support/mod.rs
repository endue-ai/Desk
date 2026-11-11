//! What the undo tests share (ADR 0077): a core keeping a history, `desk` holding cmd:invoke over
//! every command, example.notes providing `delete` (undone by `restore`) and `restore`, and the
//! calls that invoke and answer a command, undo, redo and read what a provider was handed. A test
//! file declares `mod support;` beside `mod undo_support;`.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::mpsc::Receiver;

use desk_bridge::BridgeError;
use desk_core::{Core, Delivery};
use serde_json::{Value, json};

use super::support::*;

pub const DELETE: &str = "example.notes.delete";
pub const RESTORE: &str = "example.notes.restore";
const ALL: &str = r#"{ "permission": "cmd:invoke", "ids": ["*"] }"#;

pub fn all() -> Value {
    serde_json::from_str(ALL).unwrap()
}

/// A core keeping a history in the home's data folder, `desk` holding cmd:invoke over every
/// command, example.notes providing `delete` (undone by `restore`) and `restore`, and the
/// deliveries the router sees.
pub fn desk(tag: &str) -> (Core, Receiver<Delivery>, PathBuf) {
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
pub fn run(core: &Core, caller: &str, id: &str, args: Value, answer: Result<Value, &str>) {
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

pub fn undo(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    call(core, caller, "cmd.undo", json!({ "scope": all() }))
}

pub fn redo(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    call(core, caller, "cmd.redo", json!({ "scope": all() }))
}

/// The args of the latest `cmd.invoked` of `id`.
pub fn invoked_args(deliveries: &Receiver<Delivery>, id: &str) -> Value {
    let invoked = named(deliveries, "cmd.invoked");
    let last = invoked.iter().rev().find(|d| d.data()["id"] == id);
    last.unwrap_or_else(|| panic!("no cmd.invoked of {id}"))
        .data()["args"]
        .clone()
}
