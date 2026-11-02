//! Approvals (ADR 0078): an agent's write waits for the person even when a grant covers it:
//! `perm.approval` to the `perm:manage` holder with a diff, answered once, task or deny with
//! `perm.approve`, and `perm.approval.done` once the write ran. Spawns, fetches, commands and a
//! person's own calls: `approval_actions.rs`.

mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;

use base64::Engine as _;
use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const MIRA: &str = "agent:mira";
const NOTES_ONLY: &str =
    "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n";

/// A core reading `init` from `home/init.yaml`, with `desk` holding perm:manage and a router listening.
fn core_with(home: &Path, init: &str) -> (Core, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, init).unwrap();
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn notes(home: &Path, name: &str, text: &str) {
    fs::create_dir_all(home.join("Notes")).unwrap();
    fs::write(home.join("Notes").join(name), text).unwrap();
}

fn fs_write(paths: &[&str]) -> Value {
    json!({ "permission": "fs:write", "paths": paths })
}

fn write(core: &Core, caller: &str, path: &str, content: &str) -> Result<Value, BridgeError> {
    let params = json!({ "path": path, "content": content, "scope": fs_write(&["~/Notes/**"]) });
    call(core, caller, "fs.write", params)
}

/// perm.approve as `desk`.
fn approve(core: &Core, approval: &Seen, answer: &str) -> Result<Value, BridgeError> {
    let params = json!({ "approvalId": approval.data()["approvalId"], "answer": answer,
        "scope": manage() });
    call(core, "desk", "perm.approve", params)
}

fn perm_log(core: &Core) -> Vec<Value> {
    grant(core, "desk", json!({ "permission": "log:read" }));
    let tail = call(
        core,
        "desk",
        "log.tail",
        json!({ "channel": "perm", "count": 1000, "scope": { "permission": "log:read" } }),
    );
    tail.unwrap()["entries"].as_array().unwrap().clone()
}

#[test]
fn an_agents_write_waits_for_approval_even_with_a_session_grant() {
    let home = home("approve-write");
    notes(&home, "a.md", "# Today\nBuy milk\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    std::thread::scope(|s| {
        let writing = s.spawn(|| write(&core, MIRA, "~/Notes/a.md", "# Today\nBuy oat milk\n"));
        let approval = wait_for(&deliveries, "perm.approval");
        assert_eq!(approval.to, strings(&["desk"]));
        let data = approval.data();
        assert_eq!(data["caller"], MIRA);
        assert_eq!(data["action"], "fs.write");
        assert_eq!(data["target"], "~/Notes/a.md");
        assert_eq!(data["permission"], fs_write(&["~/Notes/**"]));
        assert_eq!(data["size"], 21);
        assert!(
            data.get("task").is_none(),
            "a call outside a turn has no task"
        );
        assert_eq!(data["preview"]["kind"], "diff");
        let diff = data["preview"]["text"].as_str().unwrap();
        assert!(
            diff.starts_with("--- ~/Notes/a.md\n+++ ~/Notes/a.md\n@@ "),
            "{diff}"
        );
        assert!(
            diff.contains("\n # Today\n-Buy milk\n+Buy oat milk\n"),
            "{diff}"
        );
        let unchanged = fs::read_to_string(home.join("Notes/a.md")).unwrap();
        assert_eq!(
            unchanged, "# Today\nBuy milk\n",
            "nothing is written while it waits"
        );
        approve(&core, &approval, "once").unwrap();
        assert_eq!(writing.join().unwrap().unwrap()["bytesWritten"], 21);
        let done = wait_for(&deliveries, "perm.approval.done");
        assert_eq!(done.to, strings(&["desk"]));
        assert_eq!(
            done.data(),
            &json!({ "approvalId": data["approvalId"], "ok": true, "bytesWritten": 21 })
        );
    });
    let written = fs::read_to_string(home.join("Notes/a.md")).unwrap();
    assert_eq!(written, "# Today\nBuy oat milk\n");
    let log = perm_log(&core);
    let approved: Vec<&Value> = log
        .iter()
        .filter(|e| e["fields"]["decision"] == "approved")
        .collect();
    assert_eq!(approved.len(), 1, "{log:?}");
    assert_eq!(approved[0]["fields"]["caller"], MIRA);
    assert_eq!(approved[0]["fields"]["approval"], "once");
    assert_eq!(approved[0]["fields"]["target"], "~/Notes/a.md");
}

#[test]
fn allow_once_covers_one_call_and_the_same_write_asks_again() {
    let home = home("approve-once");
    notes(&home, "a.md", "old\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    let (first, written) = held(&core, &deliveries, "once", || {
        write(&core, MIRA, "~/Notes/a.md", "new\n")
    });
    written.unwrap();
    let (second, refused) = held(&core, &deliveries, "deny", || {
        write(&core, MIRA, "~/Notes/a.md", "new\n")
    });
    assert_ne!(first.data()["approvalId"], second.data()["approvalId"]);
    assert_eq!(refused.unwrap_err().code, ErrorCode::PermissionDenied);
}

#[test]
fn deny_refuses_the_call_with_the_reason() {
    let home = home("approve-deny");
    notes(&home, "a.md", "keep me\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    let (_, refused) = held(&core, &deliveries, "deny", || {
        write(&core, MIRA, "~/Notes/a.md", "gone\n")
    });
    let refused = refused.unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert!(refused.message.contains("did not approve"), "{refused:?}");
    assert_eq!(
        serde_json::to_value(&refused.permission).unwrap(),
        fs_write(&["~/Notes/**"])
    );
    assert_eq!(
        fs::read_to_string(home.join("Notes/a.md")).unwrap(),
        "keep me\n"
    );
    assert!(named(&deliveries, "perm.approval.done").is_empty());
    let log = perm_log(&core);
    let refusal = log
        .iter()
        .find(|e| e["fields"]["decision"] == "refused")
        .expect("the denial is logged");
    assert_eq!(refusal["fields"]["reason"], "not-approved");
    assert_eq!(refusal["fields"]["target"], "~/Notes/a.md");
}

#[test]
fn a_task_answer_needs_a_task_and_nobody_to_ask_means_the_prompter() {
    let home = home("approve-task");
    notes(&home, "a.md", "old\n");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    std::thread::scope(|s| {
        let writing = s.spawn(|| write(&core, MIRA, "~/Notes/a.md", "new\n"));
        let approval = wait_for(&deliveries, "perm.approval");
        let wrong = approve(&core, &approval, "task").unwrap_err();
        assert_eq!(wrong.code, ErrorCode::InvalidParams);
        approve(&core, &approval, "once").unwrap();
        writing.join().unwrap().unwrap();
    });

    // Nobody holds perm:manage: the Prompter decides, and the default one refuses.
    let quiet = Core::new(roots(&home));
    grant(&quiet, MIRA, fs_write(&["~/Notes/**"]));
    let refused = write(&quiet, MIRA, "~/Notes/a.md", "quiet\n").unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    let yes = Core::new(roots(&home)).with_prompter(SayYes);
    grant(&yes, MIRA, fs_write(&["~/Notes/**"]));
    write(&yes, MIRA, "~/Notes/a.md", "yes\n").unwrap();
    assert_eq!(
        fs::read_to_string(home.join("Notes/a.md")).unwrap(),
        "yes\n"
    );
}

#[test]
fn the_diff_is_bounded_and_binary_files_have_none() {
    let home = home("approve-bounded");
    let old: String = (1..=300).map(|n| format!("line {n}\n")).collect();
    let new: String = (1..=300).map(|n| format!("row {n}\n")).collect();
    notes(&home, "long.txt", &old);
    fs::write(home.join("Notes/blob.bin"), [0xff, 0x00, 0xfe]).unwrap();
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    let (approval, _) = held(&core, &deliveries, "deny", || {
        write(&core, MIRA, "~/Notes/long.txt", &new)
    });
    let preview = &approval.data()["preview"];
    assert_eq!(preview["truncated"], true);
    let changed = preview["text"]
        .as_str()
        .unwrap()
        .lines()
        .filter(|l| !l.starts_with("+++") && !l.starts_with("---"))
        .filter(|l| l.starts_with('+') || l.starts_with('-'))
        .count();
    assert_eq!(changed, 200);

    let bytes = base64::engine::general_purpose::STANDARD.encode([0u8, 1, 2, 3]);
    let (approval, _) = held(&core, &deliveries, "deny", || {
        let params = json!({ "path": "~/Notes/blob.bin", "content": bytes, "encoding": "base64",
            "scope": fs_write(&["~/Notes/**"]) });
        call(&core, MIRA, "fs.write", params)
    });
    assert!(
        approval.data().get("preview").is_none(),
        "{:?}",
        approval.data()
    );
    assert_eq!(approval.data()["size"], 4);
}
