//! The MCP session on stdin and stdout: `initialize`, `ping`, `tools/list`, `tools/call`,
//! `resources/list`, `resources/templates/list` and `resources/read`, and the notifications
//! `initialized` and `cancelled`. Each tool call runs on a thread of its own, so one that waits for
//! the person never holds up the rest; the session ends when the client closes stdin.

use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{Value, json};

use crate::call::{self, RpcError};
use crate::catalog::Catalog;
use crate::desk::Desk;
use crate::rpc::{self, INVALID_PARAMS, METHOD_NOT_FOUND, Message, Out};
use crate::tools::{self, Selection};
use crate::watch::{self, Flags};
use crate::{DEFAULT_AGENT, PROTOCOL_VERSIONS, SERVER_NAME};

/// How `desk mcp` serves: the agent its calls run as, the plugins whose commands get tools of their
/// own (`*` for all, `desk` for the runtime's), and the desk socket.
#[derive(Clone, Debug)]
pub struct Options {
    pub agent: String,
    pub plugins: Vec<String>,
    pub socket: Option<PathBuf>,
}

impl Default for Options {
    /// The agent `mcp`, no command with a tool of its own, the desk socket `desk_ipc::socket_path`.
    fn default() -> Self {
        Self {
            agent: DEFAULT_AGENT.to_owned(),
            plugins: Vec::new(),
            socket: desk_ipc::socket_path(),
        }
    }
}

const INSTRUCTIONS: &str = "endue Desk is a desktop built of plugins: files, notes, mail, \
calendar, git, docker, a terminal and more. list-plugins and list-commands show what the running \
desk has; run-command runs any plugin's command; call-bridge calls the bridge methods \
(specs/bridge/v0), such as data.query for the items connectors bring in. Every call runs as one \
agent of the person's: Desk asks them the first time, holds irreversible actions for their \
approval and logs each call.";

/// Serve one MCP client until it closes `input`. `Err` when `output` cannot be written.
pub fn serve(
    mut input: impl BufRead,
    output: impl Write + Send + 'static,
    options: Options,
) -> io::Result<()> {
    let selection = Selection::new(options.plugins);
    let session = Session {
        desk: Arc::new(Desk::new(options.socket, options.agent)),
        tools_change: selection.any(),
        selection: Arc::new(selection),
        out: Out::new(output),
        flags: Flags::default(),
        cancelled: Arc::default(),
    };
    watch::start(
        Arc::clone(&session.desk),
        session.out.clone(),
        session.tools_change,
        session.flags.clone(),
    );
    let mut line = Vec::new();
    let served = loop {
        line.clear();
        match input.read_until(b'\n', &mut line) {
            Ok(0) => break Ok(()),
            Ok(_) => {}
            Err(why) => break Err(why),
        }
        if let Err(why) = session.handle(&line) {
            break Err(why);
        }
    };
    session.flags.stop.store(true, Ordering::SeqCst);
    served
}

struct Session {
    desk: Arc<Desk>,
    selection: Arc<Selection>,
    tools_change: bool,
    out: Out,
    flags: Flags,
    /// Requests the client cancelled: their answers are not sent.
    cancelled: Arc<Mutex<HashSet<String>>>,
}

impl Session {
    fn handle(&self, line: &[u8]) -> io::Result<()> {
        match rpc::message(line) {
            None | Some(Ok(Message::Answer)) => Ok(()),
            Some(Err(answer)) => self.out.send(&answer),
            Some(Ok(Message::Notification { method, params })) => {
                match method.as_str() {
                    "notifications/initialized" => self.flags.ready.store(true, Ordering::SeqCst),
                    "notifications/cancelled" => {
                        let id = params["requestId"].to_string();
                        lock(&self.cancelled).insert(id);
                    }
                    _ => {}
                }
                Ok(())
            }
            Some(Ok(Message::Request { id, method, params })) => {
                if method == "tools/call" {
                    return self.call(id, &params);
                }
                let answer = self.answer(&method, &params);
                self.out.send(&match answer {
                    Ok(result) => rpc::result(id, result),
                    Err((code, message)) => rpc::error(id, code, &message),
                })
            }
        }
    }

    fn answer(&self, method: &str, params: &Value) -> Result<Value, RpcError> {
        match method {
            "initialize" => Ok(initialize(params, self.tools_change)),
            "ping" => Ok(json!({})),
            "tools/list" => {
                let catalog = self.tools_change.then(|| Catalog::read(&self.desk).ok());
                Ok(tools::list(&self.selection, catalog.flatten().as_ref()))
            }
            "resources/list" => Ok(crate::resources::list(&self.desk)),
            "resources/templates/list" => Ok(json!({ "resourceTemplates": [] })),
            "resources/read" => match params["uri"].as_str() {
                Some(uri) => crate::resources::read(&self.desk, &self.selection, uri),
                None => Err((INVALID_PARAMS, "resources/read needs a uri".to_owned())),
            },
            _ => Err((METHOD_NOT_FOUND, format!("no method {method} here"))),
        }
    }

    /// `tools/call` on a thread of its own; its answer is sent unless the client cancelled it.
    fn call(&self, id: Value, params: &Value) -> io::Result<()> {
        let Some(name) = params["name"].as_str().map(str::to_owned) else {
            let message = "tools/call needs the name of a tool";
            return self.out.send(&rpc::error(id, INVALID_PARAMS, message));
        };
        let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
        let desk = Arc::clone(&self.desk);
        let selection = Arc::clone(&self.selection);
        let out = self.out.clone();
        let cancelled = Arc::clone(&self.cancelled);
        thread::Builder::new()
            .name("desk-mcp-call".to_owned())
            .spawn(move || {
                let answer = match call::call(&desk, &selection, &name, &arguments) {
                    Ok(result) => rpc::result(id.clone(), result),
                    Err((code, message)) => rpc::error(id.clone(), code, &message),
                };
                if !lock(&cancelled).remove(&id.to_string()) {
                    let _ = out.send(&answer);
                }
            })
            .map(drop)
    }
}

/// The answer to `initialize`: the client's protocol version when this server speaks it, else the
/// newest it does; what it serves; who it is; how to use it.
fn initialize(params: &Value, tools_change: bool) -> Value {
    let asked = params["protocolVersion"].as_str();
    let version = PROTOCOL_VERSIONS
        .iter()
        .find(|version| Some(**version) == asked)
        .unwrap_or(&PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": {
            "tools": { "listChanged": tools_change },
            "resources": { "listChanged": true }
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "title": "endue Desk",
            "version": env!("CARGO_PKG_VERSION")
        },
        "instructions": INSTRUCTIONS
    })
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
