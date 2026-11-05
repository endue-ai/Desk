//! The running desk, over its socket (ADR 0030). Every call opens a connection of its own, so a call
//! that waits for the person (a prompt, an approval) never holds up another. The catalog of plugins
//! and commands is read as `cli`; every call the MCP client asks for runs as the agent (ADR 0086).

use std::io;
use std::path::PathBuf;

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, RequestId};
use desk_ipc::Client;
use serde_json::{Map, Value, json};

/// The code of a [`Failure`] when there is no desk to answer.
pub(crate) const NO_DESK: &str = "no_desk";

/// Why a call gave no result: the desk's error (`specs/bridge/v0` codes, or the command's own
/// `failed` and `cancelled`), or [`NO_DESK`].
#[derive(Debug)]
pub(crate) struct Failure {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) permission: Option<Value>,
}

impl Failure {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            permission: None,
        }
    }

    /// The failure as the tool's output carries it.
    pub(crate) fn json(&self) -> Value {
        let mut error = json!({ "code": self.code, "message": self.message });
        if let Some(permission) = &self.permission {
            error["permission"] = permission.clone();
        }
        error
    }
}

/// Where the desk is and which agent the MCP client's calls run as.
pub(crate) struct Desk {
    socket: Option<PathBuf>,
    agent: String,
}

impl Desk {
    pub(crate) fn new(socket: Option<PathBuf>, agent: String) -> Self {
        Self { socket, agent }
    }

    /// The caller the MCP client's calls run as: `agent:<id>`.
    pub(crate) fn caller(&self) -> String {
        format!("agent:{}", self.agent)
    }

    /// A connection as `cli`, for reading the catalog.
    pub(crate) fn cli(&self) -> Result<Conn, Failure> {
        let Some(path) = &self.socket else {
            let why = "no data folder to find the desk socket in; set DESK_SOCKET";
            return Err(Failure::new(NO_DESK, why));
        };
        let client = Client::connect(path).map_err(|why| unreachable(path, &why))?;
        Ok(Conn {
            client,
            next: 0,
            path: path.clone(),
        })
    }

    /// A connection that calls as the agent.
    pub(crate) fn as_agent(&self) -> Result<Conn, Failure> {
        let mut conn = self.cli()?;
        conn.next += 1;
        let became = conn.client.become_agent(conn.next, &self.agent);
        answer(became.map_err(|why| lost(&conn.path, &why))?)?;
        Ok(conn)
    }
}

/// One connection to the desk.
pub(crate) struct Conn {
    client: Client,
    next: RequestId,
    path: PathBuf,
}

impl Conn {
    /// Call `method` with `params`; `cmd.invoke` waits for the command's answer.
    pub(crate) fn call(&mut self, method: &str, params: Value) -> Result<Value, Failure> {
        self.next += 1;
        let request = json!({ "id": self.next, "method": method, "params": params });
        let Ok(request) = serde_json::from_value::<BridgeRequest>(request) else {
            let why = format!(
                "Desk has no bridge method {method} that takes these params (specs/bridge/v0)"
            );
            return Err(Failure::new("invalid_params", why));
        };
        let answered = self.client.call(request);
        let result = answer(answered.map_err(|why| lost(&self.path, &why))?)?;
        if method != "cmd.invoke" {
            return Ok(result);
        }
        match result["invocationId"].as_str() {
            Some(invocation) => self.answered(invocation),
            None => Err(Failure::new("internal", "cmd.invoke gave no invocationId")),
        }
    }

    /// Run command `id` with `args` and wait for its answer.
    pub(crate) fn invoke(
        &mut self,
        id: &str,
        args: Option<Map<String, Value>>,
    ) -> Result<Value, Failure> {
        let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
        let mut params = json!({ "id": id, "scope": scope });
        if let Some(args) = args.filter(|args| !args.is_empty()) {
            params["args"] = Value::Object(args);
        }
        self.call("cmd.invoke", params)
    }

    /// The next core event, or why the connection ended.
    pub(crate) fn next_event(&mut self) -> io::Result<BridgeEvent> {
        self.client.next_event()
    }

    /// The `cmd.answered` of `invocation`, as the command's result or its failure.
    fn answered(&mut self, invocation: &str) -> Result<Value, Failure> {
        loop {
            let event = self.next_event().map_err(|why| lost(&self.path, &why))?;
            let BridgeEvent::CmdAnswered(answered) = event else {
                continue;
            };
            if answered.data.invocation_id != invocation {
                continue;
            }
            let data = answered.data;
            if data.ok {
                return Ok(data.result.unwrap_or(Value::Null));
            }
            return Err(match data.error {
                Some(failure) => {
                    Failure::new(&code(serde_json::to_value(failure.code)), failure.message)
                }
                None => Failure::new("failed", "the command failed"),
            });
        }
    }
}

/// The result of an answer, or its error as a [`Failure`].
fn answer(response: BridgeResponse) -> Result<Value, Failure> {
    match response {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(failed) => {
            let error = failed.error;
            let mut failure = Failure::new(&code(serde_json::to_value(error.code)), error.message);
            failure.permission = error
                .permission
                .and_then(|permission| serde_json::to_value(permission).ok());
            Err(failure)
        }
    }
}

/// A code's wire name, such as `permission_denied`.
fn code(value: serde_json::Result<Value>) -> String {
    value
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "failed".to_owned())
}

fn unreachable(path: &std::path::Path, why: &io::Error) -> Failure {
    let message = match why.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused => {
            format!("no desk at {} (is endue Desk running?)", path.display())
        }
        io::ErrorKind::Unsupported => why.to_string(),
        _ => format!("cannot reach the desk at {}: {why}", path.display()),
    };
    Failure::new(NO_DESK, message)
}

fn lost(path: &std::path::Path, why: &io::Error) -> Failure {
    Failure::new(
        NO_DESK,
        format!("lost the desk at {}: {why}", path.display()),
    )
}
