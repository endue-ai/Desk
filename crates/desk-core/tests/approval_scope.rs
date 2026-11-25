//! The reviewed action supplies its own scope without a separate prompt (ADR 0372).

mod support;

use std::sync::mpsc::Receiver;
use std::time::Duration;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const ERIS: &str = "agent:eris";
const PATH: &str = "~/Documents/hello.md";

fn first_question(deliveries: &Receiver<Delivery>) -> Seen {
    loop {
        let delivery = deliveries.recv_timeout(Duration::from_secs(10)).unwrap();
        let next = Seen {
            to: delivery.to,
            event: serde_json::to_value(delivery.event).unwrap(),
        };
        if matches!(next.name(), "perm.prompt" | "perm.approval") {
            return next;
        }
    }
}

fn approve_first<T: Send>(
    core: &Core,
    deliveries: &Receiver<Delivery>,
    run: impl FnOnce() -> Result<T, BridgeError> + Send,
) -> (Seen, T) {
    std::thread::scope(|s| {
        let running = s.spawn(run);
        let first = first_question(deliveries);
        if first.name() == "perm.prompt" {
            // Release a base-branch call so a failing test can finish its thread.
            call(
                core,
                "desk",
                "perm.answer",
                json!({ "promptId": first.data()["promptId"],
                "granted": false, "scope": manage() }),
            )
            .unwrap();
        } else {
            approve_as_desk(core, &first, "once");
        }
        let result = running.join().unwrap();
        assert_eq!(first.name(), "perm.approval");
        (first, result.unwrap())
    })
}

#[test]
fn a_versioned_write_needs_only_its_approval_and_offers_undo_without_giving_a_grant() {
    let home = home("one-write-question");
    let core = Core::new(roots(&home))
        .with_prompter(NeverAsk)
        .with_history_dir(home.join("history"));
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let (approval, written) = approve_first(&core, &deliveries, || {
        call(
            &core,
            ERIS,
            "fs.write",
            json!({ "path": PATH, "content": "# Edited",
            "scope": { "permission": "fs:write", "paths": [PATH] } }),
        )
    });
    assert!(written["version"].is_string());
    assert!(query(&core, ERIS).is_empty());
    let done = wait_for(&deliveries, "perm.approval.done");
    assert_eq!(done.data()["approvalId"], approval.data()["approvalId"]);
    assert_eq!(done.data()["undoable"], true);
    assert!(named(&deliveries, "perm.prompt").is_empty());
    let other = "~/Calendar/today.ics";
    let scope = json!({ "permission": "fs:write", "paths": [other] });
    grant(&core, "desk", scope.clone());
    call(
        &core,
        "desk",
        "fs.write",
        json!({ "path": other, "content": "Later write", "scope": scope }),
    )
    .unwrap();
    let params = json!({ "approvalId": approval.data()["approvalId"], "scope": manage() });
    assert_eq!(
        call(&core, ERIS, "perm.undoApproval", params.clone())
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    call(&core, "desk", "perm.undoApproval", params.clone()).unwrap();
    assert_eq!(
        std::fs::read_to_string(home.join("Documents/hello.md")).unwrap(),
        "# Hello"
    );
    assert_eq!(
        std::fs::read_to_string(home.join("Calendar/today.ics")).unwrap(),
        "Later write"
    );
    assert_eq!(
        call(&core, "desk", "perm.undoApproval", params)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}

#[test]
fn a_marked_desk_command_uses_its_action_approval_as_the_first_card() {
    let home = home("one-command-question");
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    let id = "desk.fixture.delete";
    call(
        &core,
        "desk",
        "cmd.register",
        json!({ "id": id, "title": "Remove fixture", "irreversible": true }),
    )
    .unwrap();
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let (approval, invoked) = approve_first(&core, &deliveries, || {
        call(
            &core,
            ERIS,
            "cmd.invoke",
            json!({ "id": id, "args": { "fixture": "record" },
            "scope": { "permission": "cmd:invoke", "ids": [id] } }),
        )
    });
    assert_eq!(approval.data()["target"], id);
    assert!(invoked["invocationId"].is_string());
    assert!(query(&core, ERIS).is_empty());
    assert!(named(&deliveries, "perm.prompt").is_empty());
}

#[test]
fn an_approval_cannot_grant_access_outside_the_callers_allowlist() {
    let home = home("approval-cap");
    let init = home.join("init.yaml");
    std::fs::write(
        &init,
        "agents:\n  eris:\n    allow:\n      - { permission: fs:write, paths: [\"~/Other/**\"] }\n",
    )
    .unwrap();
    let core = Core::new(roots(&home))
        .with_prompter(NeverAsk)
        .with_init_file(init);
    let deliveries = core.events().subscribe_addressed();
    let error = call(
        &core,
        ERIS,
        "fs.write",
        json!({ "path": PATH, "content": "# Edited",
        "scope": { "permission": "fs:write", "paths": [PATH] } }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(query(&core, ERIS).is_empty());
    assert!(named(&deliveries, "perm.approval").is_empty());
}

#[cfg(unix)]
#[test]
fn a_terminal_approval_authorizes_only_one_matching_spawn_by_its_provider() {
    let home = home("terminal-approval-scope");
    let terminal = "endue.terminal";
    let id = "endue.terminal.run";
    let dir = home.join("terminal");
    std::fs::create_dir_all(dir.join("ui")).unwrap();
    std::fs::write(dir.join("ui/index.html"), "<p>Terminal</p>").unwrap();
    std::fs::write(dir.join("plugin.json"), json!({
        "id": terminal, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "permissions": [{ "permission": "proc:spawn", "commands": ["*"], "pty": true }],
        "contributes": { "commands": [{ "id": id, "title": "Run", "description": "Run a program.",
            "agent": true, "irreversible": true }] }
    }).to_string()).unwrap();
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    core.install_plugin(&dir, true);
    call(
        &core,
        terminal,
        "cmd.register",
        json!({"id": id, "title": "Run"}),
    )
    .unwrap();
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let (_, pending) = approve_first(&core, &deliveries, || {
        call(
            &core,
            ERIS,
            "cmd.invoke",
            json!({ "id": id, "args": { "command": "/bin/cat",
            "args": [], "cwd": "~/Documents" }, "scope": { "permission": "cmd:invoke", "ids": [id] } }),
        )
    });
    let issued = wait_for(&deliveries, "cmd.invoked");
    let invocation_id = &pending["invocationId"];
    assert_eq!(issued.data()["approved"], true);
    let scope = json!({ "permission": "proc:spawn", "commands": ["/bin/cat"], "pty": true });
    let ask = |caller, permission: Value| {
        call(
            &core,
            caller,
            "perm.request",
            json!({ "invocationId": invocation_id,
            "permission": permission }),
        )
        .unwrap()["granted"]
            .clone()
    };
    assert_eq!(ask(terminal, scope.clone()), true);
    assert_eq!(ask("example.other", scope.clone()), false);
    assert_eq!(
        ask(
            terminal,
            json!({ "permission": "proc:spawn", "commands": ["*"], "pty": true })
        ),
        false
    );
    let spawn = |caller, command, args: Value, cwd| {
        call(
            &core,
            caller,
            "proc.spawn",
            json!({ "invocationId": invocation_id, "command": command,
            "args": args, "cwd": cwd, "pty": { "cols": 80, "rows": 24 }, "scope": scope }),
        )
    };
    for rejected in [
        spawn("example.other", "/bin/cat", json!([]), "~/Documents"),
        spawn(terminal, "/bin/cat", json!(["-n"]), "~/Documents"),
        spawn(terminal, "/bin/cat", json!([]), "~"),
    ] {
        assert_eq!(rejected.unwrap_err().code, ErrorCode::PermissionDenied);
    }
    let started = spawn(terminal, "/bin/cat", json!([]), "~/Documents").unwrap();
    assert_eq!(
        spawn(terminal, "/bin/cat", json!([]), "~/Documents")
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(ask(terminal, scope.clone()), false);
    call(
        &core,
        terminal,
        "cmd.answer",
        json!({ "invocationId": invocation_id, "result": {} }),
    )
    .unwrap();
    call(
        &core,
        terminal,
        "proc.kill",
        json!({ "procId": started["procId"], "scope": scope }),
    )
    .unwrap();
    assert!(query(&core, terminal).is_empty());
    assert!(named(&deliveries, "perm.prompt").is_empty());
}
