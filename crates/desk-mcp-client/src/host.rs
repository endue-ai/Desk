//! MCP servers attached to a desk (ADR 0098). Each server runs on a thread of its own as the caller
//! `mcp:<name>`, through the bridge like any provider: it asks the person for `proc:spawn` of its
//! command (`perm.request`, for always: answered at once when already held), starts the server,
//! registers each tool as a command, runs each `cmd.invoked` of its commands as a tool call and
//! answers with `cmd.answer`. A changed tool list is registered again. When the grant is revoked, the
//! server exits or the host stops, its commands are unregistered and the server is stopped; calls
//! still waiting fail. What happens goes to the server's own log channel.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use desk_bridge::{BridgeError, BridgeEvent, BridgeRequest, BridgeResponse, CmdInvokedData};
use desk_core::{Core, Init, mcp_caller};
use serde_json::{Value, json};

use crate::process::{Server, ServerConfig};
use crate::rpc::{Connection, Notification};
use crate::session::Session;
use crate::tools;

/// How long a server may take to start and shake hands (`npx` may download it first).
const START_WAIT: Duration = Duration::from_secs(120);
/// How long listing its tools may take.
const LIST_WAIT: Duration = Duration::from_secs(30);
/// How long one tool call may take, as long as a command run from a brain's tool call waits.
const CALL_WAIT: Duration = Duration::from_secs(300);
/// How long a server has to exit after its input closes, before it is killed.
const GRACE: Duration = Duration::from_secs(2);

/// What a server's thread hears.
enum Heard {
    Invoked(CmdInvokedData),
    GrantChanged,
    Mcp(Notification),
    Closed,
    Stop,
}

/// The servers of one desk. Dropping it tells them all to stop without waiting: a thread may be
/// waiting for the person to answer its grant prompt.
pub struct Host {
    servers: Vec<(Sender<Heard>, Option<JoinHandle<()>>)>,
}

impl Host {
    /// Attach every server in `servers` to `core`, each on its own thread, started in `cwd`.
    pub fn attach(core: &Arc<Core>, servers: Vec<ServerConfig>, cwd: PathBuf) -> Self {
        let servers = servers
            .into_iter()
            .map(|config| {
                let (tell, heard) = mpsc::channel();
                let (core, cwd, own) = (Arc::clone(core), cwd.clone(), tell.clone());
                let name = format!("desk-mcp-{}", config.name);
                let run = move || run(&core, &config, cwd, own, &heard);
                (tell, thread::Builder::new().name(name).spawn(run).ok())
            })
            .collect();
        Self { servers }
    }

    /// Stop every server and wait for each to end.
    pub fn stop(mut self) {
        self.tell_stop();
        for (_, thread) in &mut self.servers {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn tell_stop(&self) {
        for (tell, _) in &self.servers {
            let _ = tell.send(Heard::Stop);
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.tell_stop();
    }
}

/// The servers init.yaml lists (`mcp.servers`), in name order.
pub fn configs(init: &Init) -> Vec<ServerConfig> {
    let servers = init.mcp.iter().map(|(name, server)| ServerConfig {
        name: name.clone(),
        command: server.command.clone(),
        args: server.args.clone().unwrap_or_default(),
        env: server.env.clone().unwrap_or_default(),
    });
    servers.collect()
}

/// One server's life, as `mcp:<name>`.
fn run(
    core: &Arc<Core>,
    config: &ServerConfig,
    cwd: PathBuf,
    tell: Sender<Heard>,
    heard: &Receiver<Heard>,
) {
    let Some(caller) = mcp_caller(&config.name) else {
        return;
    };
    let log = Logger::new(core, &caller);
    if !ask(core, &caller, config) {
        log.write(
            "warn",
            format!(
                "not started: the person did not allow it to run {}",
                config.command
            ),
        );
        return;
    }
    let stderr = log.clone();
    let spawned = Server::spawn(config, &cwd, move |line| stderr.write("info", line));
    let (server, stdout, stdin) = match spawned {
        Ok(spawned) => spawned,
        Err(why) => {
            return log.write(
                "error",
                format!("cannot start {}: {why}", config.describe()),
            );
        }
    };
    let closed = tell.clone();
    let sink = Box::new(move |note: Option<Notification>| {
        let _ = closed.send(note.map_or(Heard::Closed, Heard::Mcp));
    });
    let Ok(connection) = Connection::start(stdout, stdin, sink) else {
        return;
    };
    let session = match Session::open(Arc::clone(&connection), START_WAIT) {
        Ok(session) => Arc::new(session),
        Err(why) => {
            connection.close();
            server.stop(GRACE);
            return log.write(
                "error",
                format!("{} did not start: {why}", config.describe()),
            );
        }
    };
    let listening = Arc::new(AtomicBool::new(true));
    forward(core, &caller, Arc::clone(&listening), tell);
    let mut routes = refresh(core, &caller, config, &session, &BTreeMap::new(), &log);
    let why = loop {
        match heard.recv_timeout(Duration::from_secs(60)) {
            Ok(Heard::Invoked(data)) => invoke(core, &caller, &session, &routes, data),
            Ok(Heard::GrantChanged) if !held(core, &caller, &config.command) => {
                break "its grant was revoked";
            }
            Ok(Heard::Mcp(note)) if note.method == "notifications/tools/list_changed" => {
                routes = refresh(core, &caller, config, &session, &routes, &log);
            }
            Ok(Heard::Closed) => break "the server exited",
            Ok(Heard::Stop) | Err(RecvTimeoutError::Disconnected) => break "Desk stopped it",
            Ok(_) | Err(RecvTimeoutError::Timeout) => {}
        }
    };
    listening.store(false, Ordering::SeqCst);
    for id in routes.keys() {
        let _ = call(core, &caller, "cmd.unregister", json!({ "id": id }));
    }
    connection.close();
    server.stop(GRACE);
    log.write("info", format!("stopped: {why}"));
}

/// Ask the person to let `caller` run the server's program, for always.
fn ask(core: &Core, caller: &str, config: &ServerConfig) -> bool {
    let reason = format!(
        "Start the MCP server {}: {}. Its tools become commands that agents may ask to run.",
        config.name,
        config.describe()
    );
    let params = json!({ "permission": spawn_scope(&config.command), "reason": reason,
        "duration": "always" });
    call(core, caller, "perm.request", params).is_ok_and(|answer| answer["granted"] == true)
}

/// Whether a grant of `caller` still covers running `command`.
fn held(core: &Core, caller: &str, command: &str) -> bool {
    let params = json!({ "permission": spawn_scope(command) });
    let answer = call(core, caller, "perm.query", params);
    answer.is_ok_and(|a| {
        a["grants"]
            .as_array()
            .is_some_and(|grants| !grants.is_empty())
    })
}

fn spawn_scope(command: &str) -> Value {
    json!({ "permission": "proc:spawn", "commands": [command] })
}

/// Register the server's tools as they are now and unregister the commands of tools it dropped.
/// Answers the tool each command id runs.
fn refresh(
    core: &Core,
    caller: &str,
    config: &ServerConfig,
    session: &Session,
    before: &BTreeMap<String, String>,
    log: &Logger,
) -> BTreeMap<String, String> {
    let listed = match session.tools(LIST_WAIT) {
        Ok(tools) => tools::commands(&config.name, &tools),
        Err(why) => {
            log.write("error", format!("cannot list its tools: {why}"));
            return before.clone();
        }
    };
    let registered: Vec<_> = listed
        .into_iter()
        .filter(
            |command| match call(core, caller, "cmd.register", command.register.clone()) {
                Ok(_) => true,
                Err(why) => {
                    log.write(
                        "warn",
                        format!("{} is left out: {}", command.tool, why.message),
                    );
                    false
                }
            },
        )
        .collect();
    let routes = tools::by_id(&registered);
    for id in before.keys().filter(|id| !routes.contains_key(*id)) {
        let _ = call(core, caller, "cmd.unregister", json!({ "id": id }));
    }
    log.write("info", format!("{} tools registered", routes.len()));
    routes
}

/// Run one invocation as a tool call on a thread of its own, then answer it.
fn invoke(
    core: &Arc<Core>,
    caller: &str,
    session: &Arc<Session>,
    routes: &BTreeMap<String, String>,
    data: CmdInvokedData,
) {
    let Some(tool) = routes.get(&data.id).cloned() else {
        let gone = Err(format!("the server no longer has {}", data.id));
        let _ = call(
            core,
            caller,
            "cmd.answer",
            tools::answer(&data.invocation_id, gone),
        );
        return;
    };
    let (core, caller, session) = (Arc::clone(core), caller.to_owned(), Arc::clone(session));
    let _ = thread::Builder::new()
        .name("desk-mcp-call".to_owned())
        .spawn(move || {
            let args = data.args.unwrap_or_default();
            let result = session
                .call(&tool, args, CALL_WAIT)
                .map_err(|f| f.to_string());
            let answer = tools::answer(&data.invocation_id, result);
            let _ = call(&core, &caller, "cmd.answer", answer);
        });
}

/// Hand the core events for `caller` to its thread while `listening`: invocations of its commands
/// and changes to grants (which may be its own).
fn forward(core: &Core, caller: &str, listening: Arc<AtomicBool>, tell: Sender<Heard>) {
    let events = core.events().subscribe();
    let prefix = format!("mcp.{}.", caller.trim_start_matches("mcp:"));
    let _ = thread::Builder::new()
        .name("desk-mcp-events".to_owned())
        .spawn(move || {
            while listening.load(Ordering::SeqCst) {
                let heard = match events.recv_timeout(Duration::from_secs(1)) {
                    Ok(BridgeEvent::CmdInvoked(event)) if event.data.id.starts_with(&prefix) => {
                        Heard::Invoked(event.data)
                    }
                    Ok(BridgeEvent::PermChanged(_)) => Heard::GrantChanged,
                    Ok(_) | Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                if tell.send(heard).is_err() {
                    break;
                }
            }
        });
}

/// `log.write` on the server's own channel.
#[derive(Clone)]
struct Logger {
    core: Arc<Core>,
    caller: String,
}

impl Logger {
    fn new(core: &Arc<Core>, caller: &str) -> Self {
        let (core, caller) = (Arc::clone(core), caller.to_owned());
        Self { core, caller }
    }

    fn write(&self, level: &str, message: String) {
        let params = json!({ "level": level, "message": message });
        let _ = call(&self.core, &self.caller, "log.write", params);
    }
}

/// One bridge call as `caller`.
fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
    let request = json!({ "id": 0, "method": method, "params": params });
    let request: BridgeRequest = serde_json::from_value(request).map_err(|why| BridgeError {
        code: desk_bridge::ErrorCode::InvalidParams,
        message: why.to_string(),
        permission: None,
    })?;
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(failed) => Err(failed.error),
    }
}
