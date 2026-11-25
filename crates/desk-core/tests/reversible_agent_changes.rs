//! A covering grant lets an agent make reversible changes with a bound Undo (EP-07).

mod support;

use std::fs;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use desk_bridge::ErrorCode;
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const ERIS: &str = "agent:eris";
const FILE: &str = "~/Documents/hello.md";

fn set_grant(core: &Core, permission: Value, duration: &str) {
    call(
        core,
        "desk",
        "perm.grant",
        json!({ "caller": ERIS, "permission": permission, "duration": duration, "scope": manage() }),
    )
    .unwrap();
}

fn folder_write() -> Value {
    json!({ "permission": "fs:write", "paths": ["~/Documents/**"] })
}

/// Deny a surprise question so that an implementation that still asks can fail the assertion.
fn completed(core: &Core, events: &Receiver<Delivery>, method: &str, params: Value) -> Value {
    std::thread::scope(|scope| {
        let acting = scope.spawn(|| call(core, ERIS, method, params));
        while !acting.is_finished() {
            let Ok(delivery) = events.recv_timeout(Duration::from_millis(25)) else {
                continue;
            };
            let event = Seen {
                to: delivery.to,
                event: serde_json::to_value(delivery.event).unwrap(),
            };
            match event.name() {
                "perm.approval" => approve_as_desk(core, &event, "deny"),
                "perm.prompt" => {
                    call(
                        core,
                        "desk",
                        "perm.answer",
                        json!({ "promptId": event.data()["promptId"], "granted": false, "scope": manage() }),
                    )
                    .unwrap();
                }
                "perm.approval.done" => {
                    acting.join().unwrap().unwrap();
                    return event.event["data"].clone();
                }
                _ => {}
            }
        }
        acting.join().unwrap().unwrap();
        wait_for(events, "perm.approval.done").event["data"].clone()
    })
}

fn undo_params(receipt: &Value) -> Value {
    assert_eq!(receipt["undoable"], true);
    json!({ "approvalId": receipt["approvalId"], "scope": manage() })
}

#[test]
fn a_versioned_overwrite_uses_any_grant_duration() {
    for duration in ["once", "session", "always"] {
        let root = home(duration);
        let core = Core::new(roots(&root))
            .with_history_dir(root.join("history"))
            .with_prompter(NeverAsk);
        grant(&core, "desk", manage());
        set_grant(&core, folder_write(), duration);
        let events = core.events().subscribe_addressed();
        let receipt = completed(
            &core,
            &events,
            "fs.write",
            json!({ "path": FILE, "content": "new text", "scope": folder_write() }),
        );
        assert_eq!(receipt["change"], "file-saved");
        assert_eq!(receipt["path"], FILE);
        assert_eq!(query(&core, ERIS).is_empty(), duration == "once");
        call(&core, "desk", "perm.undoApproval", undo_params(&receipt)).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("Documents/hello.md")).unwrap(),
            "# Hello"
        );
    }
}

#[test]
fn a_new_file_receipt_removes_its_file_and_empty_parents_but_not_later_edits() {
    let root = home("undo-new-file");
    let core = Core::new(roots(&root)).with_prompter(NeverAsk);
    grant(&core, "desk", manage());
    set_grant(&core, folder_write(), "session");
    let events = core.events().subscribe_addressed();
    let write = |path| {
        completed(
            &core,
            &events,
            "fs.write",
            json!({ "path": path, "content": "first", "createDirs": true, "scope": folder_write() }),
        )
    };
    let created = write("~/Documents/new/sub/first.txt");
    assert_eq!(created["change"], "file-created");
    call(&core, "desk", "perm.undoApproval", undo_params(&created)).unwrap();
    assert!(!root.join("Documents/new").exists());
    let later = write("~/Documents/later.txt");
    let path = root.join("Documents/later.txt");
    fs::write(&path, "changed later").unwrap();
    assert!(call(&core, "desk", "perm.undoApproval", undo_params(&later)).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "changed later");
}

#[test]
fn facts_can_be_added_and_edited_without_losing_unrelated_or_newer_facts() {
    let root = home("undo-fact");
    let core = Core::new(roots(&root))
        .with_memory_dir(root.join("memory"))
        .with_prompter(NeverAsk);
    grant(&core, "desk", manage());
    let scope = json!({ "permission": "memory:write" });
    set_grant(&core, scope.clone(), "session");
    let events = core.events().subscribe_addressed();
    let added = completed(
        &core,
        &events,
        "memory.remember",
        json!({ "text": "a fixture fact", "tags": ["first"], "scope": scope }),
    );
    assert_eq!(added["change"], "fact-remembered");
    assert!(added.get("path").is_none());
    let memory = core.memory().unwrap();
    let fact = memory.list(None, 10, None).unwrap().entries.remove(0);
    let id = serde_json::to_value(&fact).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let other = memory.remember("another fixture", None, "person").unwrap();
    let edit = || {
        completed(
            &core,
            &events,
            "memory.remember",
            json!({ "id": id, "text": "adjusted fact", "tags": ["changed"], "scope": scope }),
        )
    };
    let edited = edit();
    assert_eq!(edited["change"], "fact-edited");
    call(&core, "desk", "perm.undoApproval", undo_params(&edited)).unwrap();
    assert_eq!(memory.get(&id).unwrap(), fact);
    let edited = edit();
    memory.edit(&id, "later edit", None).unwrap();
    assert!(call(&core, "desk", "perm.undoApproval", undo_params(&edited)).is_err());
    assert!(call(&core, "desk", "perm.undoApproval", undo_params(&added)).is_err());
    assert!(memory.get(&other.id).is_ok());
    let added = completed(
        &core,
        &events,
        "memory.remember",
        json!({ "text": "temporary fact", "scope": scope }),
    );
    call(&core, "desk", "perm.undoApproval", undo_params(&added)).unwrap();
    assert!(memory.search("temporary", None, 10).unwrap().is_empty());
}

#[test]
fn append_unversioned_overwrite_and_fetch_still_wait_under_always_grants() {
    let root = home("irreversible-under-grant");
    let core = Core::new(roots(&root)).with_prompter(NeverAsk);
    grant(&core, "desk", manage());
    set_grant(&core, folder_write(), "always");
    let hosts = json!({ "permission": "net:fetch", "hosts": ["example.test"] });
    set_grant(&core, hosts.clone(), "always");
    let events = core.events().subscribe_addressed();
    for (method, params) in [
        (
            "fs.write",
            json!({ "path": FILE, "content": "added", "append": true, "scope": folder_write() }),
        ),
        (
            "fs.write",
            json!({ "path": FILE, "content": "unversioned", "scope": folder_write() }),
        ),
        (
            "net.fetch",
            json!({ "url": "https://example.test/", "scope": hosts }),
        ),
    ] {
        std::thread::scope(|scope| {
            let acting = scope.spawn(|| call(&core, ERIS, method, params));
            while !acting.is_finished() {
                let Ok(delivery) = events.recv_timeout(Duration::from_millis(25)) else {
                    continue;
                };
                let event = Seen {
                    to: delivery.to,
                    event: serde_json::to_value(delivery.event).unwrap(),
                };
                if event.name() == "perm.approval" {
                    approve_as_desk(&core, &event, "deny");
                    assert_eq!(
                        acting.join().unwrap().unwrap_err().code,
                        ErrorCode::PermissionDenied
                    );
                    return;
                }
            }
            panic!(
                "expected approval for {method}: {:?}",
                acting.join().unwrap()
            );
        });
    }
    assert_eq!(
        fs::read_to_string(root.join("Documents/hello.md")).unwrap(),
        "# Hello"
    );
}
