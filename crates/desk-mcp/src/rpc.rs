//! JSON-RPC 2.0 as MCP's stdio transport carries it: one message per `\n`-terminated UTF-8 line, and
//! nothing else on stdout. A request has an `id` and gets one answer; a notification has none and
//! gets nothing. Batches are not part of MCP since 2025-06-18 and are refused.

use std::io::{self, Write};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

pub(crate) const PARSE_ERROR: i64 = -32700;
pub(crate) const INVALID_REQUEST: i64 = -32600;
pub(crate) const METHOD_NOT_FOUND: i64 = -32601;
pub(crate) const INVALID_PARAMS: i64 = -32602;
pub(crate) const INTERNAL_ERROR: i64 = -32603;
/// MCP's code for a resource the server does not have.
pub(crate) const RESOURCE_NOT_FOUND: i64 = -32002;

/// One message from the client.
pub(crate) enum Message {
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
    /// An answer to a request: the server sends none, so there is nothing to do with it.
    Answer,
}

/// The message on one line, or the error answer for a line that is not one. `None` for an empty line.
pub(crate) fn message(line: &[u8]) -> Option<Result<Message, Value>> {
    let line = line.trim_ascii();
    if line.is_empty() {
        return None;
    }
    let value: Value = match serde_json::from_slice(line) {
        Ok(value) => value,
        Err(why) => {
            let why = format!("not a JSON-RPC message: {why}");
            return Some(Err(error(Value::Null, PARSE_ERROR, &why)));
        }
    };
    if value.is_array() {
        let why = "batches are not supported";
        return Some(Err(error(Value::Null, INVALID_REQUEST, why)));
    }
    let id = value.get("id").cloned();
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        if value.get("result").is_some() || value.get("error").is_some() {
            return Some(Ok(Message::Answer));
        }
        let id = id.unwrap_or(Value::Null);
        return Some(Err(error(id, INVALID_REQUEST, "a request needs a method")));
    };
    let method = method.to_owned();
    let params = value.get("params").cloned().unwrap_or_else(|| json!({}));
    Some(match id {
        None => Ok(Message::Notification { method, params }),
        Some(id) if id.is_string() || id.is_i64() || id.is_u64() => {
            Ok(Message::Request { id, method, params })
        }
        Some(_) => Err(error(
            Value::Null,
            INVALID_REQUEST,
            "an id is a string or an integer",
        )),
    })
}

/// The answer to request `id`.
pub(crate) fn result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// The error answer to request `id`.
pub(crate) fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// A notification with no params.
pub(crate) fn notification(method: &str) -> Value {
    json!({ "jsonrpc": "2.0", "method": method })
}

/// Where messages go: each one line, written whole under a lock, so threads never interleave.
#[derive(Clone)]
pub(crate) struct Out(Arc<Mutex<Box<dyn Write + Send>>>);

impl Out {
    pub(crate) fn new(output: impl Write + Send + 'static) -> Self {
        Self(Arc::new(Mutex::new(Box::new(output))))
    }

    pub(crate) fn send(&self, message: &Value) -> io::Result<()> {
        let mut line = message.to_string();
        line.push('\n');
        let mut output = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        output.write_all(line.as_bytes())?;
        output.flush()
    }
}
