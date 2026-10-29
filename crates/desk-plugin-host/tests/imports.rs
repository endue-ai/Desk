//! Every host import reaches `Host` as the calling plugin, behind the permissions its manifest
//! declares; what is refused answers permission-denied.

mod common;

use std::sync::Arc;

use common::{MockHost, hello_wasm};
use desk_bridge::PluginManifest;
use desk_plugin_host::{ErrorCode, Imports, Limits, LogicHost, NotifyLevel, PluginError, Request};
use serde_json::{Value, json};

fn manifest(permissions: Value) -> PluginManifest {
    serde_json::from_value(json!({
        "id": "test.imports",
        "version": "0.1.0",
        "kind": "logic",
        "entry": "plugin.wasm",
        "permissions": permissions,
    }))
    .unwrap()
}

fn everything() -> Value {
    json!([
        { "permission": "fs:read", "paths": ["${plugin}/**"] },
        { "permission": "fs:write", "paths": ["${plugin}/out/**"] },
        { "permission": "net:fetch", "hosts": ["example.com"] },
        { "permission": "ui:notify" },
    ])
}

fn request() -> Request {
    Request {
        url: "https://example.com/".into(),
        method: "GET".into(),
        headers: vec![],
        body: None,
        timeout_ms: None,
    }
}

#[test]
fn every_import_reaches_the_host_as_the_plugin() {
    let host = MockHost::with_file("${plugin}/a.txt", b"abc");
    let imports = Imports::new(&manifest(everything()), host.clone());

    assert_eq!(imports.fs_read("${plugin}/a.txt").unwrap(), b"abc");
    assert_eq!(imports.fs_list("${plugin}").unwrap()[0].name, "hello.txt");
    assert_eq!(
        imports
            .fs_write("${plugin}/out/b.txt", b"hello", true)
            .unwrap(),
        5
    );
    assert_eq!(imports.net_fetch(request()).unwrap().status, 200);
    imports
        .ui_notify("Hi", Some("there"), NotifyLevel::Success)
        .unwrap();
    assert_eq!(imports.perm_query()[0].grant_id, "g1");
    imports.store_set("k", r#"{"a":1}"#).unwrap();
    assert_eq!(
        imports.store_get("k").unwrap().as_deref(),
        Some(r#"{"a":1}"#)
    );

    let calls: Vec<(String, String)> = host
        .calls()
        .into_iter()
        .map(|(plugin, method, arg)| (format!("{plugin} {method}"), arg))
        .collect();
    let expected = [
        ("fs.read", "${plugin}/a.txt"),
        ("fs.list", "${plugin}"),
        ("fs.write", "${plugin}/out/b.txt create_dirs=true"),
        ("net.fetch", "GET https://example.com/"),
        ("ui.notify", "Hi"),
        ("perm.query", ""),
        ("store.set", "k"),
        ("store.get", "k"),
    ]
    .map(|(method, arg)| (format!("test.imports {method}"), arg.to_owned()));
    assert_eq!(calls, expected);
    assert_eq!(host.stored("test.imports", "k"), Some(json!({ "a": 1 })));
}

#[test]
fn store_values_are_json() {
    let host = MockHost::new();
    let imports = Imports::new(&manifest(json!([])), host.clone());
    let error = imports.store_set("k", "not json").unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidParams);
    assert_eq!(imports.store_get("missing").unwrap(), None);
}

#[test]
fn an_import_without_its_permission_in_the_manifest_answers_permission_denied() {
    let host = MockHost::with_file("${plugin}/a.txt", b"abc");
    let imports = Imports::new(&manifest(json!([])), host.clone());

    let denied = [
        imports.fs_read("${plugin}/a.txt").map(drop).unwrap_err(),
        imports.fs_list("${plugin}").map(drop).unwrap_err(),
        imports
            .fs_write("${plugin}/b.txt", b"x", false)
            .map(drop)
            .unwrap_err(),
        imports.net_fetch(request()).map(drop).unwrap_err(),
        imports
            .ui_notify("Hi", None, NotifyLevel::Info)
            .unwrap_err(),
    ];
    for error in &denied {
        assert_eq!(error.code, ErrorCode::PermissionDenied, "{error:?}");
    }
    assert!(host.calls().is_empty(), "{:?}", host.calls());

    // perm.query and the store need no permission, as on the bridge.
    imports.perm_query();
    imports.store_set("k", "1").unwrap();
    assert_eq!(host.calls().len(), 2);
}

#[test]
fn an_import_the_host_refuses_answers_permission_denied() {
    let host = MockHost::with_file("${plugin}/hello.txt", b"Hi");
    host.refuse("fs.read");
    let mut logic = LogicHost::new(Arc::clone(&host) as _, Limits::default()).unwrap();
    let id = logic.install(&hello_wasm()).unwrap();

    let result = logic.start(&id);
    match result {
        Err(PluginError::Guest(error)) => assert_eq!(error.code, ErrorCode::PermissionDenied),
        other => panic!("expected the guest to pass on permission-denied, got {other:?}"),
    }
    assert!(host.notes().is_empty());
}
