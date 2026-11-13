//! What waits for the person (ADR 0204): perm.pending lists the prompts and approvals nobody has
//! answered, oldest first, and perm.settled tells every perm:manage holder when one stops waiting,
//! whichever holder answered it, or when its caller unloads.

mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const MIRA: &str = "agent:mira";
const NOTES_ONLY: &str =
    "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n";

/// A core whose Prompter must never be asked, `desk` and the permissions plugin holding perm:manage.
fn prompted(home: &Path) -> (Core, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, NOTES_ONLY).unwrap();
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file);
    for holder in ["desk", "endue.permissions"] {
        grant(&core, holder, manage());
    }
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn pending(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    call(core, caller, "perm.pending", json!({ "scope": manage() }))
}

fn ids(list: &Value, key: &str) -> Vec<String> {
    let items = list.as_array().unwrap();
    items
        .iter()
        .map(|i| i[key].as_str().unwrap().to_owned())
        .collect()
}

fn ask(core: &Core, caller: &str, permission: Value) -> Result<Value, BridgeError> {
    let params = json!({ "permission": permission, "reason": "To read it" });
    call(core, caller, "perm.request", params)
}

#[test]
fn what_waits_is_listed_oldest_first_and_settles_whoever_answers() {
    let home = home("pending-prompts");
    let (core, deliveries) = prompted(&home);
    assert_eq!(
        pending(&core, "desk").unwrap(),
        json!({ "prompts": [], "approvals": [] })
    );
    std::thread::scope(|s| {
        let notes = s.spawn(|| ask(&core, NOTES, notes_read()));
        let first = wait_for(&deliveries, "perm.prompt").data().clone();
        let calendar = s.spawn(|| ask(&core, CALENDAR, calendar_read()));
        let second = wait_for(&deliveries, "perm.prompt").data().clone();

        let waiting = pending(&core, "endue.permissions").unwrap();
        assert_eq!(
            waiting["prompts"],
            json!([first, second]),
            "as perm.prompt said them"
        );
        assert_eq!(waiting["approvals"], json!([]));

        // The island answers the second; the permissions plugin hears that it settled.
        let answer = json!({ "promptId": second["promptId"], "granted": false, "scope": manage() });
        call(&core, "desk", "perm.answer", answer).unwrap();
        let settled = wait_for(&deliveries, "perm.settled");
        assert_eq!(settled.to, strings(&["desk", "endue.permissions"]));
        assert_eq!(
            settled.data(),
            &json!({ "kind": "prompt", "id": second["promptId"] })
        );
        assert_eq!(
            ids(&pending(&core, "desk").unwrap()["prompts"], "promptId"),
            [first["promptId"].as_str().unwrap()]
        );
        assert_eq!(
            calendar.join().unwrap().unwrap(),
            json!({ "granted": false })
        );

        let answer = json!({ "promptId": first["promptId"], "granted": true, "scope": manage() });
        call(&core, "endue.permissions", "perm.answer", answer).unwrap();
        let settled = wait_for(&deliveries, "perm.settled");
        assert_eq!(settled.data()["id"], first["promptId"]);
        assert_eq!(notes.join().unwrap().unwrap()["granted"], true);
    });
    assert_eq!(
        pending(&core, "desk").unwrap(),
        json!({ "prompts": [], "approvals": [] })
    );
}

#[test]
fn a_prompt_withdrawn_with_its_caller_settles() {
    let home = home("pending-unload");
    let (core, deliveries) = prompted(&home);
    grant(&core, "desk", plugin_manage());
    install_hello(&core, &home);
    std::thread::scope(|s| {
        let asking = s.spawn(|| ask(&core, "example.hello", notes_read()));
        let prompt = wait_for(&deliveries, "perm.prompt").data().clone();
        set_enabled(&core, "example.hello", false);
        assert_eq!(
            asking.join().unwrap().unwrap_err().code,
            ErrorCode::Cancelled
        );
        let settled = wait_for(&deliveries, "perm.settled");
        assert_eq!(
            settled.data(),
            &json!({ "kind": "prompt", "id": prompt["promptId"] })
        );
    });
    assert_eq!(pending(&core, "desk").unwrap()["prompts"], json!([]));
}

#[test]
fn an_approval_waits_in_the_list_until_it_is_answered() {
    let home = home("pending-approval");
    let (core, deliveries) = prompted(&home);
    fs::create_dir_all(home.join("Notes")).unwrap();
    grant(
        &core,
        MIRA,
        json!({ "permission": "fs:write", "paths": ["~/Notes/**"] }),
    );
    std::thread::scope(|s| {
        let writing = s.spawn(|| {
            let params = json!({ "path": "~/Notes/a.md", "content": "Buy oat milk\n",
                "scope": { "permission": "fs:write", "paths": ["~/Notes/**"] } });
            call(&core, MIRA, "fs.write", params)
        });
        let approval = wait_for(&deliveries, "perm.approval");
        let waiting = pending(&core, "desk").unwrap();
        assert_eq!(waiting["prompts"], json!([]));
        assert_eq!(waiting["approvals"], json!([approval.data()]));

        approve_as_desk(&core, &approval, "deny");
        let settled = wait_for(&deliveries, "perm.settled");
        assert_eq!(
            settled.data(),
            &json!({ "kind": "approval", "id": approval.data()["approvalId"] })
        );
        assert_eq!(
            writing.join().unwrap().unwrap_err().code,
            ErrorCode::PermissionDenied
        );
    });
    assert_eq!(pending(&core, "desk").unwrap()["approvals"], json!([]));
}

#[test]
fn only_a_perm_manage_holder_sees_what_waits() {
    let home = home("pending-scope");
    let (core, _deliveries) = prompted(&home);
    let refused = pending(&core, NOTES).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
}
