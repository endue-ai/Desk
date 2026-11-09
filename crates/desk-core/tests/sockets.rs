//! net.connect, net.send and net.close through `Core::handle` (ADR 0133): the permission engine
//! checks the host and port against a `net:connect` scope before anything connects, bytes arrive as
//! `net.data` for the caller alone and the end as `net.closed`, a socket belongs to its caller, and it
//! closes with the plugin that opened it or the grant that allowed it.
//!
//! Every server is an in-process `TcpListener` on 127.0.0.1; nothing here touches the network.

mod support;

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc::Receiver;
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::{call, grant, home, install_hello, plugin_manage, roots, set_enabled};

const SCREENS: &str = "example.screens";
const WAIT: Duration = Duration::from_secs(10);

fn core() -> Core {
    Core::new(roots(&home("sockets")))
}

fn scope(host: &str) -> Value {
    json!({ "permission": "net:connect", "hosts": [host] })
}

/// A server that greets each connection with `greeting`, then echoes what it reads.
fn echo(greeting: &'static [u8]) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            thread::spawn(move || {
                let _ = stream.write_all(greeting);
                let mut buffer = [0u8; 4096];
                while let Ok(n) = stream.read(&mut buffer) {
                    if n == 0 || stream.write_all(&buffer[..n]).is_err() {
                        return;
                    }
                }
            });
        }
    });
    port
}

fn connect(core: &Core, caller: &str, port: u16, scope: Value) -> Result<String, BridgeError> {
    let params = json!({ "host": "127.0.0.1", "port": port, "scope": scope });
    call(core, caller, "net.connect", params)
        .map(|opened| opened["socketId"].as_str().unwrap().to_owned())
}

/// The bytes `socket_id` received until `want` bytes arrived or it closed, and its net.closed.
fn read(events: &Receiver<Delivery>, socket_id: &str, want: usize) -> (Vec<u8>, Option<Value>) {
    let deadline = Instant::now() + WAIT;
    let mut bytes = Vec::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(delivery) = events.recv_timeout(left) else {
            break;
        };
        let value = serde_json::to_value(&delivery.event).unwrap();
        if value["data"]["socketId"] != socket_id {
            continue;
        }
        assert_eq!(
            delivery.to,
            Some(vec![SCREENS.to_owned()]),
            "only the owner hears it"
        );
        match value["event"].as_str() {
            Some("net.data") => {
                let chunk = value["data"]["data"].as_str().unwrap();
                bytes.extend(STANDARD.decode(chunk).unwrap());
                if bytes.len() >= want {
                    return (bytes, None);
                }
            }
            Some("net.closed") => return (bytes, Some(value["data"].clone())),
            _ => {}
        }
    }
    (bytes, None)
}

fn closed(events: &Receiver<Delivery>, socket_id: &str) -> Value {
    read(events, socket_id, usize::MAX)
        .1
        .unwrap_or_else(|| panic!("no net.closed for {socket_id}"))
}

#[test]
fn a_connection_outside_the_scope_or_the_grants_is_refused_before_it_connects() {
    let core = core();
    let port = echo(b"");
    let outside = connect(&core, SCREENS, port, scope("studio.local")).unwrap_err();
    assert_eq!(
        outside.code,
        ErrorCode::PermissionDenied,
        "scope misses the host"
    );
    let ungranted = connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap_err();
    assert_eq!(ungranted.code, ErrorCode::PermissionDenied, "no grant");
    grant(&core, SCREENS, scope(&format!("127.0.0.1:{}", port + 1)));
    let other_port = connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap_err();
    assert_eq!(
        other_port.code,
        ErrorCode::PermissionDenied,
        "a grant for another port"
    );
    assert_eq!(core.socket_count(), 0);
}

#[test]
fn bytes_go_both_ways_in_order_and_reach_only_the_owner() {
    let core = core();
    // What a screen sharing server says first (RFB 3.8).
    let port = echo(b"RFB 003.008\n");
    grant(&core, SCREENS, scope(&format!("127.0.0.1:{port}")));
    let events = core.events().subscribe_addressed();
    let socket = connect(&core, SCREENS, port, scope(&format!("127.0.0.1:{port}"))).unwrap();
    assert_eq!(core.socket_count(), 1);
    let (greeting, _) = read(&events, &socket, 12);
    assert_eq!(greeting, b"RFB 003.008\n");

    let big: Vec<u8> = (0..200_000u32).map(|n| (n % 251) as u8).collect();
    let data = STANDARD.encode(&big);
    call(
        &core,
        SCREENS,
        "net.send",
        json!({ "socketId": socket, "data": data }),
    )
    .unwrap();
    let (echoed, _) = read(&events, &socket, big.len());
    assert_eq!(
        echoed, big,
        "every byte back, in order, over several events"
    );
}

#[test]
fn a_socket_belongs_to_its_caller() {
    let core = core();
    let port = echo(b"");
    grant(&core, SCREENS, scope("127.0.0.1"));
    let socket = connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap();
    let send = json!({ "socketId": socket, "data": "aGk=" });
    let theirs = call(&core, "example.other", "net.send", send.clone()).unwrap_err();
    assert_eq!(theirs.code, ErrorCode::NotFound);
    call(
        &core,
        "example.other",
        "net.close",
        json!({ "socketId": socket }),
    )
    .unwrap();
    assert_eq!(
        core.socket_count(),
        1,
        "another caller's close changes nothing"
    );
    let bad = call(
        &core,
        SCREENS,
        "net.send",
        json!({ "socketId": socket, "data": "%%" }),
    );
    assert_eq!(bad.unwrap_err().code, ErrorCode::InvalidParams);
}

#[test]
fn closing_ends_the_socket_with_a_reason_and_a_second_close_is_fine() {
    let core = core();
    let port = echo(b"");
    grant(&core, SCREENS, scope("127.0.0.1"));
    let events = core.events().subscribe_addressed();
    let socket = connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap();
    call(&core, SCREENS, "net.close", json!({ "socketId": socket })).unwrap();
    let end = closed(&events, &socket);
    assert_eq!(end["reason"], "closed by the caller");
    assert_eq!(core.socket_count(), 0);
    call(&core, SCREENS, "net.close", json!({ "socketId": socket })).unwrap();
    let gone = call(
        &core,
        SCREENS,
        "net.send",
        json!({ "socketId": socket, "data": "aGk=" }),
    );
    assert_eq!(gone.unwrap_err().code, ErrorCode::NotFound);
}

#[test]
fn the_other_end_closing_is_reported_without_a_reason() {
    let core = core();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.write_all(b"bye").unwrap();
    });
    grant(&core, SCREENS, scope("127.0.0.1"));
    let events = core.events().subscribe_addressed();
    let socket = connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap();
    let (bytes, end) = read(&events, &socket, usize::MAX);
    assert_eq!(bytes, b"bye");
    assert_eq!(end.unwrap(), json!({ "socketId": socket }));
    assert_eq!(core.socket_count(), 0, "an ended socket leaves the table");
}

#[test]
fn a_refused_connection_is_an_io_error_and_a_caller_holds_at_most_eight() {
    let core = core();
    // A port nobody listens on: bound, then let go.
    let free = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    grant(&core, SCREENS, scope("127.0.0.1"));
    let refused = connect(&core, SCREENS, free, scope("127.0.0.1")).unwrap_err();
    assert_eq!(refused.code, ErrorCode::IoError, "{refused:?}");

    let port = echo(b"");
    for _ in 0..8 {
        connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap();
    }
    let ninth = connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap_err();
    assert_eq!(ninth.code, ErrorCode::InvalidValue);
}

#[test]
fn a_revoked_grant_or_a_disabled_plugin_closes_its_sockets() {
    let home = home("sockets");
    let core = Core::new(roots(&home));
    let port = echo(b"");
    let grant_id = grant(&core, SCREENS, scope("127.0.0.1"));
    let events = core.events().subscribe_addressed();
    let socket = connect(&core, SCREENS, port, scope("127.0.0.1")).unwrap();
    call(
        &core,
        SCREENS,
        "perm.revoke",
        json!({ "grantId": grant_id }),
    )
    .unwrap();
    assert_eq!(core.socket_count(), 0, "a revoked grant closes its sockets");
    let end = closed(&events, &socket);
    assert_eq!(end["reason"], "the permission was revoked");

    install_hello(&core, &home);
    grant(&core, "desk", plugin_manage());
    grant(&core, "example.hello", scope("127.0.0.1"));
    let theirs = connect(&core, "example.hello", port, scope("127.0.0.1")).unwrap();
    set_enabled(&core, "example.hello", false);
    assert_eq!(
        core.socket_count(),
        0,
        "a disabled plugin's sockets close: {theirs}"
    );
}

#[test]
fn a_host_that_does_not_answer_in_time_is_a_timeout() {
    let core = core();
    grant(&core, SCREENS, scope("192.0.2.1"));
    // 192.0.2.0/24 is TEST-NET-1: nothing answers there, so the connection waits out its timeout.
    let params = json!({ "host": "192.0.2.1", "port": 5900, "timeoutMs": 200,
        "scope": scope("192.0.2.1") });
    let started = Instant::now();
    let failed = call(&core, SCREENS, "net.connect", params).unwrap_err();
    assert!(
        matches!(failed.code, ErrorCode::Timeout | ErrorCode::IoError),
        "{failed:?}"
    );
    assert!(started.elapsed() < Duration::from_secs(5));
}
