//! net.fetch through `Core::handle`: the permission engine checks the URL's host against the scope
//! before anything connects, desk-sys checks every redirect against the same hosts, statuses are
//! results, a body that is not text comes back as base64, and a missed `timeoutMs` is `timeout`.
//!
//! Every server is an in-process `TcpListener` on 127.0.0.1; nothing here touches the network.

mod support;

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const FETCHER: &str = "example.fetch";
const WAIT: Duration = Duration::from_secs(5);

/// What a test server saw of one request.
#[derive(Debug)]
struct Seen {
    method: String,
    target: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Seen {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_owned();
    let target = parts.next().unwrap_or_default().to_owned();
    let mut headers = BTreeMap::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').unwrap();
        headers.insert(name.to_ascii_lowercase(), value.trim().to_owned());
    }
    let length: usize = headers
        .get("content-length")
        .map_or(0, |v| v.parse().unwrap());
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    Seen {
        method,
        target,
        headers,
        body,
    }
}

/// A server that answers each connection with `respond(request)` and reports what it saw.
fn serve(respond: fn(&Seen) -> Vec<u8>) -> (u16, Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let seen = read_request(&mut stream);
            let _ = stream.write_all(&respond(&seen));
            if sender.send(seen).is_err() {
                return;
            }
        }
    });
    (port, receiver)
}

fn response(status: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let mut text = format!(
        "HTTP/1.1 {status}\r\nconnection: close\r\ncontent-length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    text.push_str("\r\n");
    let mut bytes = text.into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

/// A redirect to `http://<host>:<port>/end`, the port taken from the request path `/to/<port>`.
fn redirect_to(host: &str, seen: &Seen) -> Vec<u8> {
    let to = seen.target.trim_start_matches("/to/");
    let location = format!("http://{host}:{to}/end");
    response("302 Found", &[("location", &location)], b"")
}

/// A listener nobody accepts on: any connection attempt stays in its backlog.
fn untouched() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

fn assert_no_connection(listener: &TcpListener) {
    thread::sleep(Duration::from_millis(100));
    listener.set_nonblocking(true).unwrap();
    match listener.accept() {
        Err(err) if err.kind() == ErrorKind::WouldBlock => {}
        other => panic!("the listener was reached: {other:?}"),
    }
}

/// The scope of every call here: the loopback address, any port.
fn local() -> Value {
    json!({ "permission": "net:fetch", "hosts": ["127.0.0.1"] })
}

fn core() -> Core {
    Core::new(roots(&home("net")))
}

fn fetch(core: &Core, params: Value) -> Result<Value, BridgeError> {
    call(core, FETCHER, "net.fetch", params)
}

fn get(core: &Core, url: String) -> Result<Value, BridgeError> {
    fetch(
        core,
        json!({ "url": url, "timeoutMs": 10000, "scope": local() }),
    )
}

#[test]
fn net_fetch_needs_a_grant_covering_the_host() {
    let core = core();
    let (listener, port) = untouched();
    let refused = get(&core, format!("http://127.0.0.1:{port}/")).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(
        serde_json::to_value(refused.permission.unwrap()).unwrap(),
        local(),
        "the missing permission is named"
    );
    assert_no_connection(&listener);

    grant(&core, FETCHER, local());
    let (port, seen) = serve(|_| {
        let headers = [("X-Reply", "Yes"), ("Content-Type", "text/plain")];
        response("200 OK", &headers, b"hello")
    });
    let fetched = get(&core, format!("http://127.0.0.1:{port}/hello")).unwrap();
    assert_eq!(fetched["status"], 200);
    assert_eq!(fetched["body"], "hello");
    assert_eq!(fetched["bodyEncoding"], "utf8");
    let headers = fetched["headers"].as_object().unwrap();
    assert_eq!(headers["x-reply"], "Yes", "{headers:?}");
    assert_eq!(headers["content-type"], "text/plain", "{headers:?}");
    assert!(
        headers
            .keys()
            .all(|name| *name == name.to_ascii_lowercase()),
        "header names are lowercase: {headers:?}"
    );
    let seen = seen.recv_timeout(WAIT).unwrap();
    assert_eq!(
        (seen.method.as_str(), seen.target.as_str()),
        ("GET", "/hello")
    );

    // The scope names 127.0.0.1, not every name that resolves to it.
    let (listener, port) = untouched();
    let refused = get(&core, format!("http://localhost:{port}/")).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(
        serde_json::to_value(refused.permission.unwrap()).unwrap(),
        local()
    );
    assert_no_connection(&listener);
}

#[test]
fn net_fetch_sends_the_request_and_returns_non_2xx_and_binary_bodies_as_results() {
    let core = core();
    grant(&core, FETCHER, local());
    let (port, seen) = serve(|seen| match seen.target.as_str() {
        "/missing" => response("404 Not Found", &[("x-why", "gone")], b"nothing here"),
        "/binary" => response("200 OK", &[], &[0xff, 0x00, 0xfe]),
        _ => response("201 Created", &[], b"made"),
    });
    let url = |path: &str| format!("http://127.0.0.1:{port}{path}");

    let sent = fetch(
        &core,
        json!({ "url": url("/items?q=1"), "method": "POST",
                "headers": { "X-Token": "abc", "content-type": "application/octet-stream" },
                "body": STANDARD.encode([0u8, 1, 2, 0xff]), "bodyEncoding": "base64",
                "timeoutMs": 10000, "scope": local() }),
    )
    .unwrap();
    assert_eq!(sent["status"], 201);
    assert_eq!(sent["body"], "made");
    let seen_post = seen.recv_timeout(WAIT).unwrap();
    assert_eq!(seen_post.method, "POST");
    assert_eq!(seen_post.target, "/items?q=1");
    assert_eq!(
        seen_post.headers.get("x-token").map(String::as_str),
        Some("abc")
    );
    assert_eq!(seen_post.body, [0u8, 1, 2, 0xff], "the body as sent");

    // Without bodyEncoding the body is UTF-8 text.
    let put = json!({ "url": url("/items/1"), "method": "PUT", "body": "{\"name\":\"desk\"}",
                      "scope": local() });
    assert_eq!(fetch(&core, put).unwrap()["status"], 201);
    let seen_put = seen.recv_timeout(WAIT).unwrap();
    assert_eq!(seen_put.method, "PUT");
    assert_eq!(seen_put.body, b"{\"name\":\"desk\"}");

    let missing = get(&core, url("/missing")).unwrap();
    assert_eq!(missing["status"], 404, "a 404 is a result");
    assert_eq!(missing["body"], "nothing here");
    assert_eq!(missing["bodyEncoding"], "utf8");
    assert_eq!(missing["headers"]["x-why"], "gone");

    let binary = get(&core, url("/binary")).unwrap();
    assert_eq!(binary["status"], 200);
    assert_eq!(binary["bodyEncoding"], "base64");
    assert_eq!(binary["body"], STANDARD.encode([0xff, 0x00, 0xfe]));

    let bad = fetch(
        &core,
        json!({ "url": url("/items"), "method": "POST", "body": "not base64!",
                "bodyEncoding": "base64", "scope": local() }),
    )
    .unwrap_err();
    assert_eq!(bad.code, ErrorCode::InvalidParams, "{bad:?}");
}

#[test]
fn net_fetch_refuses_a_redirect_to_a_host_outside_the_scope() {
    let core = core();
    grant(&core, FETCHER, local());

    let (listener, outside) = untouched();
    let (port, seen) = serve(|seen| redirect_to("localhost", seen));
    let refused = get(&core, format!("http://127.0.0.1:{port}/to/{outside}")).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert!(refused.message.contains("localhost"), "{refused:?}");
    assert_no_connection(&listener);
    seen.recv_timeout(WAIT).unwrap();
    assert!(
        seen.recv_timeout(Duration::from_millis(200)).is_err(),
        "the server saw exactly one request"
    );

    let (end, arrived) = serve(|_| response("200 OK", &[], b"arrived"));
    let (port, _seen) = serve(|seen| redirect_to("127.0.0.1", seen));
    let followed = get(&core, format!("http://127.0.0.1:{port}/to/{end}")).unwrap();
    assert_eq!(followed["status"], 200);
    assert_eq!(followed["body"], "arrived", "the final body");
    assert_eq!(arrived.recv_timeout(WAIT).unwrap().target, "/end");
}

#[test]
fn net_fetch_reports_a_missed_timeout_ms_as_timeout() {
    let core = core();
    grant(&core, FETCHER, local());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        // Accept and read, then never answer.
        let (mut stream, _) = listener.accept().unwrap();
        read_request(&mut stream);
        thread::sleep(Duration::from_secs(30));
    });
    let started = Instant::now();
    let slow = fetch(
        &core,
        json!({ "url": format!("http://127.0.0.1:{port}/slow"), "timeoutMs": 200,
                "scope": local() }),
    )
    .unwrap_err();
    assert_eq!(slow.code, ErrorCode::Timeout, "{slow:?}");
    assert!(started.elapsed() < WAIT, "took {:?}", started.elapsed());

    let ftp = fetch(
        &core,
        json!({ "url": "ftp://127.0.0.1/file", "scope": local() }),
    )
    .unwrap_err();
    assert_eq!(ftp.code, ErrorCode::InvalidParams, "{ftp:?}");
}
