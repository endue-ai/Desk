//! desk-sys net primitives (feature `net`): fetch over http and https with a host allowlist.
//!
//! Every server is an in-process `TcpListener` on 127.0.0.1; nothing here touches the network.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use desk_sys::ErrorCode;
use desk_sys::net::{Method, Request, fetch, host_allowed};

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

/// A server that answers each connection with `respond(port, request)` and reports what it saw.
fn serve(respond: fn(u16, &Seen) -> String) -> (u16, Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let seen = read_request(&mut stream);
            let response = respond(port, &seen);
            let _ = stream.write_all(response.as_bytes());
            if sender.send(seen).is_err() {
                return;
            }
        }
    });
    (port, receiver)
}

fn response(status: &str, headers: &[(&str, &str)], body: &str) -> String {
    let mut text = format!(
        "HTTP/1.1 {status}\r\nconnection: close\r\ncontent-length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    text.push_str("\r\n");
    text.push_str(body);
    text
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

fn local(url: String) -> Request {
    Request {
        url,
        allowed_hosts: vec!["127.0.0.1".to_owned()],
        timeout: Some(Duration::from_secs(10)),
        ..Request::default()
    }
}

#[test]
fn fetch_sends_method_headers_and_body() {
    let (port, seen) = serve(|_, _| response("201 Created", &[("x-reply", "yes")], "made"));
    let mut request = local(format!("http://127.0.0.1:{port}/items?q=1"));
    request.method = Method::Post;
    request
        .headers
        .insert("X-Token".to_owned(), "abc".to_owned());
    request.body = Some(b"{\"name\":\"desk\"}".to_vec());
    let response = fetch(&request).unwrap();
    assert_eq!(response.status, 201);
    assert_eq!(
        response.headers.get("x-reply").map(String::as_str),
        Some("yes")
    );
    assert_eq!(response.body, b"made");

    let seen = seen.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(seen.method, "POST");
    assert_eq!(seen.target, "/items?q=1");
    assert_eq!(seen.headers.get("x-token").map(String::as_str), Some("abc"));
    assert_eq!(seen.body, b"{\"name\":\"desk\"}");
}

#[test]
fn non_2xx_statuses_are_results() {
    let (port, _seen) =
        serve(|_, _| response("404 Not Found", &[("x-why", "gone")], "nothing here"));
    let response = fetch(&local(format!("http://127.0.0.1:{port}/missing"))).unwrap();
    assert_eq!(response.status, 404);
    assert_eq!(
        response.headers.get("x-why").map(String::as_str),
        Some("gone")
    );
    assert_eq!(response.body, b"nothing here");
}

#[test]
fn hosts_outside_the_allowlist_fail_before_connecting() {
    let (listener, port) = untouched();
    let mut request = local(format!("http://127.0.0.1:{port}/"));
    request.allowed_hosts = vec!["example.com".to_owned()];
    let err = fetch(&request).unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert!(err.message.contains("127.0.0.1"), "{err}");
    assert_no_connection(&listener);
}

#[test]
fn redirects_inside_the_allowlist_are_followed() {
    let (final_port, final_seen) = serve(|_, _| response("200 OK", &[], "arrived"));
    // The redirecting server learns the final port from the request path.
    let (port, _seen) = serve(|_, seen| {
        let to = seen.target.trim_start_matches("/to/");
        response(
            "303 See Other",
            &[("location", &format!("http://127.0.0.1:{to}/end"))],
            "",
        )
    });
    let mut request = local(format!("http://127.0.0.1:{port}/to/{final_port}"));
    request.method = Method::Post;
    request.body = Some(b"form".to_vec());
    let response = fetch(&request).unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(response.body, b"arrived");
    let seen = final_seen.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(
        (seen.method.as_str(), seen.target.as_str()),
        ("GET", "/end")
    );
    assert!(seen.body.is_empty(), "303 drops the body");
}

#[test]
fn a_redirect_outside_the_allowlist_fails_before_connecting() {
    let (listener, outside) = untouched();
    let (port, _seen) = serve(|_, seen| {
        let to = seen.target.trim_start_matches("/to/");
        response(
            "302 Found",
            &[("location", &format!("http://localhost:{to}/"))],
            "",
        )
    });
    let err = fetch(&local(format!("http://127.0.0.1:{port}/to/{outside}"))).unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert!(err.message.contains("localhost"), "{err}");
    assert_no_connection(&listener);

    // A pattern with a port covers only that port, so a redirect to another port is outside too.
    let (listener, outside) = untouched();
    let (port, _seen) = serve(|_, seen| {
        let to = seen.target.trim_start_matches("/to/");
        response(
            "307 Temporary Redirect",
            &[("location", &format!("http://127.0.0.1:{to}/"))],
            "",
        )
    });
    let mut request = local(format!("http://127.0.0.1:{port}/to/{outside}"));
    request.allowed_hosts = vec![format!("127.0.0.1:{port}")];
    let err = fetch(&request).unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert_no_connection(&listener);
}

#[test]
fn host_patterns_match_exact_hosts_subdomains_and_ports() {
    let hosts = |list: &[&str]| list.iter().map(|h| (*h).to_owned()).collect::<Vec<_>>();
    let exact = hosts(&["api.example.com"]);
    assert!(host_allowed(&exact, "https://api.example.com/v1"));
    assert!(host_allowed(&exact, "http://API.Example.COM:8080/"));
    assert!(!host_allowed(&exact, "https://example.com/"));
    assert!(!host_allowed(&exact, "https://evil-api.example.com/"));

    let sub = hosts(&["*.example.com"]);
    assert!(host_allowed(&sub, "https://a.b.example.com/"));
    assert!(!host_allowed(&sub, "https://example.com/"));
    assert!(!host_allowed(&sub, "https://notexample.com/"));

    let port = hosts(&["localhost:8787", "secure.example.com:443"]);
    assert!(host_allowed(&port, "http://localhost:8787/v0"));
    assert!(!host_allowed(&port, "http://localhost:8788/v0"));
    assert!(!host_allowed(&port, "http://localhost/v0"));
    assert!(host_allowed(&port, "https://secure.example.com/"));
    assert!(!host_allowed(&port, "http://secure.example.com/"));

    assert!(!host_allowed(&exact, "not a url"));
    assert!(!host_allowed(&[], "https://api.example.com/"));
}

#[test]
fn slow_responses_report_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        // Accept and read, then never answer.
        let (mut stream, _) = listener.accept().unwrap();
        read_request(&mut stream);
        thread::sleep(Duration::from_secs(30));
    });
    let mut request = local(format!("http://127.0.0.1:{port}/slow"));
    request.timeout = Some(Duration::from_millis(300));
    let started = Instant::now();
    let err = fetch(&request).unwrap_err();
    assert_eq!(err.code, ErrorCode::Timeout, "{err}");
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn https_speaks_tls() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, received) = mpsc::channel();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut head = [0u8; 3];
        stream.read_exact(&mut head).unwrap();
        sender.send(head).unwrap();
        // Dropping the stream ends the handshake.
    });
    let err = fetch(&local(format!("https://127.0.0.1:{port}/"))).unwrap_err();
    assert_eq!(err.code, ErrorCode::IoError, "{err}");
    let head = received.recv_timeout(Duration::from_secs(5)).unwrap();
    // A TLS record: handshake (22), version 3.x.
    assert_eq!(
        head[..2],
        [0x16, 0x03],
        "the client did not start a TLS handshake"
    );
}

#[test]
fn bad_urls_and_schemes_are_invalid_params() {
    for url in [
        "not a url",
        "ftp://127.0.0.1/file",
        "file:///etc/hosts",
        "http://",
    ] {
        let err = fetch(&local(url.to_owned())).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams, "{url}: {err}");
    }
    let mut request = local("http://127.0.0.1:1/".to_owned());
    request
        .headers
        .insert("bad header".to_owned(), "x".to_owned());
    let err = fetch(&request).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidParams, "{err}");
}
