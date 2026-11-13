//! An in-process fake of endue AI's platform subset (specs/platform/v0), for tests only (feature
//! `fake`): a small HTTP/1.1 server on 127.0.0.1 that keeps agents, their facets, one catalog agent,
//! conversations and the person's own account in memory, checks the bearer token, answers the
//! platform's envelopes and error
//! envelopes, and records every request it saw. Nothing leaves this machine.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde_json::Value;

mod account;
mod routes;
mod spaces;
mod state;

pub use account::FakeAccount;
pub use spaces::FakeSpace;
pub use state::State;

/// A request the fake received.
#[derive(Debug, Clone, PartialEq)]
pub struct Seen {
    pub method: String,
    /// The path without its query.
    pub path: String,
    pub query: BTreeMap<String, String>,
    /// Lowercase names.
    pub headers: BTreeMap<String, String>,
    /// The JSON body, `Null` when there was none.
    pub body: Value,
}

/// The fake platform: its state behind a lock, served until it is dropped with the test process.
pub struct FakePlatform {
    url: String,
    state: Arc<Mutex<State>>,
}

impl FakePlatform {
    /// Serve a fresh platform on a free port. It accepts the token `token-1`.
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the fake platform");
        let url = format!("http://{}", listener.local_addr().expect("its address"));
        let state = Arc::new(Mutex::new(State::new()));
        let served = Arc::clone(&state);
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let state = Arc::clone(&served);
                thread::spawn(move || serve(stream, &state));
            }
        });
        Self { url, state }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    /// The state, to seed it or look at it.
    pub fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Every request so far, oldest first.
    pub fn seen(&self) -> Vec<Seen> {
        self.state().seen.clone()
    }

    /// The requests so far to `path` (without query), oldest first.
    pub fn seen_at(&self, method: &str, path: &str) -> Vec<Seen> {
        self.seen()
            .into_iter()
            .filter(|s| s.method == method && s.path == path)
            .collect()
    }
}

fn serve(stream: TcpStream, state: &Mutex<State>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let Ok(mut writer) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(stream);
    let Some(seen) = read_request(&mut reader) else {
        return;
    };
    let (delay, (status, body)) = {
        let mut state = state.lock().unwrap_or_else(|p| p.into_inner());
        state.seen.push(seen.clone());
        (state.delay, routes::answer(&mut state, &seen))
    };
    if let Some(delay) = delay {
        thread::sleep(delay);
    }
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n",
        reason(status),
        payload.len()
    );
    let _ = writer.write_all(head.as_bytes());
    let _ = writer.write_all(payload.as_bytes());
    let _ = writer.flush();
}

fn read_request(reader: &mut BufReader<TcpStream>) -> Option<Seen> {
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let target = parts.next()?.to_owned();
    let mut headers = BTreeMap::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    // A body without a known size comes chunked (ureq sends a POST without a body so): read it to
    // its last chunk, or the answer's close would leave its end unread, and a socket closed with
    // bytes unread resets the connection under the client before it reads the answer.
    let chunked = headers
        .get("transfer-encoding")
        .is_some_and(|t| t.to_ascii_lowercase().contains("chunked"));
    let bytes = if chunked {
        read_chunked(reader)?
    } else {
        let length: usize = headers
            .get("content-length")
            .and_then(|l| l.parse().ok())
            .unwrap_or(0);
        let mut bytes = vec![0; length];
        reader.read_exact(&mut bytes).ok()?;
        bytes
    };
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    let query = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (k.to_owned(), decode(v)))
        .collect();
    Some(Seen {
        method,
        path: decode(path),
        query,
        headers,
        body,
    })
}

/// A chunked body (RFC 9112 §7.1), to its last chunk and the trailer's blank line.
fn read_chunked(reader: &mut impl BufRead) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        let size = line.trim().split(';').next()?;
        let size = usize::from_str_radix(size.trim(), 16).ok()?;
        if size == 0 {
            loop {
                let mut trailer = String::new();
                if reader.read_line(&mut trailer).ok()? == 0 || trailer.trim().is_empty() {
                    return Some(body);
                }
            }
        }
        let start = body.len();
        body.resize(start + size, 0);
        reader.read_exact(&mut body[start..]).ok()?;
        let mut end = [0u8; 2];
        reader.read_exact(&mut end).ok()?;
    }
}

/// Percent-decoding of a path or query value.
fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (b'+', _) => {
                out.push(b' ');
                i += 1;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        410 => "Gone",
        _ => "Status",
    }
}

#[cfg(test)]
mod tests {
    use super::read_chunked;

    #[test]
    fn a_chunked_body_is_read_to_its_end() {
        let wire = b"4\r\n{\"a\"\r\n3\r\n:1}\r\n0\r\n\r\nNEXT";
        let mut reader = &wire[..];
        assert_eq!(
            read_chunked(&mut reader).as_deref(),
            Some(&b"{\"a\":1}"[..])
        );
        assert_eq!(reader, b"NEXT", "nothing of the body left unread");
        let mut empty = &b"0\r\n\r\n"[..];
        assert_eq!(read_chunked(&mut empty), Some(Vec::new()));
        assert!(empty.is_empty());
    }
}
