//! JSON-RPC 2.0 over newline-delimited JSON, the MCP stdio transport, from the client's side. One
//! reader thread takes the server's lines: a response goes to the request waiting for it, a
//! request from the server is answered at once (`ping` with `{}`, anything else method-not-found,
//! since the client offers no capabilities), and a notification goes to the connection's sink. When
//! the server's output ends, every waiting request fails `Closed` and the sink hears `None`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde_json::{Map, Value, json};

/// The longest line the client reads; a server that writes more is cut off.
const LINE_MAX: u64 = 16 * 1024 * 1024;

/// JSON-RPC's method-not-found.
const METHOD_NOT_FOUND: i64 = -32601;

/// A notification from the server: its method and params.
#[derive(Debug, Clone, PartialEq)]
pub struct Notification {
    pub method: String,
    pub params: Option<Value>,
}

/// Why a request got no result.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    /// The server answered with a JSON-RPC error.
    Rpc { code: i64, message: String },
    /// No answer in time; the server was told the request is cancelled.
    Timeout(Duration),
    /// The server's output ended (it exited, or was stopped) before it answered.
    Closed,
    /// The request could not be written.
    Io(String),
    /// The server answered something MCP does not allow here.
    Protocol(String),
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rpc { code, message } => write!(f, "the server answered error {code}: {message}"),
            Self::Timeout(wait) => write!(f, "the server did not answer within {wait:?}"),
            Self::Closed => f.write_str("the server stopped before it answered"),
            Self::Io(why) => write!(f, "cannot write to the server: {why}"),
            Self::Protocol(why) => write!(f, "the server broke the protocol: {why}"),
        }
    }
}

type Reply = Result<Value, Failure>;
type Writer = Arc<Mutex<Box<dyn Write + Send>>>;
type Waiting = Arc<Mutex<Option<HashMap<u64, SyncSender<Reply>>>>>;

/// The sink of a connection: each notification, then `None` once the server's output ends.
pub type Sink = Box<dyn FnMut(Option<Notification>) + Send>;

/// One connection to a server.
pub struct Connection {
    writer: Writer,
    /// Requests waiting for their answer; `None` once the output ended.
    waiting: Waiting,
    next: AtomicU64,
}

impl Connection {
    /// Start reading `output` (the server's stdout) on a thread of its own; requests go to `input`.
    pub fn start(
        output: impl Read + Send + 'static,
        input: impl Write + Send + 'static,
        sink: Sink,
    ) -> std::io::Result<Arc<Self>> {
        let connection = Arc::new(Self {
            writer: Arc::new(Mutex::new(Box::new(input))),
            waiting: Arc::new(Mutex::new(Some(HashMap::new()))),
            next: AtomicU64::new(0),
        });
        let writer = Arc::clone(&connection.writer);
        let waiting = Arc::clone(&connection.waiting);
        thread::Builder::new()
            .name("desk-mcp-client-read".to_owned())
            .spawn(move || read(output, &writer, &waiting, sink))?;
        Ok(connection)
    }

    /// Send a request and wait up to `wait` for its result.
    pub fn request(&self, method: &str, params: Value, wait: Duration) -> Reply {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (send, answer) = mpsc::sync_channel(1);
        match lock(&self.waiting).as_mut() {
            Some(waiting) => waiting.insert(id, send),
            None => return Err(Failure::Closed),
        };
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(why) = write_line(&self.writer, &line) {
            self.forget(id);
            return Err(Failure::Io(why.to_string()));
        }
        match answer.recv_timeout(wait) {
            Ok(reply) => reply,
            Err(RecvTimeoutError::Disconnected) => Err(Failure::Closed),
            Err(RecvTimeoutError::Timeout) => {
                self.forget(id);
                let reason = format!("no answer within {wait:?}");
                let _ = self.notify(
                    "notifications/cancelled",
                    json!({ "requestId": id, "reason": reason }),
                );
                Err(Failure::Timeout(wait))
            }
        }
    }

    /// Send a notification.
    pub fn notify(&self, method: &str, params: Value) -> std::io::Result<()> {
        let mut line = json!({ "jsonrpc": "2.0", "method": method });
        if !params.is_null() {
            line["params"] = params;
        }
        write_line(&self.writer, &line)
    }

    /// Close the server's input, which tells a stdio server to exit (the MCP shutdown). Later
    /// requests fail `Io`.
    pub fn close(&self) {
        *lock(&self.writer) = Box::new(Closed);
    }

    fn forget(&self, id: u64) {
        if let Some(waiting) = lock(&self.waiting).as_mut() {
            waiting.remove(&id);
        }
    }
}

fn read(output: impl Read, writer: &Writer, waiting: &Waiting, mut sink: Sink) {
    let mut reader = BufReader::new(output);
    let mut line = Vec::new();
    loop {
        line.clear();
        match (&mut reader).take(LINE_MAX).read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if !line.ends_with(b"\n") && line.len() as u64 >= LINE_MAX => break,
            Ok(_) => {}
        }
        // A line that is not JSON is the server's own noise on stdout: skipped.
        let Ok(value) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        let messages = match value {
            Value::Array(batch) => batch,
            one => vec![one],
        };
        for message in messages {
            if let Value::Object(message) = message {
                take(message, writer, waiting, &mut sink);
            }
        }
    }
    // Dropping the senders fails every waiting request with `Closed`.
    lock(waiting).take();
    sink(None);
}

/// One message from the server: a response, a request or a notification.
fn take(message: Map<String, Value>, writer: &Writer, waiting: &Waiting, sink: &mut Sink) {
    let method = message.get("method").and_then(Value::as_str);
    match (method, message.get("id")) {
        (Some(method), Some(id)) => {
            let line = match method {
                "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
                _ => json!({ "jsonrpc": "2.0", "id": id, "error": {
                    "code": METHOD_NOT_FOUND, "message": format!("Desk does not serve {method}") } }),
            };
            let _ = write_line(writer, &line);
        }
        (Some(method), None) => sink(Some(Notification {
            method: method.to_owned(),
            params: message.get("params").cloned(),
        })),
        (None, Some(id)) => {
            let Some(id) = id.as_u64() else { return };
            let waiter = lock(waiting).as_mut().and_then(|w| w.remove(&id));
            if let Some(waiter) = waiter {
                let _ = waiter.send(reply(&message));
            }
        }
        (None, None) => {}
    }
}

/// A response's result, or its error.
fn reply(message: &Map<String, Value>) -> Reply {
    if let Some(error) = message.get("error") {
        let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
        let text = error.get("message").and_then(Value::as_str).unwrap_or("");
        return Err(Failure::Rpc {
            code,
            message: text.to_owned(),
        });
    }
    message
        .get("result")
        .cloned()
        .ok_or_else(|| Failure::Protocol("a response with neither result nor error".to_owned()))
}

/// The input once closed.
struct Closed;

impl Write for Closed {
    fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
        Err(std::io::ErrorKind::BrokenPipe.into())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn write_line(writer: &Writer, value: &Value) -> std::io::Result<()> {
    let mut line = value.to_string();
    line.push('\n');
    let mut writer = lock(writer);
    writer.write_all(line.as_bytes())?;
    writer.flush()
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
