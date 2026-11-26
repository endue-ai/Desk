//! A built-in save has to authenticate the invocation before it can write its named file.

mod common;
mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;

use desk_brain_endue::HttpBrain;
use desk_bridge::ErrorCode;
use desk_core::{BrainOptions, Core};
use serde_json::{Value, json};
use support::{
    NeverAsk, approve_as_desk, call, grant, home, manage, notes_read, plugin_manage, roots,
    set_enabled, wait_for,
};

const SHEETS: &str = "endue.sheets";
const SAVE: &str = "endue.sheets.save";
const AGENT: &str = "agent:mira";
const FILE: &str = "~/Documents/fixture.csv";
const ORIGINAL: &str = "Name,Count\nExample,1\n";
const UPDATED: &str = "Name,Count\nExample,2\n";

fn scope() -> Value {
    json!({ "permission": "fs:write", "paths": [FILE] })
}

fn write(invocation: &str) -> Value {
    json!({ "path": FILE, "content": UPDATED, "scope": scope(), "invocationId": invocation })
}

fn installed(root: &Path) -> Core {
    fs::write(root.join("Documents/fixture.csv"), ORIGINAL).unwrap();
    let core = Core::new(roots(root))
        .with_history_dir(root.join("history"))
        .with_prompter(NeverAsk);
    let plugin = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/sheets");
    assert!(core.install_plugin(&plugin, true).built_in);
    grant(&core, "desk", plugin_manage());
    grant(&core, "desk", manage());
    grant(&core, "desk", notes_read());
    set_enabled(&core, SHEETS, true);
    grant(&core, AGENT, command_scope());
    call(
        &core,
        SHEETS,
        "cmd.register",
        json!({ "id": SAVE, "title": "Save edits" }),
    )
    .unwrap();
    core
}

fn command_scope() -> Value {
    json!({ "permission": "cmd:invoke", "ids": [SAVE] })
}

fn request(core: &Core) -> String {
    call(
        core,
        AGENT,
        "cmd.invoke",
        json!({ "id": SAVE, "args": { "path": FILE }, "scope": command_scope() }),
    )
    .unwrap()["invocationId"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn a_fabricated_save_invocation_cannot_fall_back_to_a_plugin_grant() {
    let root = home("sheets-forged-save");
    let path = root.join("Documents/fixture.csv");
    fs::write(&path, ORIGINAL).unwrap();
    let core = Core::new(roots(&root));
    grant(&core, SHEETS, scope());
    let denied = call(&core, SHEETS, "fs.write", write("i-forged")).unwrap_err();
    assert_eq!(denied.code, ErrorCode::InvalidParams);
    assert_eq!(fs::read_to_string(path).unwrap(), ORIGINAL);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_named_save_uses_the_agents_grant_and_version_once() {
    let root = home("sheets-versioned-save");
    let core = installed(&root);
    grant(&core, AGENT, scope());
    let id = request(&core);
    let mut wrong = write(&id);
    wrong["path"] = json!("~/Documents/hello.md");
    wrong["scope"]["paths"] = json!(["~/Documents/hello.md"]);
    assert_eq!(
        call(&core, SHEETS, "fs.write", wrong).unwrap_err().code,
        ErrorCode::InvalidParams
    );
    let saved = call(&core, SHEETS, "fs.write", write(&id)).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Documents/fixture.csv")).unwrap(),
        UPDATED
    );
    let history = call(
        &core,
        "desk",
        "fs.history",
        json!({ "path": FILE, "scope": notes_read() }),
    )
    .unwrap();
    assert_eq!(history["versions"][0]["id"], saved["version"]);
    assert_eq!(history["versions"][0]["caller"], AGENT);
    assert_eq!(
        call(&core, SHEETS, "fs.write", write(&id))
            .unwrap_err()
            .code,
        ErrorCode::InvalidParams
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_save_without_an_agent_grant_uses_the_core_review() {
    let root = home("sheets-review-save");
    let core = installed(&root);
    let events = core.events().subscribe_addressed();
    let id = request(&core);
    std::thread::scope(|threads| {
        let write = threads.spawn(|| call(&core, SHEETS, "fs.write", write(&id)));
        let approval = wait_for(&events, "perm.approval");
        assert_eq!(approval.data()["caller"], AGENT);
        assert_eq!(approval.data()["action"], "fs.write");
        assert_eq!(approval.data()["target"], FILE);
        approve_as_desk(&core, &approval, "deny");
        assert_eq!(
            write.join().unwrap().unwrap_err().code,
            ErrorCode::PermissionDenied
        );
    });
    assert_eq!(
        fs::read_to_string(root.join("Documents/fixture.csv")).unwrap(),
        ORIGINAL
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_delegated_turn_returns_the_agents_versioned_undo_receipt() {
    let root = home("sheets-turn-save");
    let echo = common::Echo::start();
    let core = Arc::new(installed(&root).with_brain(
        Arc::new(HttpBrain::new(echo.url()).unwrap()),
        BrainOptions::default(),
    ));
    core.route_tools();
    grant(&core, AGENT, scope());
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    let events = core.events().subscribe_addressed();
    call(
        &core,
        "desk",
        "brain.say",
        json!({
            "text": format!("tool endue_sheets_save as mira: {}", json!({ "path": FILE })),
            "scope": { "permission": "brain:converse" }
        }),
    )
    .unwrap();
    let invoked = wait_for(&events, "cmd.invoked");
    let id = invoked.data()["invocationId"].as_str().unwrap();
    let result = call(&core, SHEETS, "fs.write", write(id)).unwrap();
    let receipt = wait_for(&events, "perm.approval.done");
    assert_eq!(receipt.data()["change"], "file-saved");
    assert_eq!(receipt.data()["path"], FILE);
    assert_eq!(receipt.data()["undoable"], true);
    call(
        &core,
        SHEETS,
        "cmd.answer",
        json!({ "invocationId": id, "result": result }),
    )
    .unwrap();
    call(
        &core,
        "desk",
        "perm.undoApproval",
        json!({ "approvalId": receipt.data()["approvalId"], "scope": manage() }),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Documents/fixture.csv")).unwrap(),
        ORIGINAL
    );
    fs::remove_dir_all(root).unwrap();
}
