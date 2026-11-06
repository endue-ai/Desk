//! A fixture GitHub for the http binding's tests: an in-process server on 127.0.0.1 that answers the
//! three searches of plugins/github from the JSON pages in plugins/github/tests/fixtures, with a Link
//! header to the second page of the assigned search, and a copy of plugins/github pointed at it.
//! Nothing here touches the network.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;

/// What the server saw of one request.
#[derive(Debug, Clone)]
pub struct Seen {
    pub target: String,
    pub headers: BTreeMap<String, String>,
}

#[derive(Default)]
struct State {
    token: String,
    /// Answer every request with this status and an error body instead.
    status: Option<u16>,
    /// Records left out of every page, by node_id.
    dropped: Vec<String>,
    seen: Vec<Seen>,
}

/// The running server; it stops with the test process.
#[derive(Clone)]
pub struct Server {
    pub port: u16,
    state: Arc<Mutex<State>>,
}

impl Server {
    /// `http://127.0.0.1:<port>`, the base URL the copy of plugins/github uses.
    pub fn base(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Every request so far.
    pub fn seen(&self) -> Vec<Seen> {
        self.state.lock().unwrap().seen.clone()
    }

    /// Answer every request from now on with `status`.
    pub fn fail_with(&self, status: u16) {
        self.state.lock().unwrap().status = Some(status);
    }

    /// Leave the record with this node_id out of every page from now on, as GitHub does once an
    /// issue is closed.
    pub fn drop_record(&self, node_id: &str) {
        self.state.lock().unwrap().dropped.push(node_id.to_owned());
    }
}

/// The fixture pages plugins/github's tests share.
pub fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/github/tests/fixtures")
}

/// A server that accepts `Authorization: Bearer <token>` and answers 401 otherwise.
pub fn serve(token: &str) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = Arc::new(Mutex::new(State {
        token: token.to_owned(),
        ..State::default()
    }));
    let server = Server { port, state };
    let serving = server.clone();
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let seen = read_request(&mut stream);
            let answer = serving.answer(&seen);
            serving.state.lock().unwrap().seen.push(seen);
            let _ = stream.write_all(&answer);
        }
    });
    server
}

impl Server {
    fn answer(&self, seen: &Seen) -> Vec<u8> {
        let state = self.state.lock().unwrap();
        if let Some(status) = state.status {
            return response(status, &[], r#"{"message":"Bad credentials"}"#);
        }
        let wanted = format!("Bearer {}", state.token);
        if seen.headers.get("authorization") != Some(&wanted) {
            return response(401, &[], r#"{"message":"Requires authentication"}"#);
        }
        let (path, query) = seen.target.split_once('?').unwrap_or((&seen.target, ""));
        let params = decode_query(query);
        if path != "/search/issues" {
            return response(404, &[], r#"{"message":"Not Found"}"#);
        }
        let q = params.get("q").cloned().unwrap_or_default();
        let page = params.get("page").map_or("1", String::as_str);
        let (file, next) = if q.contains("assignee:@me") {
            match page {
                "1" => (
                    "assigned-1.json",
                    Some(format!("{}{path}?{query}&page=2", self.base())),
                ),
                _ => ("assigned-2.json", None),
            }
        } else if q.contains("review-requested:@me") {
            ("review-requested.json", None)
        } else if q.contains("author:@me") {
            ("authored.json", None)
        } else {
            return response(422, &[], r#"{"message":"Validation Failed"}"#);
        };
        let text = fs::read_to_string(fixtures().join(file)).unwrap();
        let mut body: Value = serde_json::from_str(&text).unwrap();
        let items = body["items"].as_array_mut().unwrap();
        items.retain(|item| {
            !state
                .dropped
                .iter()
                .any(|id| item["node_id"] == id.as_str())
        });
        let link = next.map(|next| format!("<{next}>; rel=\"next\", <{next}>; rel=\"last\""));
        let headers: Vec<(&str, String)> = link.into_iter().map(|l| ("Link", l)).collect();
        response(200, &headers, &body.to_string())
    }
}

fn read_request(stream: &mut TcpStream) -> Seen {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let target = line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_owned();
    let mut headers = BTreeMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.to_ascii_lowercase(), value.trim().to_owned());
        }
    }
    Seen { target, headers }
}

fn response(status: u16, headers: &[(&str, String)], body: &str) -> Vec<u8> {
    let mut text = format!(
        "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    text.push_str("\r\n");
    text.push_str(body);
    text.into_bytes()
}

/// A query string's parameters, `+` and `%XX` decoded.
pub fn decode_query(query: &str) -> BTreeMap<String, String> {
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(name), decode(value))
        })
        .collect()
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("00");
                out.push(u8::from_str_radix(hex, 16).unwrap_or(b'?'));
                i += 2;
            }
            byte => out.push(byte),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A copy of plugins/github under `parent` whose base URL and net:fetch host are the server's, its
/// manifest changed further by `edit`. Returns its folder.
pub fn plugin_copy(parent: &Path, server: &Server, edit: impl FnOnce(&mut Value)) -> PathBuf {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/github/plugin.json");
    let mut manifest: Value = serde_json::from_str(&fs::read_to_string(source).unwrap()).unwrap();
    manifest["connector"]["http"]["baseUrl"] = Value::String(server.base());
    manifest["permissions"][0]["hosts"] = serde_json::json!([format!("127.0.0.1:{}", server.port)]);
    edit(&mut manifest);
    let dir = parent.join(manifest["id"].as_str().unwrap());
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    dir
}
