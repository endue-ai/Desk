//! A fake of the endue AI platform's auth BFF (api-gateway → identity-service) on 127.0.0.1, as
//! refs/auth.md §2.3 describes it: `/api/v1/auth/device/{start,token}` with PKCE, the `endue_rt`
//! cookie that rotates on every `/api/v1/auth/refresh`, `/api/v1/auth/logout`, `/api/v1/users/me`
//! and a picture. Each connection gets its own thread, so overlapping refreshes overlap here too.
//! Nothing here touches the network.
#![allow(dead_code)]

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde_json::{Value, json};

/// The bytes of the person's picture: a PNG signature and a little more.
pub const PICTURE: &[u8] = b"\x89PNG\r\n\x1a\nfake-picture";

/// What the fake saw of one request.
#[derive(Debug, Clone)]
pub struct Seen {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Value,
}

/// How one poll of `/api/v1/auth/device/token` is answered.
#[derive(Debug, Clone, Copy)]
pub enum Poll {
    Pending,
    SlowDown,
    Approve,
    /// An error with this status and envelope code.
    Fail(u16, &'static str),
}

pub struct Script {
    /// Errors `/device/start` answers before it hands out a code.
    pub start: VecDeque<(u16, &'static str)>,
    /// The host the device page is on, when it is not this server's.
    pub page_host: Option<String>,
    pub expires_in: u64,
    pub interval: u64,
    /// Poll answers in order; once they run out, every poll is pending.
    pub polls: VecDeque<Poll>,
    /// Errors `/refresh` answers before it rotates the cookie.
    pub refresh: VecDeque<(u16, &'static str)>,
    pub refresh_delay: Duration,
    /// expires_in of the device flow's access token, and of a refreshed one.
    pub access_expires_in: u64,
    pub refreshed_expires_in: u64,
    /// `/api/v1/users/me` answers with this status instead of the profile.
    pub me_status: Option<u16>,
    /// The live cookie is `rt<cookie>` and the live access token `access<access>`; 0 is none.
    pub cookie: u32,
    pub access: u32,
    pub seen: Vec<Seen>,
    refreshing: usize,
    pub most_refreshing: usize,
}

impl Default for Script {
    fn default() -> Self {
        Self {
            start: VecDeque::new(),
            page_host: None,
            expires_in: 600,
            interval: 1,
            polls: VecDeque::new(),
            refresh: VecDeque::new(),
            refresh_delay: Duration::ZERO,
            access_expires_in: 300,
            refreshed_expires_in: 300,
            me_status: None,
            cookie: 0,
            access: 0,
            seen: Vec::new(),
            refreshing: 0,
            most_refreshing: 0,
        }
    }
}

#[derive(Clone)]
pub struct Bff {
    pub port: u16,
    script: Arc<Mutex<Script>>,
}

impl Bff {
    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let bff = Self {
            port,
            script: Arc::default(),
        };
        let serving = bff.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let bff = serving.clone();
                thread::spawn(move || bff.serve(stream));
            }
        });
        bff
    }

    /// The platform's base URL, as `DESK_ENDUE_PLATFORM_URL` would name it.
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// The Keycloak realm the device page is on, as `DESK_ENDUE_AUTH_URL` would name it.
    pub fn auth_url(&self) -> String {
        format!("{}/realms/endue", self.url())
    }

    pub fn script(&self) -> MutexGuard<'_, Script> {
        self.script.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The requests to `path` so far.
    pub fn seen(&self, path: &str) -> Vec<Seen> {
        let script = self.script();
        script
            .seen
            .iter()
            .filter(|seen| seen.path == path)
            .cloned()
            .collect()
    }

    fn serve(&self, mut stream: TcpStream) {
        let Some(seen) = read_request(&mut stream) else {
            return;
        };
        self.script().seen.push(seen.clone());
        let answer = match (seen.method.as_str(), seen.path.as_str()) {
            ("POST", "/api/v1/auth/device/start") => self.device_start(),
            ("POST", "/api/v1/auth/device/token") => self.device_token(&seen),
            ("POST", "/api/v1/auth/refresh") => self.refresh(&seen),
            ("POST", "/api/v1/auth/logout") => {
                let cleared = "endue_rt=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure";
                respond(204, "", &[("Set-Cookie", cleared.to_owned())], b"")
            }
            ("GET", "/api/v1/users/me") => self.me(&seen),
            ("GET", "/avatar.png") => respond(200, "image/png", &[], PICTURE),
            _ => failure(404, "NOT_FOUND"),
        };
        let _ = stream.write_all(&answer);
    }

    fn device_start(&self) -> Vec<u8> {
        let mut script = self.script();
        if let Some((status, code)) = script.start.pop_front() {
            return failure(status, code);
        }
        let host = script
            .page_host
            .clone()
            .unwrap_or_else(|| format!("127.0.0.1:{}", self.port));
        let page = format!("http://{host}/realms/endue/device");
        let body = json!({
            "device_code": "device-1", "user_code": "WDJB-MJHT",
            "verification_uri": page,
            "verification_uri_complete": format!("{page}?user_code=WDJB-MJHT"),
            "expires_in": script.expires_in, "interval": script.interval,
        });
        ok(200, &body, &[])
    }

    fn device_token(&self, seen: &Seen) -> Vec<u8> {
        let mut script = self.script();
        let sent = seen.body["interval"].as_u64().unwrap_or(5);
        match script.polls.pop_front().unwrap_or(Poll::Pending) {
            Poll::Pending => ok(202, &json!({ "status": "pending", "interval": sent }), &[]),
            Poll::SlowDown => ok(
                202,
                &json!({ "status": "pending", "interval": sent + 5 }),
                &[],
            ),
            Poll::Fail(status, code) => failure(status, code),
            Poll::Approve => {
                script.cookie = 1;
                script.access = 1;
                let expires_in = script.access_expires_in;
                let body = json!({ "access_token": "access1", "id_token": "id1",
                    "token_type": "Bearer", "expires_in": expires_in });
                ok(200, &body, &[set_cookie(1)])
            }
        }
    }

    fn refresh(&self, seen: &Seen) -> Vec<u8> {
        let delay = {
            let mut script = self.script();
            script.refreshing += 1;
            script.most_refreshing = script.most_refreshing.max(script.refreshing);
            script.refresh_delay
        };
        thread::sleep(delay);
        let mut script = self.script();
        script.refreshing -= 1;
        if let Some((status, code)) = script.refresh.pop_front() {
            return failure(status, code);
        }
        let live = format!("endue_rt=rt{}", script.cookie);
        let sent = seen.headers.get("cookie").map(String::as_str);
        // A rotated cookie is spent: sending it again is a dead session, as with Keycloak.
        if script.cookie == 0 || sent != Some(live.as_str()) {
            return failure(401, "AUTH_FAILED");
        }
        script.cookie += 1;
        script.access += 1;
        let body = json!({ "access_token": format!("access{}", script.access),
            "expires_in": script.refreshed_expires_in });
        ok(200, &body, &[set_cookie(script.cookie)])
    }

    fn me(&self, seen: &Seen) -> Vec<u8> {
        let script = self.script();
        if let Some(status) = script.me_status {
            return failure(status, "UNAVAILABLE");
        }
        let wanted = format!("Bearer access{}", script.access);
        if script.access == 0 || seen.headers.get("authorization") != Some(&wanted) {
            return failure(401, "AUTH_FAILED");
        }
        let body = json!({ "id": "usr_1", "email": "ada@example.com",
            "display_name": "Ada Lovelace", "avatar_url": format!("{}/avatar.png", self.url()),
            "status": "active", "plan": "free" });
        ok(200, &body, &[])
    }
}

fn set_cookie(n: u32) -> (&'static str, String) {
    let cookie = format!(
        "endue_rt=rt{n}; Path=/api/v1/auth; Max-Age=2592000; HttpOnly; Secure; SameSite=None"
    );
    ("Set-Cookie", cookie)
}

fn ok(status: u16, body: &Value, headers: &[(&str, String)]) -> Vec<u8> {
    respond(
        status,
        "application/json",
        headers,
        body.to_string().as_bytes(),
    )
}

/// The platform's error envelope (`{ error: { code, message, details, suggest }, meta }`).
fn failure(status: u16, code: &str) -> Vec<u8> {
    let body = json!({
        "error": { "code": code, "message": format!("{code} from the fake"), "details": {},
            "suggest": null },
        "meta": { "request_id": "req-1", "timestamp": "2026-11-07T00:00:00Z" },
    });
    ok(status, &body, &[])
}

fn respond(status: u16, kind: &str, headers: &[(&str, String)], body: &[u8]) -> Vec<u8> {
    let mut head = format!(
        "HTTP/1.1 {status} Fake\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if !kind.is_empty() {
        head.push_str(&format!("Content-Type: {kind}\r\n"));
    }
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(body);
    out
}

fn read_request(stream: &mut TcpStream) -> Option<Seen> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let target = parts.next()?.to_owned();
    let path = target.split('?').next().unwrap_or_default().to_owned();
    let mut headers = BTreeMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
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
    let body = if headers.get("transfer-encoding").map(String::as_str) == Some("chunked") {
        read_chunked(&mut reader)
    } else {
        let length = headers
            .get("content-length")
            .and_then(|n| n.parse::<usize>().ok())
            .unwrap_or(0);
        let mut body = vec![0; length];
        reader.read_exact(&mut body).ok()?;
        body
    };
    let body = serde_json::from_slice(&body).unwrap_or(Value::Null);
    Some(Seen {
        method,
        path,
        headers,
        body,
    })
}

fn read_chunked(reader: &mut impl BufRead) -> Vec<u8> {
    let mut body = Vec::new();
    loop {
        let mut size = String::new();
        if reader.read_line(&mut size).unwrap_or(0) == 0 {
            return body;
        }
        let size = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
        let mut chunk = vec![0; size + 2];
        if size == 0 || reader.read_exact(&mut chunk).is_err() {
            return body;
        }
        body.extend_from_slice(&chunk[..size]);
    }
}
