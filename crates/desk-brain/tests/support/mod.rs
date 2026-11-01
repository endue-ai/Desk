//! Helpers for the conformance tests: brain-echo as a child process, raw HTTP against it, and the
//! contract's schemas.
#![allow(dead_code)]

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use desk_brain::BRAIN_SCHEMA_JSON;
use desk_brain_endue::http::{Endpoint, send};
use serde_json::{Value, json};

/// brain-echo on a free port, with no pause between events and its normal lease clock.
pub struct Echo {
    child: Child,
    pub url: String,
}

impl Echo {
    pub fn start() -> Self {
        Self::with_lease_clock(None)
    }

    /// Only explicit expiry checks accelerate a lease second to 20 real milliseconds.
    pub fn with_accelerated_leases() -> Self {
        Self::with_lease_clock(Some(20))
    }

    fn with_lease_clock(second_ms: Option<u64>) -> Self {
        let server =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/brain-echo/server.mjs");
        let mut command = Command::new("node");
        command
            .arg(server)
            .args(["--port", "0"])
            .env("BRAIN_ECHO_DELAY_MS", "0")
            .env_remove("BRAIN_ECHO_SECOND_MS")
            .stdout(Stdio::piped());
        if let Some(second_ms) = second_ms {
            command.env("BRAIN_ECHO_SECOND_MS", second_ms.to_string());
        }
        let mut child = command
            .spawn()
            .expect("node runs examples/brain-echo (Node 22 or later)");
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let url = line
            .split_whitespace()
            .find(|word| word.starts_with("http://"))
            .unwrap_or_else(|| panic!("brain-echo printed no URL: {line:?}"))
            .to_owned();
        Self { child, url }
    }
}

impl Drop for Echo {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Raw HTTP against the server, so the bodies are checked as they are on the wire.
pub struct Wire(pub Endpoint);

impl Wire {
    pub fn new(echo: &Echo) -> Self {
        Self(Endpoint::parse(&echo.url).unwrap())
    }

    pub fn call(&self, method: &str, path: &str, body: Option<Value>) -> (u16, Value) {
        let response = send(&self.0, None, method, path, body.as_ref()).unwrap();
        (response.status, response.json().unwrap())
    }

    pub fn stream(&self, path: &str, body: Value) -> Vec<Value> {
        let response = send(&self.0, None, "POST", path, Some(&body)).unwrap();
        assert_eq!(response.status, 200, "POST {path}");
        assert!(
            response.is_event_stream(),
            "POST {path} is not text/event-stream"
        );
        response
            .events()
            .map(|data| serde_json::from_str(&data.unwrap()).unwrap())
            .collect()
    }

    pub fn session(&self) -> String {
        let (_, session) = self.call(
            "POST",
            "/sessions",
            Some(vector("valid/create-session-request.json")),
        );
        session["id"].as_str().unwrap().to_owned()
    }

    pub fn acquire(&self, session: &str, desk: &str, ttl: u64) -> String {
        let body = json!({ "holder": { "deskId": desk }, "ttlSeconds": ttl });
        let (status, lease) = self.call("POST", &format!("/sessions/{session}/lease"), Some(body));
        assert_eq!(status, 200, "{lease}");
        lease["leaseId"].as_str().unwrap().to_owned()
    }
}

pub fn vectors_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/brain/v0/vectors")
}

/// A vector file: { target, description, instance }.
pub fn vector_doc(file: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(vectors_dir().join(file)).unwrap()).unwrap()
}

pub fn vector(file: &str) -> Value {
    vector_doc(file)["instance"].take()
}

pub fn said(text: &str, lease: &str) -> Value {
    json!({ "leaseId": lease, "message": { "role": "user", "content": [{ "type": "text", "text": text }] } })
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

pub fn kinds(events: &[Value]) -> Vec<&str> {
    events.iter().map(|e| e["type"].as_str().unwrap()).collect()
}

pub fn text(events: &[Value]) -> String {
    events.iter().filter_map(|e| e["text"].as_str()).collect()
}
