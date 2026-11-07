//! The servers of tests/net_proxy.rs, all on 127.0.0.1: files by path, a CONNECT proxy that tunnels
//! to backends chosen by the tunnelled request's path, and the backends themselves.

use std::io::{self, ErrorKind, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

/// Read up to and including the blank line that ends an HTTP head, one byte at a time, so nothing
/// after it is taken from the stream.
pub fn read_head(stream: &mut TcpStream) -> io::Result<String> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte)? == 0 {
            return Err(ErrorKind::UnexpectedEof.into());
        }
        head.push(byte[0]);
    }
    Ok(String::from_utf8_lossy(&head).into_owned())
}

/// One line, up to and including its LF, one byte at a time.
fn read_line(stream: &mut TcpStream) -> io::Result<String> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    while !line.ends_with(b"\n") {
        if stream.read(&mut byte)? == 0 {
            return Err(ErrorKind::UnexpectedEof.into());
        }
        line.push(byte[0]);
    }
    Ok(String::from_utf8_lossy(&line).into_owned())
}

/// A server answering `GET <path>` from `files` (path, status, body) and counting requests.
pub fn files(files: Vec<(&'static str, u16, String)>) -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let count = Arc::new(AtomicUsize::new(0));
    let counted = count.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let Ok(head) = read_head(&mut stream) else {
                continue;
            };
            counted.fetch_add(1, Ordering::SeqCst);
            let path = head.split_whitespace().nth(1).unwrap_or_default();
            let (status, body) = files
                .iter()
                .find(|(file, _, _)| *file == path)
                .map_or((404, String::new()), |(_, status, body)| {
                    (*status, body.clone())
                });
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\ncontent-type: application/x-ns-proxy-autoconfig\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    (port, count)
}

/// A CONNECT proxy: it reports each CONNECT target, answers 200, reads the tunnelled request line
/// and pipes the tunnel to the backend whose path it names.
pub fn connect_proxy(backends: Vec<(&'static str, u16)>) -> (u16, Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, seen) = mpsc::channel();
    let backends = Arc::new(backends);
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut client) = stream else { return };
            let sender = sender.clone();
            let backends = backends.clone();
            thread::spawn(move || {
                let Ok(head) = read_head(&mut client) else {
                    return;
                };
                let mut words = head.split_whitespace();
                let target = match (words.next(), words.next()) {
                    (Some("CONNECT"), Some(target)) => target.to_owned(),
                    _ => format!("not a CONNECT: {head:?}"),
                };
                let _ = sender.send(target);
                if client
                    .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    .is_err()
                {
                    return;
                }
                let Ok(line) = read_line(&mut client) else {
                    return;
                };
                let path = line.split_whitespace().nth(1).unwrap_or_default();
                let Some((_, backend)) = backends.iter().find(|(p, _)| *p == path) else {
                    return;
                };
                let Ok(mut server) = TcpStream::connect(("127.0.0.1", *backend)) else {
                    return;
                };
                if server.write_all(line.as_bytes()).is_err() {
                    return;
                }
                pipe(client, server);
            });
        }
    });
    (port, seen)
}

/// Copy both ways until either side ends.
fn pipe(client: TcpStream, server: TcpStream) {
    let (mut client_read, mut server_write) =
        (client.try_clone().unwrap(), server.try_clone().unwrap());
    let upstream = thread::spawn(move || {
        let _ = io::copy(&mut client_read, &mut server_write);
        let _ = server_write.shutdown(Shutdown::Write);
    });
    let (mut server_read, mut client_write) = (server, client);
    let _ = io::copy(&mut server_read, &mut client_write);
    let _ = client_write.shutdown(Shutdown::Both);
    let _ = upstream.join();
}

/// A backend answering one HTTP response to every request.
pub fn http_backend(response: &'static str) -> u16 {
    backend(move |mut stream| {
        if read_head(&mut stream).is_ok() {
            let _ = stream.write_all(response.as_bytes());
        }
    })
}

/// A backend answering an event stream with one event, held open until the client goes away.
pub fn sse_backend() -> u16 {
    backend(|mut stream| {
        if read_head(&mut stream).is_err() {
            return;
        }
        let body = "data: through\n\n";
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n{:x}\r\n{body}\r\n",
            body.len()
        );
        let mut buf = [0u8; 64];
        while matches!(stream.read(&mut buf), Ok(n) if n > 0) {}
    })
}

/// A tungstenite backend echoing text messages.
pub fn ws_backend() -> u16 {
    backend(|stream| {
        let Ok(mut socket) = tungstenite::accept(stream) else {
            return;
        };
        while let Ok(message) = socket.read() {
            if message.is_text() && socket.send(message).is_err() {
                break;
            }
        }
    })
}

fn backend(serve: impl Fn(TcpStream) + Send + Sync + Copy + 'static) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { return };
            thread::spawn(move || serve(stream));
        }
    });
    port
}

/// A listener nobody accepts on: any connection attempt stays in its backlog.
pub fn untouched() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

pub fn assert_no_connection(listener: &TcpListener) {
    thread::sleep(Duration::from_millis(100));
    listener.set_nonblocking(true).unwrap();
    match listener.accept() {
        Err(err) if err.kind() == ErrorKind::WouldBlock => {}
        other => panic!("the listener was reached: {other:?}"),
    }
}
