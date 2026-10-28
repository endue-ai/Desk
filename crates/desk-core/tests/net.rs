//! net.fetch through Core::handle, against one-shot HTTP servers on 127.0.0.1.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;

use desk_bridge::{BridgeError, BridgeRequest, BridgeResponse, ErrorCode};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

/// A server that answers each of `responses` in turn; returns its host:port.
fn serve(responses: Vec<String>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let host = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    thread::spawn(move || {
        for response in responses {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok() && line != "\r\n" {
                line.clear();
            }
            let _ = stream.write_all(response.as_bytes());
        }
    });
    host
}

fn ok(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn redirect(to: &str) -> String {
    format!(
        "HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
}

fn scope(hosts: &[&str]) -> Value {
    json!({ "permission": "net:fetch", "hosts": hosts })
}

fn fetch(core: &Core, url: &str, scope: &Value) -> Result<Value, BridgeError> {
    let request: BridgeRequest = serde_json::from_value(json!({
        "id": 1, "method": "net.fetch", "params": { "url": url, "timeoutMs": 5000, "scope": scope }
    }))
    .unwrap();
    match core.handle("desk", request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error),
    }
}

fn granted(hosts: &[&str]) -> Core {
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    });
    core.grant("desk", serde_json::from_value(scope(hosts)).unwrap());
    core
}

#[test]
fn a_host_inside_the_scope_is_fetched() {
    let host = serve(vec![ok("hello")]);
    let core = granted(&[&host]);
    let result = fetch(&core, &format!("http://{host}/a"), &scope(&[&host])).unwrap();
    assert_eq!(result["status"], 200);
    assert_eq!(result["body"], "hello");
    assert_eq!(result["bodyEncoding"], "utf8");
    assert_eq!(result["headers"]["content-length"], "5");
}

#[test]
fn a_host_outside_the_scope_is_denied() {
    let host = serve(vec![ok("secret")]);
    let core = granted(&["example.com"]);
    let error = fetch(&core, &format!("http://{host}/"), &scope(&["example.com"])).unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
}

#[test]
fn redirects_are_followed_inside_the_scope_only() {
    let inner = serve(vec![ok("landed")]);
    let outer = serve(vec![redirect(&format!("http://{inner}/landing"))]);
    let both = scope(&[&outer, &inner]);
    let core = granted(&[&outer, &inner]);
    let result = fetch(&core, &format!("http://{outer}/go"), &both).unwrap();
    assert_eq!(result["body"], "landed");

    let elsewhere = serve(vec![ok("not for you")]);
    let outer = serve(vec![redirect(&format!("http://{elsewhere}/"))]);
    let core = granted(&[&outer]);
    let result = fetch(&core, &format!("http://{outer}/go"), &scope(&[&outer])).unwrap();
    assert_eq!(result["status"], 302, "the redirect itself comes back");
    assert_eq!(
        result["headers"]["location"],
        format!("http://{elsewhere}/")
    );
}

#[test]
fn a_missed_timeout_is_a_timeout_error() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let host = format!("127.0.0.1:{}", listener.local_addr().unwrap().port());
    let core = granted(&[&host]);
    let request: BridgeRequest = serde_json::from_value(json!({
        "id": 1, "method": "net.fetch",
        "params": { "url": format!("http://{host}/slow"), "timeoutMs": 200, "scope": scope(&[&host]) }
    }))
    .unwrap();
    let BridgeResponse::BridgeFailure(failure) = core.handle("desk", request) else {
        panic!("expected a timeout");
    };
    assert_eq!(failure.error.code, ErrorCode::Timeout);
    drop(listener);
}
