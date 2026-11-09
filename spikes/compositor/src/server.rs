//! A tiny HTTP server for the test pages. Surfaces load `http://s<n>.localhost:<port>/<page>.html`:
//! Chromium resolves `*.localhost` to loopback and treats it as a secure context (WebGPU needs one),
//! and every surface gets a site of its own, so Chromium cannot merge their renderers.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

const PAGES: &[(&str, &str)] = &[
    ("/light.html", include_str!("../pages/light.html")),
    ("/heavy.html", include_str!("../pages/heavy.html")),
    ("/webgpu.html", include_str!("../pages/webgpu.html")),
    ("/ime.html", include_str!("../pages/ime.html")),
];

/// Start serving on an ephemeral port; returns the port.
pub fn start() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut reader = BufReader::new(&stream);
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    return;
                }
                let path = line.split_whitespace().nth(1).unwrap_or("/").to_owned();
                // Drain the headers.
                let mut header = String::new();
                while reader
                    .read_line(&mut header)
                    .map(|n| n > 2)
                    .unwrap_or(false)
                {
                    header.clear();
                }
                let body = PAGES.iter().find(|(p, _)| *p == path).map(|(_, b)| *b);
                let mut out = &stream;
                let _ = match body {
                    Some(body) => write!(
                        out,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    ),
                    None => write!(
                        out,
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    ),
                };
            });
        }
    });
    port
}
