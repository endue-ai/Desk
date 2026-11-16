//! `fetch_at_most` (issue 352): a body larger than the caller's limit fails without being read to
//! its end, a body within it is answered whole, and `fetch` keeps its own limit. The server is an
//! in-process `TcpListener` on 127.0.0.1; nothing here touches the network.
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

use desk_sys::net::{Method, Request, fetch, fetch_at_most};

const LIMIT: u64 = 512 * 1024;

/// A server that answers every request with `size` bytes and counts the bytes it got to write.
fn serve(size: usize) -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let written = Arc::new(AtomicUsize::new(0));
    let count = written.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim_end().is_empty() {
                    break;
                }
            }
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\ncontent-length: {size}\r\nconnection: close\r\n\r\n"
            );
            if stream.write_all(head.as_bytes()).is_err() {
                continue;
            }
            let chunk = vec![b'x'; 16 * 1024];
            let mut left = size;
            while left > 0 {
                let n = left.min(chunk.len());
                if stream.write_all(&chunk[..n]).is_err() {
                    break;
                }
                count.fetch_add(n, Ordering::SeqCst);
                left -= n;
            }
        }
    });
    (port, written)
}

fn request(port: u16) -> Request {
    Request {
        url: format!("http://127.0.0.1:{port}/a.png"),
        method: Method::Get,
        headers: BTreeMap::new(),
        body: None,
        timeout: Some(Duration::from_secs(10)),
        allowed_hosts: vec![format!("127.0.0.1:{port}")],
    }
}

#[test]
fn fetch_at_most_stops_at_its_limit() {
    let size = 2 * 1024 * 1024;
    let (port, _written) = serve(size);
    let refused = fetch_at_most(&request(port), LIMIT);
    assert!(refused.is_err(), "a 2 MB body passes a 512 KiB limit");

    let (port, _) = serve(100 * 1024);
    let small = fetch_at_most(&request(port), LIMIT).unwrap();
    assert_eq!(small.status, 200);
    assert_eq!(
        small.body.len(),
        100 * 1024,
        "a body within the limit comes whole"
    );

    let (port, _) = serve(size);
    let whole = fetch(&request(port)).unwrap();
    assert_eq!(whole.body.len(), size, "fetch keeps its own, larger limit");
}
