//! A native plugin's bridge calls (`specs/bridge/v0`) on the wire of `desk.sock`: a request per line
//! out, its answer back; events that come meanwhile are kept for [`Bridge::events`]. The desk answers
//! every call as this plugin, under its manifest's permissions.

use std::collections::VecDeque;
use std::io::{self, Write};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde_json::{Value, json};

use super::lines::{LineReader, Next};

/// The plugin's end of its bridge connection.
pub struct Bridge {
    writer: Mutex<UnixStream>,
    reader: Mutex<LineReader<UnixStream>>,
    next: AtomicU64,
    events: Mutex<VecDeque<Value>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl Bridge {
    pub fn new(stream: UnixStream) -> io::Result<Bridge> {
        Ok(Bridge {
            writer: Mutex::new(stream.try_clone()?),
            reader: Mutex::new(LineReader::new(stream)),
            next: AtomicU64::new(1),
            events: Mutex::default(),
        })
    }

    /// Call `method` with `params` and wait for the answer: `Ok` with its result, `Err` with its
    /// error (`code`, `message`, maybe `permission`). An I/O error means the desk went away.
    pub fn call(&self, method: &str, params: Value) -> io::Result<Result<Value, Value>> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let mut text = json!({ "id": id, "method": method, "params": params }).to_string();
        text.push('\n');
        // One call at a time: the reader is held until this call's answer comes.
        let mut reader = lock(&self.reader);
        lock(&self.writer).write_all(text.as_bytes())?;
        loop {
            let line = match reader.next_line()? {
                Next::Line(line) => line,
                Next::Idle => continue,
                Next::Closed => return Err(io::ErrorKind::UnexpectedEof.into()),
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if value.get("event").is_some() {
                lock(&self.events).push_back(value);
                continue;
            }
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            return Ok(match value.get("ok").and_then(Value::as_bool) {
                Some(true) => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
                _ => Err(value.get("error").cloned().unwrap_or(Value::Null)),
            });
        }
    }

    /// The events that came while calls waited, oldest first.
    pub fn events(&self) -> Vec<Value> {
        lock(&self.events).drain(..).collect()
    }
}
