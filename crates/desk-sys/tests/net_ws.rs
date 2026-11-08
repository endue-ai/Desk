//! desk-sys WebSocket streams (feature `net`): the host allowlist on the first URL and every
//! redirect, messages both ways, closing from either end, and wss over TLS.
//!
//! Every server is tungstenite or a raw `TcpListener` on 127.0.0.1; nothing here touches the network.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use desk_sys::ErrorCode;
use desk_sys::net::ws::{self, Event, Message, Request, Socket};
use tungstenite::handshake::server::{Request as Upgrade, Response as Accepted};
use tungstenite::protocol::CloseFrame;
use tungstenite::protocol::frame::coding::CloseCode;

const WAIT: Duration = Duration::from_secs(5);

/// What a WebSocket server saw: the handshake's path and headers, then each message or the end.
#[derive(Debug, PartialEq, Eq)]
enum Seen {
    Handshake {
        path: String,
        headers: BTreeMap<String, String>,
    },
    Message(tungstenite::Message),
    Closed,
}

/// A tungstenite server: every connection's handshake chooses `protocol` when the client offers it,
/// then `run` drives the socket. What the server saw goes to the receiver.
fn ws_server(
    protocol: Option<&'static str>,
    run: fn(&mut tungstenite::WebSocket<TcpStream>, &mpsc::Sender<Seen>),
) -> (u16, Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { return };
            let sender = sender.clone();
            thread::spawn(move || {
                // tungstenite's callback type returns its error response by value.
                #[allow(clippy::result_large_err)]
                let callback = |request: &Upgrade, mut response: Accepted| {
                    let headers = request
                        .headers()
                        .iter()
                        .map(|(name, value)| {
                            let value = value.to_str().unwrap_or_default().to_owned();
                            (name.as_str().to_owned(), value)
                        })
                        .collect::<BTreeMap<_, _>>();
                    let offered = headers.get("sec-websocket-protocol").cloned();
                    if let (Some(protocol), Some(offered)) = (protocol, offered)
                        && offered.split(',').any(|p| p.trim() == protocol)
                    {
                        response
                            .headers_mut()
                            .insert("sec-websocket-protocol", protocol.parse().unwrap());
                    }
                    let path = request.uri().path().to_owned();
                    let _ = sender.send(Seen::Handshake { path, headers });
                    Ok(response)
                };
                let Ok(mut socket) = tungstenite::accept_hdr(stream, callback) else {
                    return;
                };
                run(&mut socket, &sender);
            });
        }
    });
    (port, receiver)
}

/// Echo text and binary messages; report every message, and the end of the connection.
fn echo(socket: &mut tungstenite::WebSocket<TcpStream>, seen: &mpsc::Sender<Seen>) {
    while let Ok(message) = socket.read() {
        let echoed = matches!(
            message,
            tungstenite::Message::Text(_) | tungstenite::Message::Binary(_)
        );
        let _ = seen.send(Seen::Message(message.clone()));
        if echoed && socket.send(message).is_err() {
            break;
        }
    }
    let _ = seen.send(Seen::Closed);
}

fn handshake(seen: &Receiver<Seen>) -> (String, BTreeMap<String, String>) {
    match seen.recv_timeout(WAIT).unwrap() {
        Seen::Handshake { path, headers } => (path, headers),
        other => panic!("expected the handshake, saw {other:?}"),
    }
}

/// Connect with events going to a channel.
fn open(request: &Request) -> Result<(Socket, Receiver<Event>), desk_sys::Error> {
    let (sender, events) = mpsc::channel();
    let socket = ws::connect(request, move |event| {
        let _ = sender.send(event);
    })?;
    Ok((socket, events))
}

fn local(url: String) -> Request {
    Request {
        url,
        allowed_hosts: vec!["127.0.0.1".to_owned()],
        timeout: Some(Duration::from_secs(10)),
        ..Request::default()
    }
}

/// `Closed` arrives, and nothing after it: the callback is dropped.
fn closed_last(events: &Receiver<Event>) -> (u16, String) {
    let closed = loop {
        match events.recv_timeout(WAIT).unwrap() {
            Event::Closed { code, reason } => break (code, reason),
            Event::Message(_) => {}
        }
    };
    assert_eq!(
        events.recv_timeout(WAIT),
        Err(RecvTimeoutError::Disconnected),
        "an event after Closed"
    );
    closed
}

/// A raw HTTP server that answers every handshake with `answer(port, path)`.
fn http_answer(answer: fn(u16, &str) -> String) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let mut reader = BufReader::new(&mut stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let path = line
                .split_whitespace()
                .nth(1)
                .unwrap_or_default()
                .to_owned();
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).unwrap();
                if header.trim_end().is_empty() {
                    break;
                }
            }
            let _ = stream.write_all(answer(port, &path).as_bytes());
        }
    });
    port
}

fn redirect(status: &str, location: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
    )
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

#[test]
fn ws_sends_and_receives_text_and_binary() {
    let (port, seen) = ws_server(Some("chat.v1"), echo);
    let mut request = local(format!("ws://127.0.0.1:{port}/echo?room=1"));
    request.protocols = vec!["chat.v2".to_owned(), "chat.v1".to_owned()];
    request
        .headers
        .insert("X-Token".to_owned(), "abc".to_owned());
    let (socket, events) = open(&request).unwrap();
    assert_eq!(socket.protocol(), Some("chat.v1"));
    let (path, headers) = handshake(&seen);
    assert_eq!(path, "/echo");
    assert_eq!(headers.get("x-token").map(String::as_str), Some("abc"));
    assert_eq!(
        headers.get("sec-websocket-protocol").map(String::as_str),
        Some("chat.v2, chat.v1")
    );

    socket.send(Message::Text("hello".to_owned())).unwrap();
    socket.send(Message::Binary(vec![0, 1, 2, 255])).unwrap();
    assert_eq!(
        events.recv_timeout(WAIT).unwrap(),
        Event::Message(Message::Text("hello".to_owned()))
    );
    assert_eq!(
        events.recv_timeout(WAIT).unwrap(),
        Event::Message(Message::Binary(vec![0, 1, 2, 255]))
    );

    socket.close(1000, "done").unwrap();
    let close = loop {
        match seen.recv_timeout(WAIT).unwrap() {
            Seen::Message(tungstenite::Message::Close(frame)) => break frame,
            Seen::Message(_) => {}
            other => panic!("expected the close frame, saw {other:?}"),
        }
    };
    let close = close.expect("a close frame with a code");
    assert_eq!(u16::from(close.code), 1000);
    assert_eq!(close.reason.as_str(), "done");
    assert_eq!(closed_last(&events), (1000, "done".to_owned()));
}

#[test]
fn ws_hosts_outside_the_allowlist_fail_before_connecting() {
    let (listener, port) = untouched();
    let mut request = local(format!("ws://127.0.0.1:{port}/"));
    request.allowed_hosts = vec!["example.com".to_owned()];
    let err = open(&request).err().expect("connect fails");
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert!(err.message.contains("127.0.0.1"), "{err}");
    assert_no_connection(&listener);
}

#[test]
fn ws_redirects_inside_the_allowlist_are_followed() {
    let (final_port, seen) = ws_server(None, echo);
    // The redirecting server learns the final port from the request path; an http Location is a ws one.
    let port = http_answer(|_, path| {
        let to = path.trim_start_matches("/to/");
        redirect(
            "307 Temporary Redirect",
            &format!("http://127.0.0.1:{to}/end"),
        )
    });
    let (socket, events) = open(&local(format!("ws://127.0.0.1:{port}/to/{final_port}"))).unwrap();
    let (path, _) = handshake(&seen);
    assert_eq!(path, "/end");
    socket.send(Message::Text("arrived".to_owned())).unwrap();
    assert_eq!(
        events.recv_timeout(WAIT).unwrap(),
        Event::Message(Message::Text("arrived".to_owned()))
    );
}

#[test]
fn ws_a_redirect_outside_the_allowlist_fails_before_connecting() {
    let (listener, outside) = untouched();
    let port = http_answer(|_, path| {
        let to = path.trim_start_matches("/to/");
        redirect("302 Found", &format!("ws://localhost:{to}/"))
    });
    let err = open(&local(format!("ws://127.0.0.1:{port}/to/{outside}")))
        .err()
        .expect("connect fails");
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert!(err.message.contains("localhost"), "{err}");
    assert_no_connection(&listener);

    // A pattern with a port covers only that port, so a redirect to another port is outside too.
    let (listener, outside) = untouched();
    let port = http_answer(|_, path| {
        let to = path.trim_start_matches("/to/");
        redirect("307 Temporary Redirect", &format!("ws://127.0.0.1:{to}/"))
    });
    let mut request = local(format!("ws://127.0.0.1:{port}/to/{outside}"));
    request.allowed_hosts = vec![format!("127.0.0.1:{port}")];
    let err = open(&request).err().expect("connect fails");
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert_no_connection(&listener);
}

#[test]
fn ws_drop_and_server_close_end_the_socket() {
    // Dropping the handle: the server reads a going-away close frame, or at least the end.
    let (port, seen) = ws_server(None, echo);
    let (socket, _events) = open(&local(format!("ws://127.0.0.1:{port}/"))).unwrap();
    handshake(&seen);
    drop(socket);
    match seen.recv_timeout(WAIT).unwrap() {
        Seen::Message(tungstenite::Message::Close(Some(frame))) => {
            assert_eq!(u16::from(frame.code), 1001);
        }
        Seen::Closed => {}
        other => panic!("expected a close frame or the end, saw {other:?}"),
    }

    // The server closing with its own code and reason.
    let (port, seen) = ws_server(None, |socket, seen| {
        let frame = CloseFrame {
            code: CloseCode::from(4000),
            reason: "bye".into(),
        };
        let _ = socket.close(Some(frame));
        echo(socket, seen);
    });
    let (socket, events) = open(&local(format!("ws://127.0.0.1:{port}/"))).unwrap();
    handshake(&seen);
    assert_eq!(closed_last(&events), (4000, "bye".to_owned()));
    let err = socket
        .send(Message::Text("late".to_owned()))
        .expect_err("send after the end");
    assert_eq!(err.code, ErrorCode::IoError, "{err}");
}

#[test]
fn ws_wss_speaks_tls() {
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
    let err = open(&local(format!("wss://127.0.0.1:{port}/")))
        .err()
        .expect("the handshake fails");
    assert_eq!(err.code, ErrorCode::IoError, "{err}");
    let head = received.recv_timeout(WAIT).unwrap();
    // A TLS record: handshake (22), version 3.x.
    assert_eq!(
        head[..2],
        [0x16, 0x03],
        "the client did not start a TLS handshake"
    );
}

#[test]
fn ws_bad_urls_and_reserved_headers_are_invalid_params() {
    for url in [
        "not a url",
        "http://127.0.0.1:1/",
        "https://127.0.0.1:1/",
        "ftp://127.0.0.1/file",
        "ws://",
    ] {
        let err = open(&local(url.to_owned())).err().expect("connect fails");
        assert_eq!(err.code, ErrorCode::InvalidParams, "{url}: {err}");
    }
    for name in [
        "Sec-WebSocket-Key",
        "sec-websocket-version",
        "Host",
        "Upgrade",
    ] {
        let mut request = local("ws://127.0.0.1:1/".to_owned());
        request.headers.insert(name.to_owned(), "x".to_owned());
        let err = open(&request).err().expect("connect fails");
        assert_eq!(err.code, ErrorCode::InvalidParams, "{name}: {err}");
    }
    let mut request = local("ws://127.0.0.1:1/".to_owned());
    request.protocols = vec!["two words".to_owned()];
    let err = open(&request).err().expect("connect fails");
    assert_eq!(err.code, ErrorCode::InvalidParams, "{err}");
}
