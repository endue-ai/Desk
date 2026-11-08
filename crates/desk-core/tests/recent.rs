//! What the core tells an inspector (#334): `cmd.recent`, the last 200 command invocations with their
//! caller, provider and duration, and `plugin.stats`, the bridge calls each caller made over the last
//! minute. Both need `perm:manage`. Times come from the core's clock, a fake one here.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeError, BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use desk_plugin_host::Clock;
use serde_json::{Value, json};

/// 2026-11-02T09:00:00Z.
const START: u64 = 1_793_610_000;

/// A clock that moves only when the test moves it, in milliseconds.
struct FakeClock(Mutex<SystemTime>);

impl FakeClock {
    fn advance(&self, ms: u64) {
        *self.0.lock().unwrap() += Duration::from_millis(ms);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> SystemTime {
        *self.0.lock().unwrap()
    }
}

fn core() -> (Core, Arc<FakeClock>) {
    let clock = Arc::new(FakeClock(Mutex::new(
        UNIX_EPOCH + Duration::from_secs(START),
    )));
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_clock(clock.clone());
    (core, clock)
}

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(failure) => Err(failure.error),
    }
}

fn grant(core: &Core, caller: &str, permission: Value) {
    let permission: Permission = serde_json::from_value(permission).unwrap();
    core.grant(caller, permission);
}

const MANAGE: &str = "perm:manage";

fn manage() -> Value {
    json!({ "permission": MANAGE })
}

fn register(core: &Core, provider: &str, id: &str) {
    call(
        core,
        provider,
        "cmd.register",
        json!({ "id": id, "title": id }),
    )
    .unwrap();
}

/// cmd.invoke as `caller`; the invocation id.
fn invoke(core: &Core, caller: &str, id: &str) -> String {
    let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
    let invoked = call(
        core,
        caller,
        "cmd.invoke",
        json!({ "id": id, "scope": scope }),
    )
    .unwrap();
    invoked["invocationId"].as_str().unwrap().to_owned()
}

fn answer(core: &Core, provider: &str, invocation: &str, answer: Value) {
    let mut params = json!({ "invocationId": invocation });
    params
        .as_object_mut()
        .unwrap()
        .extend(answer.as_object().unwrap().clone());
    call(core, provider, "cmd.answer", params).unwrap();
}

fn recent(core: &Core) -> Vec<Value> {
    let listed = call(
        core,
        "desk.inspector",
        "cmd.recent",
        json!({ "scope": manage() }),
    )
    .unwrap();
    listed["invocations"].as_array().unwrap().clone()
}

fn stats(core: &Core) -> Value {
    call(
        core,
        "desk.inspector",
        "plugin.stats",
        json!({ "scope": manage() }),
    )
    .unwrap()
}

#[test]
fn cmd_recent_names_caller_provider_and_milliseconds() {
    let (core, clock) = core();
    grant(&core, "desk.inspector", manage());
    grant(
        &core,
        "desk.palette",
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    grant(
        &core,
        "cli",
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    grant(
        &core,
        "desk",
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    register(&core, "desk", "desk.files.save");
    register(&core, "endue.git", "endue.git.commit");
    register(&core, "desk.palette", "desk.palette.pick");

    clock.advance(120);
    let saved = invoke(&core, "desk.palette", "desk.files.save");
    clock.advance(12);
    answer(&core, "desk", &saved, json!({ "result": "~/notes/a.md" }));
    clock.advance(868);
    let committed = invoke(&core, "cli", "endue.git.commit");
    clock.advance(340);
    answer(
        &core,
        "endue.git",
        &committed,
        json!({ "error": { "code": "failed", "message": "nothing to commit" } }),
    );
    clock.advance(1160);
    let picking = invoke(&core, "desk", "desk.palette.pick");

    assert_eq!(
        recent(&core),
        vec![
            json!({
                "invocationId": saved, "id": "desk.files.save", "caller": "desk.palette",
                "provider": "desk", "at": "2026-11-02T09:00:00.120Z", "durationMs": 12, "ok": true
            }),
            json!({
                "invocationId": committed, "id": "endue.git.commit", "caller": "cli",
                "provider": "endue.git", "at": "2026-11-02T09:00:01Z", "durationMs": 340,
                "ok": false, "error": "failed"
            }),
            json!({
                "invocationId": picking, "id": "desk.palette.pick", "caller": "desk",
                "provider": "desk.palette", "at": "2026-11-02T09:00:02.500Z"
            }),
        ]
    );
}

#[test]
fn cmd_recent_keeps_the_last_200() {
    let (core, clock) = core();
    grant(&core, "desk.inspector", manage());
    grant(
        &core,
        "desk",
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    register(&core, "desk", "desk.buffers.next");
    for _ in 0..205 {
        let invocation = invoke(&core, "desk", "desk.buffers.next");
        clock.advance(1);
        answer(&core, "desk", &invocation, json!({}));
    }
    let listed = recent(&core);
    assert_eq!(listed.len(), 200);
    assert_eq!(listed[0]["invocationId"], "i-6");
    assert_eq!(listed[199]["invocationId"], "i-205");
    assert_eq!(listed[199]["durationMs"], 1);
}

#[test]
fn plugin_stats_counts_bridge_calls_per_caller_over_the_last_minute() {
    let (core, clock) = core();
    grant(&core, "desk.inspector", manage());
    let store = |caller: &str| {
        call(
            &core,
            caller,
            "store.set",
            json!({ "key": "k", "value": 1 }),
        )
    };
    store("example.a").unwrap();
    store("example.a").unwrap();
    // No fs:read grant: refused, and counted as failed.
    let read =
        json!({ "path": "~/a.txt", "scope": { "permission": "fs:read", "paths": ["~/**"] } });
    assert!(call(&core, "example.a", "fs.read", read).is_err());
    store("example.b").unwrap();

    assert_eq!(
        stats(&core),
        json!({ "windowSeconds": 60, "callers": [
            { "caller": "example.a", "calls": 3, "failed": 1 },
            { "caller": "example.b", "calls": 1, "failed": 0 }
        ] })
    );

    clock.advance(30_000);
    store("example.b").unwrap();
    store("example.b").unwrap();
    assert_eq!(
        stats(&core)["callers"],
        json!([
            { "caller": "example.a", "calls": 3, "failed": 1 },
            { "caller": "example.b", "calls": 3, "failed": 0 },
            { "caller": "desk.inspector", "calls": 1, "failed": 0 }
        ])
    );

    // A minute after the first calls, only the later ones count.
    clock.advance(31_000);
    assert_eq!(
        stats(&core)["callers"],
        json!([
            { "caller": "example.b", "calls": 2, "failed": 0 },
            { "caller": "desk.inspector", "calls": 1, "failed": 0 }
        ])
    );
}

#[test]
fn both_need_perm_manage() {
    let (core, _clock) = core();
    for method in ["cmd.recent", "plugin.stats"] {
        let refused = call(&core, "example.a", method, json!({ "scope": manage() })).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{method}");
        assert_eq!(
            serde_json::to_value(refused.permission).unwrap(),
            manage(),
            "{method}"
        );
    }
    grant(&core, "example.a", manage());
    for method in ["cmd.recent", "plugin.stats"] {
        assert!(
            call(&core, "example.a", method, json!({ "scope": manage() })).is_ok(),
            "{method}"
        );
    }
}
