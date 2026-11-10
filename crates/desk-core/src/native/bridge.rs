//! A native plugin's bridge connection, on the wire of `desk.sock` (ADR 0030): a `BridgeRequest` per
//! `\n`-terminated line in, its `BridgeResponse` and the events for the plugin out. Every request
//! goes through `Core::handle` as the plugin the desk started (ADR 0012's rule, ADR 0154): no line
//! names a caller, and the socket's `socket.agent` is refused, so a plugin can only ever call as
//! itself. The desk never waits on the plugin: a connection that lets [`QUEUE`] lines pile up is
//! closed.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use desk_bridge::{
    BridgeError, BridgeEvent, BridgeFailure, BridgeRequest, BridgeResponse, ErrorCode, False,
};
use serde_json::Value;

use super::events::{Claims, claim_key};
use crate::handler::Core;

/// Lines that may wait for the plugin before its connection is closed.
const QUEUE: usize = 1000;
/// The longest request line.
const MOST_LINE: usize = 16 << 20;

type Line = Arc<str>;

struct Connection {
    plugin: String,
    queue: SyncSender<Line>,
    claims: Mutex<Claims>,
    closed: AtomicBool,
    stream: UnixStream,
}

impl Connection {
    fn claims(&self) -> MutexGuard<'_, Claims> {
        self.claims.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Queue a line; a plugin that stopped reading is dropped.
    fn send(&self, line: String) {
        if self.queue.try_send(Line::from(line)).is_err() {
            self.close();
        }
    }

    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let _ = self.stream.shutdown(Shutdown::Both);
    }
}

/// Serve `stream` as plugin `plugin` until either side closes it.
pub(crate) fn serve(core: Arc<Core>, plugin: String, stream: UnixStream) -> io::Result<()> {
    let (queue, lines) = mpsc::sync_channel::<Line>(QUEUE);
    let connection = Arc::new(Connection {
        plugin,
        queue,
        claims: Mutex::default(),
        closed: AtomicBool::new(false),
        stream: stream.try_clone()?,
    });
    let mut writer = stream.try_clone()?;
    thread::Builder::new()
        .name("desk-native-bridge-write".to_owned())
        .spawn(move || {
            for line in lines {
                if writer.write_all(line.as_bytes()).is_err() {
                    break;
                }
            }
            let _ = writer.shutdown(Shutdown::Both);
        })?;
    let deliveries = core.events().subscribe_addressed();
    let events = Arc::clone(&connection);
    thread::Builder::new()
        .name("desk-native-bridge-events".to_owned())
        .spawn(move || {
            while !events.closed.load(Ordering::SeqCst) {
                let delivery = match deliveries.recv_timeout(Duration::from_millis(500)) {
                    Ok(delivery) => delivery,
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                let mut claims = events.claims();
                for event in claims.decide(&events.plugin, delivery) {
                    send_event(&events, &event);
                }
            }
        })?;
    thread::Builder::new()
        .name("desk-native-bridge-read".to_owned())
        .spawn(move || {
            read(&core, &connection, stream);
            connection.close();
        })?;
    Ok(())
}

fn send_event(connection: &Connection, event: &BridgeEvent) {
    if let Ok(mut line) = serde_json::to_string(event) {
        line.push('\n');
        connection.send(line);
    }
}

fn read(core: &Core, connection: &Connection, stream: UnixStream) {
    let mut reader = BufReader::new(stream).take(MOST_LINE as u64);
    let mut line = Vec::new();
    loop {
        line.clear();
        reader.set_limit(MOST_LINE as u64);
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) if !line.ends_with(b"\n") && line.len() >= MOST_LINE => return,
            Ok(_) => {}
        }
        let Some(asked) = request(&line) else {
            continue;
        };
        let (method, answer) = match asked {
            Ok(request) => {
                let method = method_of(&request);
                (method, core.handle(&connection.plugin, *request))
            }
            Err(invalid) => (None, invalid),
        };
        let Ok(mut text) = serde_json::to_string(&answer) else {
            continue;
        };
        text.push('\n');
        // The answer, then what its call started that came before it, in that order.
        let mut claims = connection.claims();
        connection.send(text);
        if let (Some(method), BridgeResponse::BridgeSuccess(ok)) = (&method, &answer)
            && let Some(key) = claim_key(method, &ok.result)
        {
            for event in claims.claim(key) {
                send_event(connection, &event);
            }
        }
    }
}

/// The request on one line, or the `invalid_params` answer for a line that is not one; `None` for
/// an empty line.
fn request(line: &[u8]) -> Option<Result<Box<BridgeRequest>, BridgeResponse>> {
    let line = line.trim_ascii();
    if line.is_empty() {
        return None;
    }
    let value: Value = match serde_json::from_slice(line) {
        Ok(value) => value,
        Err(why) => return Some(Err(invalid(0, format!("not a JSON line: {why}")))),
    };
    let id = value.get("id").and_then(Value::as_u64).unwrap_or(0);
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if method.as_deref() == Some("socket.agent") {
        let why = "a native plugin calls as itself: it cannot become an agent";
        return Some(Err(invalid(id, why.to_owned())));
    }
    Some(match serde_json::from_value(value) {
        Ok(request) => Ok(Box::new(request)),
        Err(_) => Err(invalid(
            id,
            match method {
                Some(method) => {
                    format!("not a bridge request: no method {method} with these params")
                }
                None => "not a bridge request: it needs an id, a method and params".to_owned(),
            },
        )),
    })
}

fn method_of(request: &BridgeRequest) -> Option<String> {
    let value = serde_json::to_value(request).ok()?;
    value.get("method")?.as_str().map(str::to_owned)
}

fn invalid(id: u64, message: String) -> BridgeResponse {
    BridgeResponse::BridgeFailure(BridgeFailure {
        id,
        ok: False,
        error: BridgeError {
            code: ErrorCode::InvalidParams,
            message,
            permission: None,
        },
    })
}
