//! Core::handle: bridge requests in, bridge responses out, through the permission engine.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

fn temp_home() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-core-{}-{nanos}", std::process::id()));
    fs::create_dir_all(dir.join("Documents/notes")).unwrap();
    fs::write(dir.join("Documents/hello.md"), "# Hello").unwrap();
    fs::write(dir.join("Documents/notes/a.txt"), "abc").unwrap();
    dir
}

fn request(value: Value) -> BridgeRequest {
    serde_json::from_value(value).unwrap()
}

fn fs_read(paths: &[&str]) -> Value {
    json!({ "permission": "fs:read", "paths": paths })
}

fn result(response: BridgeResponse) -> Value {
    match response {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(err) => panic!("expected success, got {:?}", err.error),
    }
}

fn failure(response: BridgeResponse) -> desk_bridge::BridgeError {
    match response {
        BridgeResponse::BridgeFailure(err) => err.error,
        BridgeResponse::BridgeSuccess(ok) => panic!("expected failure, got {:?}", ok.result),
    }
}

fn granted_core(home: PathBuf) -> Core {
    let core = Core::new(Roots { home });
    let scope: Permission = serde_json::from_value(fs_read(&["~/Documents/**"])).unwrap();
    core.grant("desk", scope);
    core
}

#[test]
fn fs_read_returns_the_file_through_a_granted_scope() {
    let core = granted_core(temp_home());
    let response = core.handle(
        "desk",
        request(json!({ "id": 1, "method": "fs.read",
            "params": { "path": "~/Documents/hello.md", "scope": fs_read(&["~/Documents/**"]) } })),
    );
    assert_eq!(
        result(response),
        json!({ "content": "# Hello", "encoding": "utf8" })
    );
}

#[test]
fn fs_read_can_return_base64() {
    let core = granted_core(temp_home());
    let response = core.handle(
        "desk",
        request(json!({ "id": 2, "method": "fs.read",
            "params": { "path": "~/Documents/notes/a.txt", "encoding": "base64",
                        "scope": fs_read(&["~/Documents/**"]) } })),
    );
    assert_eq!(
        result(response),
        json!({ "content": "YWJj", "encoding": "base64" })
    );
}

#[test]
fn fs_list_returns_sorted_entries_with_kinds() {
    // A grant on dir/** also covers listing dir itself.
    let core = granted_core(temp_home());
    let response = core.handle(
        "desk",
        request(json!({ "id": 3, "method": "fs.list",
            "params": { "path": "~/Documents", "scope": fs_read(&["~/Documents/**"]) } })),
    );
    assert_eq!(
        result(response),
        json!({ "entries": [
            { "name": "hello.md", "kind": "file", "size": 7 },
            { "name": "notes", "kind": "dir" }
        ] })
    );
}

#[test]
fn a_call_without_a_grant_is_denied_and_names_the_permission() {
    let core = Core::new(Roots { home: temp_home() });
    let scope = fs_read(&["~/Documents/**"]);
    let error = failure(core.handle(
        "desk",
        request(json!({ "id": 5, "method": "fs.read",
            "params": { "path": "~/Documents/hello.md", "scope": scope } })),
    ));
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert_eq!(
        serde_json::to_value(error.permission).unwrap(),
        fs_read(&["~/Documents/**"])
    );
}

#[test]
fn methods_the_core_does_not_serve_yet_are_unsupported() {
    let core = Core::new(Roots { home: temp_home() });
    let error = failure(core.handle(
        "desk",
        request(json!({ "id": 6, "method": "net.fetch",
            "params": { "url": "https://example.com", "scope": { "permission": "net:fetch", "hosts": ["example.com"] } } })),
    ));
    assert_eq!(error.code, ErrorCode::Unsupported);
}

#[test]
fn perm_query_lists_the_callers_grants() {
    let core = granted_core(temp_home());
    let grants = result(core.handle(
        "desk",
        request(json!({ "id": 7, "method": "perm.query", "params": {} })),
    ));
    assert_eq!(grants["grants"].as_array().unwrap().len(), 1);
    assert_eq!(
        grants["grants"][0]["permission"],
        fs_read(&["~/Documents/**"])
    );
}

fn install_hello(core: &Core, home: &std::path::Path) {
    let dir = home.join("plugins/hello");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    fs::write(
        dir.join("plugin.json"),
        r#"{ "id": "example.hello", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" }"#,
    )
    .unwrap();
    core.install_plugin(&dir, false);
}

#[test]
fn plugin_methods_need_plugin_manage() {
    let home = temp_home();
    let core = Core::new(Roots { home: home.clone() });
    install_hello(&core, &home);
    let error = failure(core.handle(
        "desk",
        request(json!({ "id": 8, "method": "plugin.list",
            "params": { "scope": { "permission": "plugin:manage" } } })),
    ));
    assert_eq!(error.code, ErrorCode::PermissionDenied);
}

#[test]
fn plugin_list_and_set_enabled_go_through_the_registry() {
    let home = temp_home();
    let core = Core::new(Roots { home: home.clone() });
    install_hello(&core, &home);
    core.grant(
        "desk",
        serde_json::from_value(json!({ "permission": "plugin:manage" })).unwrap(),
    );
    let events = core.events().subscribe();
    let scope = json!({ "permission": "plugin:manage" });

    let listed = result(core.handle(
        "desk",
        request(json!({ "id": 9, "method": "plugin.list", "params": { "scope": scope } })),
    ));
    assert_eq!(listed["plugins"][0]["id"], "example.hello");
    assert_eq!(listed["plugins"][0]["status"], "ready");

    let changed = result(core.handle(
        "desk",
        request(json!({ "id": 10, "method": "plugin.setEnabled",
            "params": { "plugin": "example.hello", "enabled": false, "scope": scope } })),
    ));
    assert_eq!(changed["plugin"]["enabled"], false);
    let event = serde_json::to_value(events.try_recv().unwrap()).unwrap();
    assert_eq!(event["event"], "plugin.changed");
    assert_eq!(event["data"]["change"], "disabled");

    let missing = failure(core.handle(
        "desk",
        request(json!({ "id": 11, "method": "plugin.setEnabled",
            "params": { "plugin": "example.missing", "enabled": true, "scope": scope } })),
    ));
    assert_eq!(missing.code, ErrorCode::NotFound);
}
