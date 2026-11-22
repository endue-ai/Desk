//! db.* through `Core::handle` without a database server (ADR 0281): the permission engine checks
//! the host and port against a `db:connect` scope before anything connects, agents are refused,
//! another engine is unsupported, the settings and limits ADR 0281 sets are checked, an unreachable
//! host is an `io_error`, and another caller's or an unknown session is `not_found`.
//!
//! Every server here is an in-process `TcpListener` on 127.0.0.1; nothing touches the network.

mod support;

use std::net::TcpListener;
use std::thread;
use std::time::{Duration, Instant};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, install_hello_declaring, roots};

const DATABASE: &str = "example.database";

fn core() -> Core {
    Core::new(roots(&home("db")))
}

fn scope(host: &str) -> Value {
    json!({ "permission": "db:connect", "hosts": [host] })
}

fn open(core: &Core, caller: &str, port: u16, extra: Value) -> Result<Value, BridgeError> {
    let mut params = json!({ "engine": "postgresql", "host": "127.0.0.1", "port": port,
        "database": "shop", "user": "reader", "password": "fixture-password",
        "scope": scope("127.0.0.1") });
    for (key, value) in extra.as_object().unwrap() {
        params[key] = value.clone();
    }
    call(core, caller, "db.open", params)
}

/// A port nobody listens on: bound, then let go.
fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

#[test]
fn a_session_outside_the_scope_or_the_grants_is_refused_before_it_connects() {
    let core = core();
    let port = free_port();
    let ungranted = open(&core, DATABASE, port, json!({})).unwrap_err();
    assert_eq!(ungranted.code, ErrorCode::PermissionDenied, "no grant");
    grant(&core, DATABASE, scope("db.example.test"));
    let outside = open(
        &core,
        DATABASE,
        port,
        json!({ "scope": scope("db.example.test") }),
    );
    assert_eq!(
        outside.unwrap_err().code,
        ErrorCode::PermissionDenied,
        "scope misses the host"
    );
    grant(&core, DATABASE, scope(&format!("127.0.0.1:{}", port + 1)));
    let other_port = open(&core, DATABASE, port, json!({})).unwrap_err();
    assert_eq!(
        other_port.code,
        ErrorCode::PermissionDenied,
        "a grant for another port"
    );
    assert_eq!(core.database_count(), 0);
}

#[test]
fn net_connect_does_not_cover_a_database_session() {
    let core = core();
    grant(
        &core,
        DATABASE,
        json!({ "permission": "net:connect", "hosts": ["127.0.0.1"] }),
    );
    let refused = open(&core, DATABASE, free_port(), json!({})).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
}

#[test]
fn a_plugin_that_does_not_declare_db_connect_is_refused_whatever_it_holds() {
    let home = home("db");
    let core = Core::new(roots(&home));
    let declared = json!([{ "permission": "net:connect", "hosts": ["*"] }]);
    install_hello_declaring(&core, &home, declared);
    grant(&core, "example.hello", scope("127.0.0.1"));
    let refused = open(&core, "example.hello", free_port(), json!({})).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
}

#[test]
fn agents_are_refused() {
    let core = core();
    let agent = "agent:helper";
    for (method, params) in [
        (
            "db.open",
            json!({ "engine": "postgresql", "host": "127.0.0.1", "database": "shop",
            "user": "reader", "scope": scope("127.0.0.1") }),
        ),
        ("db.run", json!({ "sessionId": "d-1", "sql": "SELECT 1" })),
        (
            "db.script",
            json!({ "sessionId": "d-1", "statements": [{ "sql": "SELECT 1" }] }),
        ),
        ("db.describe", json!({ "sessionId": "d-1", "sql": "SELECT $1" })),
        ("db.list", json!({})),
        ("db.close", json!({ "sessionId": "d-1" })),
    ] {
        let refused = call(&core, agent, method, params).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{method}");
    }
}

#[test]
fn another_engine_is_unsupported() {
    let core = core();
    grant(&core, DATABASE, scope("127.0.0.1"));
    let other = open(&core, DATABASE, free_port(), json!({ "engine": "mysql" })).unwrap_err();
    assert_eq!(other.code, ErrorCode::Unsupported);
}

#[test]
fn reserved_settings_and_page_limits_are_invalid_params() {
    let core = core();
    grant(&core, DATABASE, scope("127.0.0.1"));
    let port = free_port();
    for name in [
        "client_encoding",
        "user",
        "database",
        "replication",
        "Client_Encoding",
    ] {
        let settings = json!({ "settings": { name: "x" } });
        let refused = open(&core, DATABASE, port, settings).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidParams, "{name}");
    }
    let slow = open(&core, DATABASE, port, json!({ "timeoutMs": 120_001 })).unwrap_err();
    assert_eq!(slow.code, ErrorCode::InvalidParams);
    for limits in [
        json!({ "pageRows": 0 }),
        json!({ "pageRows": 10_001 }),
        json!({ "pageBytes": 65_535 }),
        json!({ "pageBytes": 16_777_217 }),
    ] {
        let mut params = json!({ "sessionId": "d-1", "sql": "SELECT 1" });
        for (key, value) in limits.as_object().unwrap() {
            params[key] = value.clone();
        }
        let refused = call(&core, DATABASE, "db.run", params).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidParams, "{limits}");
    }
    assert_eq!(core.database_count(), 0);
}

#[test]
fn a_refused_host_is_an_io_error_and_a_silent_one_a_timeout() {
    let core = core();
    grant(&core, DATABASE, scope("127.0.0.1"));
    let refused = open(&core, DATABASE, free_port(), json!({})).unwrap_err();
    assert_eq!(refused.code, ErrorCode::IoError, "{refused:?}");

    // A server that takes the connection and never answers.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let held: Vec<_> = listener.incoming().take(1).collect();
        thread::sleep(Duration::from_secs(5));
        drop(held);
    });
    let started = Instant::now();
    let silent = open(&core, DATABASE, port, json!({ "timeoutMs": 300 })).unwrap_err();
    assert_eq!(silent.code, ErrorCode::Timeout, "{silent:?}");
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(
        core.database_count(),
        0,
        "a failed open leaves nothing behind"
    );
}

#[test]
fn an_unknown_or_another_callers_session_is_not_found() {
    let core = core();
    for (method, params) in [
        ("db.run", json!({ "sessionId": "d-9", "sql": "SELECT 1" })),
        (
            "db.script",
            json!({ "sessionId": "d-9", "statements": [{ "sql": "SELECT 1" }] }),
        ),
        ("db.describe", json!({ "sessionId": "d-9", "sql": "SELECT $1" })),
        ("db.fetch", json!({ "sessionId": "d-9" })),
        ("db.copy", json!({ "sessionId": "d-9", "done": true })),
        ("db.cancel", json!({ "sessionId": "d-9" })),
    ] {
        let missing = call(&core, DATABASE, method, params).unwrap_err();
        assert_eq!(missing.code, ErrorCode::NotFound, "{method}");
    }
    call(&core, DATABASE, "db.close", json!({ "sessionId": "d-9" })).unwrap();
    let listed = call(&core, DATABASE, "db.list", json!({})).unwrap();
    assert_eq!(listed, json!({ "sessions": [] }));
}
