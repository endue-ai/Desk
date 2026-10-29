//! Every host import reaches `Host` as the calling plugin, behind the permissions its manifest
//! declares; what is refused answers permission-denied, and text that is not JSON invalid-params.

mod common;

use std::sync::Arc;

use common::{MockHost, hello_wasm};
use desk_bridge::PluginManifest;
use desk_plugin_host::{Command, Duration, ErrorCode, Failure, FailureCode, Imports, Limits};
use desk_plugin_host::{LogLevel, LogicHost, NotifyLevel, PluginError, Request};
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
        { "permission": "cmd:invoke", "ids": ["example.*"] },
        { "permission": "events:subscribe", "names": ["cmd.changed"] },
        { "permission": "settings:read", "keys": ["example.other/*"] },
        { "permission": "log:read" },
    ])
}

fn command(id: &str) -> Command {
    Command {
        id: id.into(),
        title: "Run".into(),
        description: None,
        keywords: vec!["go".into()],
        args_schema: Some(r#"{"type":"object"}"#.into()),
        when: None,
    }
}

const NOTIFY: &str = r#"{"permission":"ui:notify"}"#;

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

    imports.cmd_register(command("test.imports.run")).unwrap();
    imports.cmd_unregister("test.imports.run").unwrap();
    assert_eq!(imports.cmd_list().unwrap()[0].provider, "test.imports");
    let invocation = imports
        .cmd_invoke("example.other.run", Some(r#"{"n":1}"#))
        .unwrap();
    imports.cmd_answer("inv-9", Ok(r#""done""#)).unwrap();
    let subscription = imports.events_subscribe(&["cmd.changed".into()]).unwrap();
    imports.events_unsubscribe(&subscription).unwrap();
    assert_eq!(
        imports.settings_get("theme", Some("example.other")).unwrap(),
        None
    );
    imports.settings_set("theme", r#""dark""#).unwrap();
    assert_eq!(imports.settings_list(true).unwrap()[0].value, r#""dark""#);
    imports
        .log_write(LogLevel::Warn, "careful", Some(r#"{"n":1}"#))
        .unwrap();
    let tail = imports.log_tail(Some("test.imports"), Some(5)).unwrap();
    assert_eq!(tail[0].fields.as_deref(), Some(r#"{"n":1}"#));
    let decision = imports
        .perm_request(NOTIFY, "to say hi", Some(Duration::Once))
        .unwrap();
    assert!(decision.granted);

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
        ("cmd.register", "test.imports.run"),
        ("cmd.unregister", "test.imports.run"),
        ("cmd.list", ""),
        ("cmd.invoke", r#"example.other.run {"n":1}"#),
        ("cmd.answer", r#"inv-9 ok "done""#),
        ("events.subscribe", "cmd.changed"),
        ("events.unsubscribe", subscription.as_str()),
        ("settings.get", "example.other/theme"),
        ("settings.set", r#"theme "dark""#),
        ("settings.list", "others=true"),
        ("log.write", "warn careful"),
        ("log.tail", "test.imports 5"),
        ("perm.request", "ui:notify once: to say hi"),
    ]
    .map(|(method, arg)| (format!("test.imports {method}"), arg.to_owned()));
    assert_eq!(calls, expected);
    assert_eq!(host.stored("test.imports", "k"), Some(json!({ "a": 1 })));
    assert!(invocation.starts_with("inv-"), "{invocation}");
    assert_eq!(
        host.lines(),
        [(
            "test.imports".to_owned(),
            LogLevel::Warn,
            "careful".to_owned(),
            Some(json!({ "n": 1 }))
        )]
    );
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
        imports.cmd_list().map(drop).unwrap_err(),
        imports
            .cmd_invoke("example.other.run", None)
            .map(drop)
            .unwrap_err(),
        imports
            .events_subscribe(&["cmd.changed".into()])
            .map(drop)
            .unwrap_err(),
        imports
            .settings_get("theme", Some("example.other"))
            .map(drop)
            .unwrap_err(),
        imports.settings_list(true).map(drop).unwrap_err(),
        imports.log_tail(None, None).map(drop).unwrap_err(),
    ];
    for error in &denied {
        assert_eq!(error.code, ErrorCode::PermissionDenied, "{error:?}");
    }
    assert!(host.calls().is_empty(), "{:?}", host.calls());

    // perm.query, perm.request, the store and the plugin's own commands, answers, subscriptions,
    // settings and log need no permission, as on the bridge.
    imports.perm_query();
    imports.store_set("k", "1").unwrap();
    imports.cmd_register(command("test.imports.run")).unwrap();
    imports.cmd_unregister("test.imports.run").unwrap();
    let gave_up = Failure {
        code: FailureCode::Cancelled,
        message: "gave up".into(),
    };
    imports.cmd_answer("inv-1", Err(gave_up)).unwrap();
    imports.events_unsubscribe("sub-1").unwrap();
    imports.settings_get("theme", None).unwrap();
    imports.settings_get("theme", Some("test.imports")).unwrap();
    imports.settings_set("theme", "1").unwrap();
    imports.settings_list(false).unwrap();
    imports.log_write(LogLevel::Info, "hi", None).unwrap();
    imports.perm_request(NOTIFY, "to say hi", None).unwrap();
    assert_eq!(host.calls().len(), 12, "{:?}", host.calls());
}

#[test]
fn json_crosses_the_wit_as_text() {
    let host = MockHost::new();
    let imports = Imports::new(&manifest(everything()), host.clone());
    let bad_schema = Command {
        args_schema: Some("{".into()),
        ..command("test.imports.run")
    };

    let invalid = [
        imports
            .cmd_invoke("example.other.run", Some("{not json"))
            .map(drop)
            .unwrap_err(),
        imports.cmd_answer("inv-1", Ok("not json")).unwrap_err(),
        imports.cmd_register(bad_schema).unwrap_err(),
        imports.settings_set("theme", "dark").unwrap_err(),
        imports
            .log_write(LogLevel::Info, "hi", Some("fields"))
            .unwrap_err(),
        imports
            .perm_request("ui:notify", "to say hi", None)
            .map(drop)
            .unwrap_err(),
    ];
    for error in &invalid {
        assert_eq!(error.code, ErrorCode::InvalidParams, "{error:?}");
    }
    assert!(host.calls().is_empty(), "{:?}", host.calls());
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
