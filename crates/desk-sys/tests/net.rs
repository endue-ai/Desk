//! desk-sys net primitive (feature `net`), against a one-shot HTTP server on 127.0.0.1.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

use desk_sys::net::{NetError, Request, fetch};

/// Serve one request with `response` and hand back what the client sent.
fn serve_once(response: &'static str) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut head = String::new();
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse().unwrap();
            }
            head.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        stream.write_all(response.as_bytes()).unwrap();
        head + &String::from_utf8_lossy(&body)
    });
    (url, handle)
}

#[test]
fn a_request_returns_status_headers_and_body() {
    let (url, server) =
        serve_once("HTTP/1.1 201 Created\r\nX-Desk: yes\r\nContent-Length: 5\r\n\r\nhello");
    let response = fetch(&Request {
        method: "POST".to_owned(),
        url: format!("{url}/notes"),
        headers: vec![("x-plugin".to_owned(), "notes".to_owned())],
        body: Some(b"note".to_vec()),
        timeout: Some(Duration::from_secs(5)),
    })
    .unwrap();
    assert_eq!(response.status, 201);
    assert!(
        response
            .headers
            .contains(&("x-desk".to_owned(), "yes".to_owned()))
    );
    assert_eq!(response.body, b"hello");
    let sent = server.join().unwrap();
    assert!(sent.starts_with("POST /notes HTTP/1.1"), "{sent}");
    assert!(sent.to_ascii_lowercase().contains("x-plugin: notes"));
    assert!(sent.ends_with("note"));
}

#[test]
fn redirects_and_errors_are_responses() {
    let (url, _server) = serve_once(
        "HTTP/1.1 302 Found\r\nLocation: http://elsewhere.test/\r\nContent-Length: 0\r\n\r\n",
    );
    let response = fetch(&Request {
        method: "GET".to_owned(),
        url,
        ..Request::default()
    })
    .unwrap();
    assert_eq!(response.status, 302, "not followed");
    assert!(
        response
            .headers
            .contains(&("location".to_owned(), "http://elsewhere.test/".to_owned()))
    );
}

#[test]
fn a_silent_server_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let error = fetch(&Request {
        method: "GET".to_owned(),
        url,
        timeout: Some(Duration::from_millis(200)),
        ..Request::default()
    })
    .unwrap_err();
    assert_eq!(error, NetError::Timeout);
    drop(listener);
}
