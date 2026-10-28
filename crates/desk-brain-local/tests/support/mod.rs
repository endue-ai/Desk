//! Helpers for the desk-brain-local tests: a fake Ollama on std's TcpListener, the contract's
//! schemas, and short ways to open a session and run a turn.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use desk_brain::{
    BRAIN_SCHEMA_JSON, Brain, BrainFailure, ClientInfo, CreateSessionRequest, LeaseAcquireRequest,
    LeaseHolder, TextPart, ToolResultRequest, TurnRequest, UserMessage,
};
use desk_brain_local::{LocalBrain, LocalBrainOptions};
use serde_json::{Value, json};

pub const MODEL: &str = "test-model";

/// What the fake answers to one request.
pub enum Reply {
    /// 200 with these NDJSON lines, one chunk each, then the end of the body.
    Stream(Vec<String>),
    /// 200 with these lines, then the connection closes before the body ends.
    Cut(Vec<String>),
    /// This status with this body.
    Error(u16, String),
}

/// Ollama's `/api/chat`, as far as the tests need it: one scripted reply per request, in order.
pub struct FakeOllama {
    pub url: String,
    requests: Arc<Mutex<Vec<(String, Value)>>>,
}

impl FakeOllama {
    pub fn start(replies: Vec<Reply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&requests);
        let mut replies: VecDeque<Reply> = replies.into();
        thread::spawn(move || {
            while let Some(reply) = replies.pop_front() {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let request = read_request(&stream);
                seen.lock().unwrap().push(request);
                answer(stream, reply);
            }
        });
        Self { url, requests }
    }

    /// Every request so far: its path and its JSON body.
    pub fn requests(&self) -> Vec<(String, Value)> {
        self.requests.lock().unwrap().clone()
    }
}

fn read_request(stream: &TcpStream) -> (String, Value) {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let path = line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_owned();
    let mut length = 0;
    loop {
        line.clear();
        if reader.read_line(&mut line).unwrap() == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':')
            && name.trim().eq_ignore_ascii_case("content-length")
        {
            length = value.trim().parse().unwrap();
        }
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    (path, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

fn answer(mut stream: TcpStream, reply: Reply) {
    let (lines, finish) = match reply {
        Reply::Error(status, body) => {
            let head = format!(
                "HTTP/1.1 {status} Error\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(format!("{head}{body}").as_bytes());
            return;
        }
        Reply::Stream(lines) => (lines, true),
        Reply::Cut(lines) => (lines, false),
    };
    let head = "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n\
                Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(head.as_bytes());
    for line in lines {
        let data = format!("{line}\n");
        let _ = stream.write_all(format!("{:x}\r\n{data}\r\n", data.len()).as_bytes());
        let _ = stream.flush();
    }
    if finish {
        let _ = stream.write_all(b"0\r\n\r\n");
    }
}

/// A chunk of answer text.
pub fn say(text: &str) -> String {
    json!({ "model": MODEL, "created_at": "2026-10-29T00:00:00Z",
            "message": { "role": "assistant", "content": text }, "done": false })
    .to_string()
}

/// A chunk carrying tool calls, as Ollama sends them.
pub fn calls(calls: &[(&str, Value)]) -> String {
    let calls: Vec<Value> = calls
        .iter()
        .map(|(name, arguments)| json!({ "function": { "name": name, "arguments": arguments } }))
        .collect();
    json!({ "model": MODEL, "created_at": "2026-10-29T00:00:00Z",
            "message": { "role": "assistant", "content": "", "tool_calls": calls }, "done": false })
    .to_string()
}

/// The last chunk of an answer.
pub fn done(reason: &str) -> String {
    json!({ "model": MODEL, "created_at": "2026-10-29T00:00:00Z",
            "message": { "role": "assistant", "content": "" },
            "done": true, "done_reason": reason, "eval_count": 3 })
    .to_string()
}

/// A port nothing listens on.
pub fn closed_url() -> String {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    format!("http://127.0.0.1:{port}")
}

/// A fresh folder under the system temp folder, removed on drop.
pub struct Folder(pub PathBuf);

impl Folder {
    pub fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let name = format!(
            "desk-brain-local-{}-{nanos}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        Self(std::env::temp_dir().join(name))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    /// The names of the files in the folder.
    pub fn files(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn options(url: &str) -> LocalBrainOptions {
    LocalBrainOptions::new(MODEL).with_base_url(url)
}

pub fn brain(url: &str, folder: &Folder) -> LocalBrain {
    LocalBrain::open(folder.path(), options(url)).unwrap()
}

pub fn holder(desk: &str) -> LeaseHolder {
    LeaseHolder {
        desk_id: desk.to_owned(),
        name: None,
    }
}

pub fn acquire(desk: &str, ttl: u64, takeover: bool) -> LeaseAcquireRequest {
    LeaseAcquireRequest {
        holder: holder(desk),
        ttl_seconds: ttl,
        takeover: takeover.then_some(true),
    }
}

/// A new session and a lease on it for `desk`: (session id, lease id).
pub fn open(brain: &LocalBrain, desk: &str) -> (String, String) {
    let session = brain
        .create_session(&CreateSessionRequest {
            title: None,
            client: ClientInfo {
                name: "tests".to_owned(),
                version: "0".to_owned(),
            },
        })
        .unwrap();
    let lease = brain
        .acquire_lease(&session.id, &acquire(desk, 60, false))
        .unwrap();
    (session.id, lease.lease_id)
}

pub fn said(text: &str, lease: &str) -> TurnRequest {
    TurnRequest {
        lease_id: lease.to_owned(),
        message: UserMessage {
            role: Default::default(),
            content: vec![TextPart {
                r#type: Default::default(),
                text: text.to_owned(),
            }],
        },
    }
}

/// Run a turn; every event is checked against the contract and returned as JSON.
pub fn turn(
    brain: &LocalBrain,
    session: &str,
    lease: &str,
    text: &str,
) -> (Result<(), BrainFailure>, Vec<Value>) {
    let contract = Contract::new();
    let mut events = Vec::new();
    let result = brain.create_turn(session, &said(text, lease), &mut |event| {
        let event = serde_json::to_value(event).unwrap();
        contract.check("TurnEvent", &event);
        events.push(event);
    });
    (result, events)
}

/// Send a tool's result; every event is checked against the contract and returned as JSON.
pub fn submit(
    brain: &LocalBrain,
    session: &str,
    turn_id: &str,
    lease: &str,
    call_id: &str,
    output: Value,
) -> (Result<(), BrainFailure>, Vec<Value>) {
    let contract = Contract::new();
    let mut events = Vec::new();
    let request = ToolResultRequest {
        lease_id: lease.to_owned(),
        call_id: call_id.to_owned(),
        output,
        is_error: None,
    };
    let result = brain.submit_tool_result(session, turn_id, &request, &mut |event| {
        let event = serde_json::to_value(event).unwrap();
        contract.check("TurnEvent", &event);
        events.push(event);
    });
    (result, events)
}

pub fn kinds(events: &[Value]) -> Vec<&str> {
    events.iter().map(|e| e["type"].as_str().unwrap()).collect()
}

pub fn text(events: &[Value]) -> String {
    events
        .iter()
        .filter(|e| e["type"] == "text.delta")
        .filter_map(|e| e["text"].as_str())
        .collect()
}

/// The refusal's status and error code, or a panic naming what came instead.
pub fn refused<T: std::fmt::Debug>(result: Result<T, BrainFailure>) -> (u16, String) {
    match result {
        Err(BrainFailure::Refused { status, error }) => (
            status,
            serde_json::to_value(error.code)
                .unwrap()
                .as_str()
                .unwrap()
                .to_owned(),
        ),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// The contract's component schemas, with formats checked.
pub struct Contract {
    id: String,
    registry: jsonschema::Registry<'static>,
}

impl Contract {
    pub fn new() -> Self {
        let schema: Value = serde_json::from_str(BRAIN_SCHEMA_JSON).unwrap();
        let id = schema["$id"].as_str().unwrap().to_owned();
        let registry = jsonschema::Registry::new()
            .add(&id, schema)
            .unwrap()
            .prepare()
            .unwrap();
        Self { id, registry }
    }

    pub fn check(&self, target: &str, value: &Value) {
        let validator = jsonschema::options()
            .with_registry(&self.registry)
            .should_validate_formats(true)
            .build(&json!({ "$ref": format!("{}#/$defs/{target}", self.id) }))
            .unwrap();
        let errors: Vec<String> = validator
            .iter_errors(value)
            .map(|e| e.to_string())
            .collect();
        assert!(errors.is_empty(), "{target} {value}: {errors:?}");
    }
}
