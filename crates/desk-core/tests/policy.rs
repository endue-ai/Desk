//! What the desk's policies need from the core (ADR 0017): policy plugins install without an entry,
//! init.get hands each caller its own settings, and ui.notify reaches the runtime as ui.notified.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "desk-policy-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn core() -> Core {
    Core::new(Roots {
        home: std::env::temp_dir(),
    })
}

fn call(core: &Core, caller: &str, request: Value) -> Result<Value, ErrorCode> {
    let request: BridgeRequest = serde_json::from_value(request).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error.code),
    }
}

fn plugin(parent: &Path, folder: &str, manifest: Value) -> PathBuf {
    let dir = parent.join(folder);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    dir
}

#[test]
fn a_policy_plugin_installs_ready_without_an_entry() {
    let parent = temp_dir("install");
    let dir = plugin(
        &parent,
        "keys",
        json!({ "id": "desk.keys", "version": "0.1.0", "kind": "policy",
                "contributes": { "keys": [{ "key": "Mod+K", "command": "desk.palette.open" }] } }),
    );
    let core = core();
    let info = core.install_plugin(&dir, true);
    assert_eq!(info.error, None);
    let manifest = info.manifest.expect("a ready plugin keeps its manifest");
    assert_eq!(manifest.entry, None);
    let keys = manifest
        .contributes
        .and_then(|c| c.keys)
        .unwrap_or_default();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].command, "desk.palette.open");
}

#[test]
fn a_policy_plugin_with_an_entry_fails_with_where() {
    let parent = temp_dir("entry");
    fs::write(parent.join("policy.js"), "").unwrap();
    let dir = plugin(
        &parent,
        "bad",
        json!({ "id": "desk.bad", "version": "0.1.0", "kind": "policy", "entry": "policy.js",
                "contributes": {} }),
    );
    let info = core().install_plugin(&dir, false);
    let error = info.error.expect("a policy plugin runs no code");
    assert!(error.contains("plugin.json"), "{error}");
}

#[test]
fn init_get_hands_each_caller_only_its_own_settings() {
    let dir = temp_dir("init");
    let init = dir.join("init.yaml");
    fs::write(
        &init,
        "profile: focus\nsettings:\n  desk.theme.scheme: light\n  desk.notify.dnd: true\n  \
         endue.eris.voice: false\n  desktop.other: 1\n",
    )
    .unwrap();
    let core = core().with_init_file(init);
    let ask = |caller: &str| {
        call(
            &core,
            caller,
            json!({ "id": 1, "method": "init.get", "params": {} }),
        )
        .unwrap()
    };
    assert_eq!(
        ask("desk"),
        json!({ "profile": "focus",
                "settings": { "desk.notify.dnd": true, "desk.theme.scheme": "light" } })
    );
    assert_eq!(
        ask("endue.eris"),
        json!({ "profile": "focus", "settings": { "endue.eris.voice": false } })
    );
    assert_eq!(
        ask("example.none"),
        json!({ "profile": "focus", "settings": {} })
    );
}

#[test]
fn init_get_says_why_a_broken_init_yaml_is_not_in_force() {
    let dir = temp_dir("broken");
    let init = dir.join("init.yaml");
    fs::write(&init, "profile: [not, a, name]\n").unwrap();
    let core = core().with_init_file(init);
    let result = call(
        &core,
        "desk",
        json!({ "id": 1, "method": "init.get", "params": {} }),
    )
    .unwrap();
    assert_eq!(result["profile"], json!("default"));
    assert!(result["problem"].is_string(), "{result}");
}

#[test]
fn ui_notify_is_denied_without_a_grant() {
    let core = core();
    let events = core.events().subscribe();
    let denied = call(
        &core,
        "example.build",
        json!({ "id": 1, "method": "ui.notify",
                "params": { "title": "Done", "scope": { "permission": "ui:notify" } } }),
    );
    assert_eq!(denied, Err(ErrorCode::PermissionDenied));
    assert!(
        events.try_recv().is_err(),
        "a denied notification is never shown"
    );
}

#[test]
fn ui_notify_reaches_the_runtime_as_ui_notified() {
    let core = core();
    let scope: Permission = serde_json::from_value(json!({ "permission": "ui:notify" })).unwrap();
    core.grant("example.build", scope);
    let events = core.events().subscribe();
    let first = call(
        &core,
        "example.build",
        json!({ "id": 1, "method": "ui.notify",
                "params": { "title": "Build finished", "body": "All green.", "level": "success",
                            "scope": { "permission": "ui:notify" } } }),
    )
    .unwrap();
    let second = call(
        &core,
        "example.build",
        json!({ "id": 2, "method": "ui.notify",
                "params": { "title": "Again", "scope": { "permission": "ui:notify" } } }),
    )
    .unwrap();
    assert_ne!(first["notificationId"], second["notificationId"]);
    let shown: Vec<Value> = std::iter::from_fn(|| events.try_recv().ok())
        .filter(|event| matches!(event, BridgeEvent::UiNotified(_)))
        .map(|event| serde_json::to_value(event).unwrap())
        .collect();
    assert_eq!(
        shown,
        vec![
            json!({ "event": "ui.notified",
                    "data": { "notificationId": first["notificationId"], "caller": "example.build",
                              "title": "Build finished", "body": "All green.", "level": "success" } }),
            json!({ "event": "ui.notified",
                    "data": { "notificationId": second["notificationId"], "caller": "example.build",
                              "title": "Again", "level": "info" } }),
        ]
    );
}
