//! In-process HTTP listeners on 127.0.0.1: one that answers every request with a fixed JSON body and
//! reports what it saw, and one nobody accepts on. Nothing here touches the network.

use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

/// The request line a listener saw.
#[derive(Debug)]
pub struct Seen {
    pub method: String,
    pub target: String,
}

/// A listener that answers each connection `200 OK` with `body`, and its port.
pub fn serve(body: &'static str) -> (u16, Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let seen = read(&mut stream);
            let reply = format!(
                "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-type: application/json\r\n\
                 content-length: {}\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
            if sender.send(seen).is_err() {
                return;
            }
        }
    });
    (port, receiver)
}

/// The request line, after reading the headers up to the blank line (the requests here have no body).
fn read(stream: &mut TcpStream) -> Seen {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    loop {
        let mut header = String::new();
        let read = reader.read_line(&mut header).unwrap();
        if read == 0 || header.trim_end().is_empty() {
            break;
        }
    }
    let mut parts = line.split_whitespace();
    Seen {
        method: parts.next().unwrap_or_default().to_owned(),
        target: parts.next().unwrap_or_default().to_owned(),
    }
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
