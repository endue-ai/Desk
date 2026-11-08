//! store.get and store.set: a JSON value per caller and key, kept in desk-core storage.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A `store.json` in a folder of its own. The counter keeps tests running in parallel apart; the
/// clock alone can hand two of them the same folder.
fn temp_file() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir()
        .join(format!("desk-store-{}-{nanos}-{n}", std::process::id()))
        .join("store.json")
}

fn core(store: &Path) -> Core {
    Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_store_file(store.to_path_buf())
}

fn call(core: &Core, caller: &str, request: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest = serde_json::from_value(request).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

fn get(core: &Core, caller: &str, key: &str) -> Value {
    call(
        core,
        caller,
        json!({ "id": 1, "method": "store.get", "params": { "key": key } }),
    )
    .unwrap()
}

#[test]
fn a_set_value_is_returned_to_the_same_caller_only() {
    let file = temp_file();
    let core = core(&file);
    let set = call(
        &core,
        "endue.onboarding",
        json!({ "id": 2, "method": "store.set",
                "params": { "key": "first-run", "value": { "done": true, "name": "Ada" } } }),
    );
    assert_eq!(set, Ok(json!({})));
    assert_eq!(
        get(&core, "endue.onboarding", "first-run"),
        json!({ "value": { "done": true, "name": "Ada" } })
    );
    assert_eq!(get(&core, "example.other", "first-run"), json!({}));
}

#[test]
fn values_survive_a_new_core_over_the_same_file() {
    let file = temp_file();
    call(
        &core(&file),
        "endue.onboarding",
        json!({ "id": 3, "method": "store.set", "params": { "key": "name", "value": "Ada" } }),
    )
    .unwrap();
    assert_eq!(
        get(&core(&file), "endue.onboarding", "name"),
        json!({ "value": "Ada" })
    );
}

#[test]
fn a_missing_key_has_no_value() {
    let file = temp_file();
    assert_eq!(
        get(&core(&file), "endue.onboarding", "never-set"),
        json!({})
    );
}

#[test]
fn values_over_64_kib_are_refused() {
    let file = temp_file();
    let big = "x".repeat(70 * 1024);
    let result = call(
        &core(&file),
        "endue.onboarding",
        json!({ "id": 4, "method": "store.set", "params": { "key": "big", "value": big } }),
    );
    assert_eq!(result, Err(ErrorCode::InvalidParams));
}
