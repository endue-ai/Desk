//! proc.* through Core::handle: scopes, events in order, ownership, and revoking a grant.
#![cfg(unix)]

use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use desk_bridge::{BridgeError, BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

fn sh(pty: bool) -> Value {
    json!({ "permission": "proc:spawn", "commands": ["sh", "cat"], "pty": pty })
}

fn core(grant: Option<Value>) -> Core {
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    });
    if let Some(grant) = grant {
        core.grant("desk", serde_json::from_value(grant).unwrap());
    }
    core
}

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error),
    }
}

/// Events for `proc_id` until its proc.exit (included), within ten seconds.
fn until_exit(events: &Receiver<BridgeEvent>, proc_id: &str) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        let Ok(event) = events.recv_timeout(Duration::from_millis(100)) else {
            continue;
        };
        let event = serde_json::to_value(event).unwrap();
        if event["data"]["procId"] != proc_id {
            continue;
        }
        let done = event["event"] == "proc.exit";
        seen.push(event);
        if done {
            return seen;
        }
    }
    panic!("no proc.exit for {proc_id}: {seen:?}");
}

fn stdout(events: &[Value]) -> String {
    events
        .iter()
        .filter(|e| e["event"] == "proc.output" && e["data"]["stream"] == "stdout")
        .map(|e| e["data"]["data"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn a_granted_command_runs_and_reports_output_then_exit() {
    let core = core(Some(sh(false)));
    let events = core.events().subscribe();
    let started = call(
        &core,
        "desk",
        "proc.spawn",
        json!({ "command": "sh", "args": ["-c", "echo hi; exit 4"], "scope": sh(false) }),
    )
    .unwrap();
    let proc_id = started["procId"].as_str().unwrap();
    assert!(started["pid"].as_u64().is_some());
    let seen = until_exit(&events, proc_id);
    assert_eq!(stdout(&seen), "hi\n");
    assert_eq!(seen.last().unwrap()["data"]["code"], 4);
}

#[test]
fn commands_outside_the_grant_and_terminals_it_does_not_allow_are_denied() {
    let core = core(Some(sh(false)));
    let other = json!({ "permission": "proc:spawn", "commands": ["rm"] });
    let error = call(
        &core,
        "desk",
        "proc.spawn",
        json!({ "command": "rm", "args": ["notes.txt"], "scope": other }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    let error = call(
        &core,
        "desk",
        "proc.spawn",
        json!({ "command": "sh", "pty": { "cols": 80, "rows": 24 }, "scope": sh(false) }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    let error = call(
        &core,
        "desk",
        "proc.spawn",
        json!({ "command": "sh", "pty": { "cols": 80, "rows": 24 }, "scope": sh(true) }),
    )
    .unwrap_err();
    assert_eq!(
        error.code,
        ErrorCode::PermissionDenied,
        "the grant has no pty"
    );
}

#[test]
fn write_and_kill_reach_the_process_and_only_its_owner_may_use_it() {
    let core = core(Some(sh(false)));
    core.grant("example.other", serde_json::from_value(sh(false)).unwrap());
    let events = core.events().subscribe();
    let started = call(
        &core,
        "desk",
        "proc.spawn",
        json!({ "command": "cat", "scope": sh(false) }),
    )
    .unwrap();
    let proc_id = started["procId"].as_str().unwrap();

    let stranger = call(
        &core,
        "example.other",
        "proc.kill",
        json!({ "procId": proc_id, "scope": sh(false) }),
    )
    .unwrap_err();
    assert_eq!(
        stranger.code,
        ErrorCode::NotFound,
        "another caller's process"
    );

    call(
        &core,
        "desk",
        "proc.write",
        json!({ "procId": proc_id, "data": "echo\n", "scope": sh(false) }),
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(200));
    call(
        &core,
        "desk",
        "proc.kill",
        json!({ "procId": proc_id, "scope": sh(false) }),
    )
    .unwrap();
    let seen = until_exit(&events, proc_id);
    assert_eq!(stdout(&seen), "echo\n");
    assert_eq!(seen.last().unwrap()["data"]["signal"], "term");

    let gone = call(
        &core,
        "desk",
        "proc.write",
        json!({ "procId": proc_id, "data": "x", "scope": sh(false) }),
    )
    .unwrap_err();
    assert_eq!(
        gone.code,
        ErrorCode::NotFound,
        "an ended process is forgotten"
    );
}

#[test]
fn a_terminal_process_can_be_resized() {
    let core = core(Some(sh(true)));
    let events = core.events().subscribe();
    let started = call(
        &core,
        "desk",
        "proc.spawn",
        json!({ "command": "sh", "args": ["-c", "read x; stty size"],
                "pty": { "cols": 80, "rows": 24 }, "scope": sh(true) }),
    )
    .unwrap();
    let proc_id = started["procId"].as_str().unwrap();
    call(
        &core,
        "desk",
        "proc.resize",
        json!({ "procId": proc_id, "size": { "cols": 120, "rows": 40 }, "scope": sh(true) }),
    )
    .unwrap();
    call(
        &core,
        "desk",
        "proc.write",
        json!({ "procId": proc_id, "data": "go\n", "scope": sh(true) }),
    )
    .unwrap();
    let seen = until_exit(&events, proc_id);
    let terminal: String = seen
        .iter()
        .filter(|e| e["data"]["stream"] == "pty")
        .map(|e| e["data"]["data"].as_str().unwrap().to_owned())
        .collect();
    assert!(terminal.contains("40 120"), "{terminal:?}");
}

#[test]
fn revoking_the_grant_ends_its_processes() {
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    });
    let grant = core.grant("desk", serde_json::from_value(sh(false)).unwrap());
    let events = core.events().subscribe();
    let started = call(
        &core,
        "desk",
        "proc.spawn",
        json!({ "command": "sh", "args": ["-c", "sleep 30"], "scope": sh(false) }),
    )
    .unwrap();
    let proc_id = started["procId"].as_str().unwrap();
    assert!(core.revoke("desk", &grant.grant_id));
    let seen = until_exit(&events, proc_id);
    assert_eq!(seen.last().unwrap()["data"]["signal"], "kill");
}
