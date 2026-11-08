//! The command registry through `Core::handle` (ADR 0017): callers register their own commands,
//! listing and invoking need `cmd:invoke`, args are checked against the command's schema, the
//! provider hears `cmd.invoked` and its `cmd.answer` reaches the caller as `cmd.answered`.

use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn core() -> Core {
    Core::new(Roots {
        home: std::env::temp_dir(),
    })
}

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

fn grant(core: &Core, caller: &str, ids: &[&str]) {
    let permission: Permission =
        serde_json::from_value(json!({ "permission": "cmd:invoke", "ids": ids })).unwrap();
    core.grant(caller, permission);
}

fn scope(ids: &[&str]) -> Value {
    json!({ "permission": "cmd:invoke", "ids": ids })
}

/// Every event of one name published so far, as JSON data.
fn drain(events: &Receiver<BridgeEvent>, name: &str) -> Vec<Value> {
    std::iter::from_fn(|| events.try_recv().ok())
        .map(|event| serde_json::to_value(event).unwrap())
        .filter(|event| event["event"] == name)
        .map(|event| event["data"].clone())
        .collect()
}

#[test]
fn a_command_belongs_to_the_caller_that_registered_it() {
    let core = core();
    let events = core.events().subscribe();
    let register = |caller: &str, title: &str| {
        call(
            &core,
            caller,
            "cmd.register",
            json!({ "id": "desk.theme.toggle", "title": title, "keywords": ["theme"] }),
        )
    };
    assert_eq!(register("desk", "Switch theme"), Ok(json!({})));
    assert_eq!(register("desk", "Light or dark"), Ok(json!({})));
    assert_eq!(
        register("example.theft", "Mine now"),
        Err(ErrorCode::AlreadyExists)
    );
    assert_eq!(
        call(
            &core,
            "example.theft",
            "cmd.unregister",
            json!({ "id": "desk.theme.toggle" })
        ),
        Err(ErrorCode::NotFound)
    );
    let changes: Vec<Value> = drain(&events, "cmd.changed")
        .into_iter()
        .map(|d| d["change"].clone())
        .collect();
    assert_eq!(changes, vec![json!("registered"), json!("updated")]);
}

#[test]
fn listing_needs_a_grant_and_shows_only_what_the_scope_covers() {
    let core = core();
    for id in ["desk.theme.toggle", "desk.keys.quit", "example.notes.new"] {
        call(
            &core,
            "desk",
            "cmd.register",
            json!({ "id": id, "title": id }),
        )
        .unwrap();
    }
    let list = |ids: &[&str]| {
        call(
            &core,
            "desk.palette",
            "cmd.list",
            json!({ "scope": scope(ids) }),
        )
    };
    assert_eq!(list(&["*"]), Err(ErrorCode::PermissionDenied));
    grant(&core, "desk.palette", &["desk.*"]);
    let listed = list(&["desk.*"]).unwrap();
    let ids: Vec<&str> = listed["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["desk.theme.toggle", "desk.keys.quit"]);
    assert_eq!(listed["commands"][0]["provider"], json!("desk"));
    assert_eq!(list(&["*"]), Err(ErrorCode::PermissionDenied));
}

#[test]
fn an_invocation_reaches_its_provider_and_the_answer_reaches_the_caller() {
    let core = core();
    call(
        &core,
        "desk.palette",
        "cmd.register",
        json!({ "id": "desk.palette.pick", "title": "Pick one",
                "argsSchema": { "type": "object", "required": ["items"] } }),
    )
    .unwrap();
    let invoke = |args: Value| {
        call(
            &core,
            "desk",
            "cmd.invoke",
            json!({ "id": "desk.palette.pick", "args": args, "scope": scope(&["desk.palette.*"]) }),
        )
    };
    assert_eq!(invoke(json!({})), Err(ErrorCode::PermissionDenied));
    grant(&core, "desk", &["*"]);
    assert_eq!(invoke(json!({})), Err(ErrorCode::InvalidParams));
    let events = core.events().subscribe();
    let started = invoke(json!({ "items": ["a", "b"] })).unwrap();
    let invocation = started["invocationId"].as_str().unwrap().to_owned();
    assert_eq!(
        drain(&events, "cmd.invoked"),
        vec![
            json!({ "invocationId": invocation, "id": "desk.palette.pick",
                     "args": { "items": ["a", "b"] }, "caller": "desk" })
        ]
    );
    assert_eq!(
        call(
            &core,
            "desk",
            "cmd.answer",
            json!({ "invocationId": invocation, "result": "b" })
        ),
        Err(ErrorCode::NotFound),
        "only the provider answers"
    );
    call(
        &core,
        "desk.palette",
        "cmd.answer",
        json!({ "invocationId": invocation, "result": "b" }),
    )
    .unwrap();
    assert_eq!(
        drain(&events, "cmd.answered"),
        vec![
            json!({ "invocationId": invocation, "id": "desk.palette.pick",
                     "caller": "desk", "ok": true, "result": "b" })
        ]
    );
    assert_eq!(
        call(
            &core,
            "desk.palette",
            "cmd.answer",
            json!({ "invocationId": invocation, "result": "b" })
        ),
        Err(ErrorCode::NotFound),
        "an invocation is answered once"
    );
}

#[test]
fn invoking_needs_the_scope_to_cover_the_command_and_the_command_to_exist() {
    let core = core();
    grant(&core, "example.notes", &["desk.theme.*"]);
    call(
        &core,
        "desk",
        "cmd.register",
        json!({ "id": "desk.files.save", "title": "Save" }),
    )
    .unwrap();
    let invoke = |id: &str, ids: &[&str]| {
        call(
            &core,
            "example.notes",
            "cmd.invoke",
            json!({ "id": id, "scope": scope(ids) }),
        )
    };
    assert_eq!(
        invoke("desk.files.save", &["desk.theme.*"]),
        Err(ErrorCode::PermissionDenied)
    );
    assert_eq!(
        invoke("desk.files.save", &["desk.*"]),
        Err(ErrorCode::PermissionDenied)
    );
    assert_eq!(
        invoke("desk.theme.toggle", &["desk.theme.*"]),
        Err(ErrorCode::NotFound)
    );
}

#[test]
fn a_plugin_turned_off_takes_its_commands_and_cancels_what_waited_on_it() {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-cmd-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(
        dir.join("plugin.json"),
        json!({ "id": "desk.palette", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" })
            .to_string(),
    )
    .unwrap();
    fs::write(dir.join("ui/index.html"), "<p>palette</p>").unwrap();
    let core = core();
    core.install_plugin(&dir, true);
    let manage: Permission =
        serde_json::from_value(json!({ "permission": "plugin:manage" })).unwrap();
    core.grant("desk", manage);
    grant(&core, "desk", &["*"]);
    call(
        &core,
        "desk.palette",
        "cmd.register",
        json!({ "id": "desk.palette.open", "title": "Open" }),
    )
    .unwrap();
    let invocation = call(
        &core,
        "desk",
        "cmd.invoke",
        json!({ "id": "desk.palette.open", "scope": scope(&["*"]) }),
    )
    .unwrap()["invocationId"]
        .clone();
    let events = core.events().subscribe();
    call(
        &core,
        "desk",
        "plugin.setEnabled",
        json!({ "plugin": "desk.palette", "enabled": false,
                "scope": { "permission": "plugin:manage" } }),
    )
    .unwrap();
    let all: Vec<Value> = std::iter::from_fn(|| events.try_recv().ok())
        .map(|event| serde_json::to_value(event).unwrap())
        .collect();
    let answered: Vec<&Value> = all
        .iter()
        .filter(|e| e["event"] == "cmd.answered")
        .collect();
    assert_eq!(answered.len(), 1);
    assert_eq!(answered[0]["data"]["invocationId"], invocation);
    assert_eq!(answered[0]["data"]["error"]["code"], json!("cancelled"));
    let listed = call(&core, "desk", "cmd.list", json!({ "scope": scope(&["*"]) })).unwrap();
    assert_eq!(listed, json!({ "commands": [] }));
}
