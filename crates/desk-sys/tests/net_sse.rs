//! desk-sys server-sent event streams (feature `net`): the WHATWG event-stream format, the host
//! allowlist on the first URL and every redirect, and closing from either end.
//!
//! Every server is an in-process `TcpListener` on 127.0.0.1; nothing here touches the network.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

use desk_sys::ErrorCode;
use desk_sys::net::sse::{self, Event, Message, Request, Stream};

const WAIT: Duration = Duration::from_secs(5);

/// What a test server saw: a request's path and headers, or the client going away.
#[derive(Debug)]
enum Seen {
    Request {
        path: String,
        headers: BTreeMap<String, String>,
    },
    End,
}

fn read_head(stream: &mut TcpStream) -> (String, BTreeMap<String, String>) {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let path = line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_owned();
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
    (path, headers)
}

/// A server that reads each request, reports it, and hands the connection to `run`.
fn serve(run: fn(u16, &str, &mut TcpStream, &Sender<Seen>)) -> (u16, Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let sender = sender.clone();
            thread::spawn(move || {
                let (path, headers) = read_head(&mut stream);
                let _ = sender.send(Seen::Request {
                    path: path.clone(),
                    headers,
                });
                run(port, &path, &mut stream, &sender);
            });
        }
    });
    (port, receiver)
}

const STREAM_HEAD: &str = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream; charset=utf-8\r\ncache-control: no-cache\r\ntransfer-encoding: chunked\r\n\r\n";

/// One chunk of a chunked body, flushed alone so the client reads it in its own write.
fn chunk(stream: &mut TcpStream, text: &str) {
    let _ = write!(stream, "{:x}\r\n{text}\r\n", text.len());
    let _ = stream.flush();
    thread::sleep(Duration::from_millis(30));
}

fn finish(stream: &mut TcpStream) {
    let _ = stream.write_all(b"0\r\n\r\n");
    let _ = stream.flush();
}

/// Hold the stream open until the client goes away, then report it.
fn wait_for_end(stream: &mut TcpStream, seen: &Sender<Seen>) {
    let mut buf = [0u8; 64];
    loop {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
    }
    let _ = seen.send(Seen::End);
}

fn request_seen(seen: &Receiver<Seen>) -> (String, BTreeMap<String, String>) {
    match seen.recv_timeout(WAIT).unwrap() {
        Seen::Request { path, headers } => (path, headers),
        Seen::End => panic!("expected a request"),
    }
}

fn open(request: &Request) -> Result<(Stream, Receiver<Event>), desk_sys::Error> {
    let (sender, events) = mpsc::channel();
    let stream = sse::open(request, move |event| {
        let _ = sender.send(event);
    })?;
    Ok((stream, events))
}

fn local(url: String) -> Request {
    Request {
        url,
        allowed_hosts: vec!["127.0.0.1".to_owned()],
        timeout: Some(Duration::from_secs(10)),
        ..Request::default()
    }
}

fn message(event: &str, data: &str, id: &str) -> Event {
    Event::Message(Message {
        event: event.to_owned(),
        data: data.to_owned(),
        id: id.to_owned(),
    })
}

/// The events up to `Closed`, which must come last: the callback is dropped after it.
fn until_closed(events: &Receiver<Event>) -> Vec<Event> {
    let mut all = Vec::new();
    loop {
        let event = events.recv_timeout(WAIT).unwrap();
        let closed = matches!(event, Event::Closed { .. });
        all.push(event);
        if closed {
            break;
        }
    }
    assert_eq!(
        events.recv_timeout(WAIT),
        Err(RecvTimeoutError::Disconnected),
        "an event after Closed"
    );
    all
}

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

fn redirect(stream: &mut TcpStream, status: &str, location: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
    );
}

#[test]
fn sse_delivers_events_in_order() {
    let (port, seen) = serve(|_, _, stream, _| {
        let _ = stream.write_all(STREAM_HEAD.as_bytes());
        chunk(
            stream,
            "\u{feff}: a comment\r\nevent: greet\r\ndata: hello\r\nid: 1\r\n\r\n",
        );
        chunk(stream, "data: line one\ndata:line two\ndata\n\n");
        // A line split across two writes, and a lone CR ending a line.
        chunk(stream, "data: spl");
        chunk(stream, "it\rid: 7\r\r");
        chunk(stream, "retry: 2500\nevent: empty\n\nid\ndata: last\n\n");
        finish(stream);
    });
    let mut request = local(format!("http://127.0.0.1:{port}/events"));
    request.last_event_id = Some("0".to_owned());
    let (_stream, events) = open(&request).unwrap();
    let (path, headers) = request_seen(&seen);
    assert_eq!(path, "/events");
    assert_eq!(
        headers.get("accept").map(String::as_str),
        Some("text/event-stream")
    );
    assert_eq!(headers.get("last-event-id").map(String::as_str), Some("0"));

    assert_eq!(
        until_closed(&events),
        [
            message("greet", "hello", "1"),
            message("message", "line one\nline two\n", "1"),
            message("message", "split", "7"),
            Event::Retry(Duration::from_millis(2500)),
            // An event with no data is not dispatched, and an empty id clears the last one.
            message("message", "last", ""),
            Event::Closed { error: None },
        ]
    );
}

#[test]
fn sse_hosts_outside_the_allowlist_fail_before_connecting() {
    let (listener, port) = untouched();
    let mut request = local(format!("http://127.0.0.1:{port}/events"));
    request.allowed_hosts = vec!["example.com".to_owned()];
    let err = open(&request).err().expect("open fails");
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert!(err.message.contains("127.0.0.1"), "{err}");
    assert_no_connection(&listener);
}

#[test]
fn sse_redirects_are_checked_against_the_allowlist() {
    let (final_port, final_seen) = serve(|_, _, stream, _| {
        let _ = stream.write_all(STREAM_HEAD.as_bytes());
        chunk(stream, "data: arrived\n\n");
        finish(stream);
    });
    let (port, _seen) = serve(|_, path, stream, _| {
        let to = path.trim_start_matches("/to/");
        redirect(
            stream,
            "307 Temporary Redirect",
            &format!("http://127.0.0.1:{to}/end"),
        );
    });
    let (_stream, events) =
        open(&local(format!("http://127.0.0.1:{port}/to/{final_port}"))).unwrap();
    assert_eq!(request_seen(&final_seen).0, "/end");
    assert_eq!(
        until_closed(&events),
        [
            message("message", "arrived", ""),
            Event::Closed { error: None }
        ]
    );

    let (listener, outside) = untouched();
    let (port, _seen) = serve(|_, path, stream, _| {
        let to = path.trim_start_matches("/to/");
        redirect(stream, "302 Found", &format!("http://localhost:{to}/"));
    });
    let err = open(&local(format!("http://127.0.0.1:{port}/to/{outside}")))
        .err()
        .expect("open fails");
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert!(err.message.contains("localhost"), "{err}");
    assert_no_connection(&listener);
}

#[test]
fn sse_close_and_drop_end_the_connection() {
    fn idle(_: u16, _: &str, stream: &mut TcpStream, seen: &Sender<Seen>) {
        let _ = stream.write_all(STREAM_HEAD.as_bytes());
        chunk(stream, ": idle\n\n");
        wait_for_end(stream, seen);
    }

    let (port, seen) = serve(idle);
    let (stream, events) = open(&local(format!("http://127.0.0.1:{port}/"))).unwrap();
    request_seen(&seen);
    stream.close();
    assert!(matches!(seen.recv_timeout(WAIT).unwrap(), Seen::End));
    assert_eq!(until_closed(&events), [Event::Closed { error: None }]);

    let (port, seen) = serve(idle);
    let (stream, events) = open(&local(format!("http://127.0.0.1:{port}/"))).unwrap();
    request_seen(&seen);
    drop(stream);
    assert!(matches!(seen.recv_timeout(WAIT).unwrap(), Seen::End));
    assert_eq!(until_closed(&events), [Event::Closed { error: None }]);
}

#[test]
fn sse_a_server_end_is_closed_last() {
    let (port, _seen) = serve(|_, _, stream, _| {
        let _ = stream.write_all(STREAM_HEAD.as_bytes());
        chunk(stream, "data: only\n\n");
        finish(stream);
    });
    let (_stream, events) = open(&local(format!("http://127.0.0.1:{port}/"))).unwrap();
    assert_eq!(
        until_closed(&events),
        [
            message("message", "only", ""),
            Event::Closed { error: None }
        ]
    );
}

#[test]
fn sse_answers_that_are_not_event_streams_fail_open() {
    let (port, _seen) = serve(|_, _, stream, _| {
        let _ = stream.write_all(
            b"HTTP/1.1 404 Not Found\r\ncontent-type: text/event-stream\r\ncontent-length: 0\r\n\r\n",
        );
    });
    let err = open(&local(format!("http://127.0.0.1:{port}/")))
        .err()
        .expect("open fails");
    assert_eq!(err.code, ErrorCode::IoError, "{err}");
    assert!(err.message.contains("404"), "{err}");

    let (port, _seen) = serve(|_, _, stream, _| {
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: 6\r\n\r\n<html>",
        );
    });
    let err = open(&local(format!("http://127.0.0.1:{port}/")))
        .err()
        .expect("open fails");
    assert_eq!(err.code, ErrorCode::IoError, "{err}");
    assert!(err.message.contains("text/html"), "{err}");

    for url in ["ws://127.0.0.1:1/", "ftp://127.0.0.1/", "http://"] {
        let err = open(&local(url.to_owned())).err().expect("open fails");
        assert_eq!(err.code, ErrorCode::InvalidParams, "{url}: {err}");
    }
}
