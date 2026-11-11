//! The subcommands a running desk answers over its socket (desk-ipc, ADR 0030). The CLI is the
//! caller `cli`: what it may do is what the desk granted it. Exit codes: 0 ok, 1 a bridge error, a
//! failed or cancelled command, no answer within `cmd run --timeout`, or no desk at the socket.
//! When no answer came, `--json` prints the CLI's own failure as one line on stdout (`fail`).

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse};
use desk_ipc::Client;
use serde_json::{Map, Value, json};

use crate::args::Remote;

mod cmd;
mod gone;
mod inspect;
mod market;
mod sync;
mod update;

pub fn run(remote: Remote, json: bool) -> ExitCode {
    let Some(path) = desk_ipc::socket_path() else {
        let why = "no data folder to find the desk socket in; set DESK_SOCKET";
        return fail(json, NO_DESK, why);
    };
    let client = match Client::connect(&path) {
        Ok(client) => client,
        Err(why) => {
            let code = match why.kind() {
                io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused => NO_DESK,
                io::ErrorKind::Unsupported => "unsupported",
                _ => "io_error",
            };
            return fail(json, code, &unreachable(&path, &why));
        }
    };
    let mut session = Session {
        client,
        next: 0,
        json,
        path: path.clone(),
    };
    session.run(remote).unwrap_or_else(|why| match why {
        Problem::Io(why) => {
            let why = format!("lost the desk at {}: {why}", path.display());
            fail(json, "io_error", &why)
        }
        Problem::Closed(id) => {
            let why = format!(
                "lost the desk at {} while {id} ran: the desk closed the connection",
                path.display()
            );
            fail(json, "io_error", &why)
        }
        Problem::Request(why) => fail(json, "failed", &why),
    })
}

/// The code of the CLI's own failure when nothing answers at the socket.
const NO_DESK: &str = "no_desk";

pub(crate) enum Problem {
    Io(io::Error),
    /// The desk closed the connection while the command with this id ran: it may have quit or
    /// started again (`gone`).
    Closed(String),
    Request(String),
}

impl From<io::Error> for Problem {
    fn from(why: io::Error) -> Self {
        Self::Io(why)
    }
}

/// What the desk answered, and the answer line as it came.
pub(crate) struct Reply {
    pub(crate) result: Result<Value, (String, String)>,
    pub(crate) line: String,
}

pub(crate) struct Session {
    client: Client,
    next: u64,
    pub(crate) json: bool,
    /// The socket, to look for the desk again after it closed the connection (`gone`).
    path: PathBuf,
}

impl Session {
    fn run(&mut self, remote: Remote) -> Result<ExitCode, Problem> {
        let plugin_manage = json!({ "permission": "plugin:manage" });
        let perm_manage = json!({ "permission": "perm:manage" });
        match remote {
            Remote::Ping => self.done("init.get", json!({})),
            Remote::CmdList => self.listing(
                "cmd.list",
                json!({ "scope": invoke(&["*"]) }),
                "commands",
                |c| {
                    format!(
                        "{}\t{}\t{}",
                        text(c, "id"),
                        text(c, "provider"),
                        text(c, "title")
                    )
                },
            ),
            Remote::CmdTools { query } => self.listing(
                "cmd.tools",
                match query {
                    Some(query) => json!({ "query": query, "limit": 200 }),
                    None => json!({ "limit": 200 }),
                },
                "tools",
                |t| {
                    let does = match (&t["readOnly"], &t["irreversible"]) {
                        (Value::Bool(true), _) => "reads",
                        (_, Value::Bool(true)) => "irreversible",
                        _ => "acts",
                    };
                    let (id, provider) = (text(t, "command"), text(t, "provider"));
                    format!("{id}\t{provider}\t{does}\t{}", text(t, "description"))
                },
            ),
            Remote::CmdRun { id, args, timeout } => self.cmd_run(&id, args, timeout),
            // Key and profile layers are the runtime's: it answers, the CLI prints its text.
            Remote::Describe { kind, name } => {
                let args = json!({ "kind": kind, "name": name, "show": false });
                let reply = self.invoke_and_wait(DESCRIBE, args.as_object().cloned())?;
                Ok(self.report(reply, |result| vec![text(result, "text").to_owned()]))
            }
            Remote::PluginList => self.listing(
                "plugin.list",
                json!({ "scope": plugin_manage }),
                "plugins",
                |p| {
                    let enabled = if p["enabled"] == true {
                        "enabled"
                    } else {
                        "disabled"
                    };
                    format!("{}\t{}\t{enabled}", text(p, "id"), text(p, "status"))
                },
            ),
            Remote::PluginSync => self.sync(),
            Remote::MarketList => self.market_list(),
            Remote::MarketInstall { id, accept } => self.market_install(&id, accept),
            Remote::PluginSetEnabled { id, enabled } => self.done(
                "plugin.setEnabled",
                json!({ "plugin": id, "enabled": enabled, "scope": plugin_manage }),
            ),
            Remote::PermList => self.listing(
                "perm.list",
                json!({ "scope": perm_manage }),
                "grants",
                |g| {
                    let grant = &g["grant"];
                    let id = text(grant, "grantId");
                    format!("{id}\t{}\t{}", text(g, "caller"), grant["permission"])
                },
            ),
            Remote::PermRevoke { grant_id } => self.done(
                "perm.revoke",
                json!({ "grantId": grant_id, "scope": perm_manage }),
            ),
            Remote::PermLog { agent } => self.perm_log(agent.as_deref()),
            Remote::Update(step) => self.update(step),
            Remote::Theme(step) => self.theme(step),
            Remote::Fs(step) => self.files(step),
            Remote::Log { count } => self.log(count),
            Remote::Undo { redo } => self.undo(redo),
            Remote::Inspect { section } => self.inspect(section),
        }
    }

    /// The latest 1000 entries of the `perm` channel, or `agent:<agent>`'s among them: one line each,
    /// `at  caller  decision  permission  target-or-scope  [reason or approval]`, or with `--json`
    /// each entry as one JSON line.
    fn perm_log(&mut self, agent: Option<&str>) -> Result<ExitCode, Problem> {
        let params =
            json!({ "channel": "perm", "count": 1000, "scope": { "permission": "log:read" } });
        let reply = self.call("log.tail", params)?;
        let caller = agent.map(|agent| format!("agent:{agent}"));
        let entries = match &reply.result {
            Ok(result) => result["entries"].as_array().cloned().unwrap_or_default(),
            Err(_) => return Ok(self.report(reply, |_| Vec::new())),
        };
        for entry in entries {
            let fields = &entry["fields"];
            if caller
                .as_deref()
                .is_some_and(|caller| fields["caller"] != caller)
            {
                continue;
            }
            if self.json {
                out(&entry.to_string());
                continue;
            }
            let target = match fields["target"].as_str() {
                Some(target) => target.to_owned(),
                None => fields["scope"].to_string(),
            };
            let mut line = format!(
                "{}\t{}\t{}\t{}\t{target}",
                text(&entry, "at"),
                text(fields, "caller"),
                text(fields, "decision"),
                text(fields, "permission")
            );
            // Why a call was refused, or how an approval was given (ADR 0078).
            let how = fields["reason"].as_str().or(fields["approval"].as_str());
            if let Some(how) = how {
                line.push_str(&format!("\t{how}"));
            }
            out(&line);
        }
        Ok(ExitCode::SUCCESS)
    }

    /// A call whose success prints `ok`.
    pub(crate) fn done(&mut self, method: &str, params: Value) -> Result<ExitCode, Problem> {
        let reply = self.call(method, params)?;
        Ok(self.report(reply, |_| vec!["ok".to_owned()]))
    }

    /// A call whose success prints one line per item of `result[key]`.
    fn listing(
        &mut self,
        method: &str,
        params: Value,
        key: &str,
        item: impl Fn(&Value) -> String,
    ) -> Result<ExitCode, Problem> {
        let reply = self.call(method, params)?;
        Ok(self.report(reply, |result| {
            let items = result[key]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            items.iter().map(&item).collect()
        }))
    }

    /// cmd.invoke, then the `cmd.answered` of this invocation (other events pass by); a failed
    /// cmd.invoke as it came.
    pub(crate) fn invoke_and_wait(
        &mut self,
        id: &str,
        args: Option<Map<String, Value>>,
    ) -> Result<Reply, Problem> {
        let mut params = json!({ "id": id, "scope": invoke(&[id]) });
        if let Some(args) = args {
            params["args"] = Value::Object(args);
        }
        let reply = self.call("cmd.invoke", params)?;
        let invocation = match &reply.result {
            Ok(result) => match result["invocationId"].as_str() {
                Some(invocation) => invocation.to_owned(),
                None => return Err(Problem::Request("cmd.invoke: no invocationId".to_owned())),
            },
            Err(_) => return Ok(reply),
        };
        loop {
            let (event, line) = self.client.next_event_line().map_err(|why| {
                if why.kind() == io::ErrorKind::UnexpectedEof {
                    Problem::Closed(id.to_owned())
                } else {
                    Problem::Io(why)
                }
            })?;
            let BridgeEvent::CmdAnswered(answered) = event else {
                continue;
            };
            if answered.data.invocation_id != invocation {
                continue;
            }
            let data = answered.data;
            let result = match data.error {
                Some(failure) if !data.ok => {
                    Err((name(serde_json::to_value(failure.code)), failure.message))
                }
                None if !data.ok => Err(("failed".to_owned(), String::new())),
                _ => Ok(data.result.unwrap_or(Value::Null)),
            };
            return Ok(Reply { result, line });
        }
    }

    pub(crate) fn call(&mut self, method: &str, params: Value) -> Result<Reply, Problem> {
        self.next += 1;
        let request: BridgeRequest =
            serde_json::from_value(json!({ "id": self.next, "method": method, "params": params }))
                .map_err(|why| Problem::Request(format!("{method}: {why}")))?;
        let (answer, line) = self.client.call_line(request)?;
        let result = match answer {
            BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
            BridgeResponse::BridgeFailure(failure) => Err((
                name(serde_json::to_value(failure.error.code)),
                failure.error.message,
            )),
        };
        Ok(Reply { result, line })
    }

    /// Print the reply: the line as it came with `--json`, otherwise `lines(result)` on stdout or
    /// `desk: <code>: <message>` on stderr. Exit 1 when it failed.
    pub(crate) fn report(
        &self,
        reply: Reply,
        lines: impl FnOnce(&Value) -> Vec<String>,
    ) -> ExitCode {
        if self.json {
            out(&reply.line);
        }
        match reply.result {
            Ok(result) => {
                if !self.json {
                    lines(&result).iter().for_each(|line| out(line));
                }
                ExitCode::SUCCESS
            }
            Err((code, message)) => {
                if !self.json {
                    eprintln!("desk: {code}: {message}");
                }
                ExitCode::from(1)
            }
        }
    }
}

/// The runtime's describe command (`desk describe`).
const DESCRIBE: &str = "desk.describe.open";

fn invoke(ids: &[&str]) -> Value {
    json!({ "permission": "cmd:invoke", "ids": ids })
}

pub(crate) fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

/// A code's wire name, such as `permission_denied` or `cancelled`.
fn name(code: serde_json::Result<Value>) -> String {
    code.ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn out(line: &str) {
    let _ = writeln!(io::stdout().lock(), "{line}");
}

fn unreachable(path: &Path, why: &io::Error) -> String {
    match why.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused => {
            format!("no desk at {} (is endue Desk running?)", path.display())
        }
        io::ErrorKind::Unsupported => why.to_string(),
        _ => format!("cannot reach the desk at {}: {why}", path.display()),
    }
}

/// A failure no desk answered, exit 1 (`say`).
fn fail(json: bool, code: &str, message: &str) -> ExitCode {
    say(json, code, message);
    ExitCode::from(1)
}

/// A failure no desk answered: `desk: <message>` on stderr, or with `--json` the line a desk's
/// failure has, without an id, on stdout: `{"ok":false,"error":{"code","message"}}`.
fn say(json: bool, code: &str, message: &str) {
    if json {
        let line = json!({ "ok": false, "error": { "code": code, "message": message } });
        out(&line.to_string());
    } else {
        eprintln!("desk: {message}");
    }
}
