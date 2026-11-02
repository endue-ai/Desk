//! The subcommands a running desk answers over its socket (desk-ipc, ADR 0030). The CLI is the
//! caller `cli`: what it may do is what the desk granted it. Exit codes: 0 ok, 1 a bridge error, a
//! failed or cancelled command, or no desk at the socket.

use std::io::{self, Write};
use std::path::Path;
use std::process::ExitCode;

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse};
use desk_ipc::Client;
use serde_json::{Map, Value, json};

use crate::args::{Remote, UpdateStep};

pub fn run(remote: Remote, json: bool) -> ExitCode {
    let Some(path) = desk_ipc::socket_path() else {
        return fail("no data folder to find the desk socket in; set DESK_SOCKET");
    };
    let client = match Client::connect(&path) {
        Ok(client) => client,
        Err(why) => return fail(&unreachable(&path, &why)),
    };
    let mut session = Session {
        client,
        next: 0,
        json,
    };
    session.run(remote).unwrap_or_else(|why| match why {
        Problem::Io(why) => fail(&format!("lost the desk at {}: {why}", path.display())),
        Problem::Request(why) => fail(&why),
    })
}

enum Problem {
    Io(io::Error),
    Request(String),
}

impl From<io::Error> for Problem {
    fn from(why: io::Error) -> Self {
        Self::Io(why)
    }
}

/// What the desk answered, and the answer line as it came.
struct Reply {
    result: Result<Value, (String, String)>,
    line: String,
}

struct Session {
    client: Client,
    next: u64,
    json: bool,
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
            Remote::CmdRun { id, args } => self.cmd_run(&id, args),
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
            Remote::Update(step) => self.update(step),
        }
    }

    /// update.* (ADR 0054), one status line. `check` waits for the `update.changed` that ends the
    /// check, and exits 1 when it failed.
    fn update(&mut self, step: UpdateStep) -> Result<ExitCode, Problem> {
        let method = match step {
            UpdateStep::Status => "update.status",
            UpdateStep::Check => "update.check",
            UpdateStep::Download => "update.download",
            UpdateStep::Apply => "update.apply",
        };
        let reply = self.call(
            method,
            json!({ "scope": { "permission": "update:manage" } }),
        )?;
        let checking = matches!(step, UpdateStep::Check)
            && reply
                .result
                .as_ref()
                .is_ok_and(|s| s["state"] == "checking");
        if !checking {
            return Ok(self.report(reply, |status| vec![update_line(status)]));
        }
        loop {
            let (event, line) = self.client.next_event_line()?;
            let BridgeEvent::UpdateChanged(changed) = event else {
                continue;
            };
            let status = serde_json::to_value(&changed.data).unwrap_or_default();
            if status["state"] == "checking" {
                continue;
            }
            let result = if status["state"] == "failed" {
                Err(("failed".to_owned(), text(&status, "reason").to_owned()))
            } else {
                Ok(status)
            };
            return Ok(self.report(Reply { result, line }, |status| vec![update_line(status)]));
        }
    }

    /// A call whose success prints `ok`.
    fn done(&mut self, method: &str, params: Value) -> Result<ExitCode, Problem> {
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

    /// cmd.invoke, then wait for the `cmd.answered` of this invocation (other events pass by).
    fn cmd_run(&mut self, id: &str, args: Option<Map<String, Value>>) -> Result<ExitCode, Problem> {
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
            Err(_) => return Ok(self.report(reply, |_| Vec::new())),
        };
        loop {
            let (event, line) = self.client.next_event_line()?;
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
            let reply = Reply { result, line };
            return Ok(self.report(reply, |result| match result {
                Value::Null => Vec::new(),
                value => vec![value.to_string()],
            }));
        }
    }

    fn call(&mut self, method: &str, params: Value) -> Result<Reply, Problem> {
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
    fn report(&self, reply: Reply, lines: impl FnOnce(&Value) -> Vec<String>) -> ExitCode {
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

/// `state  running  channel  chosen [percent]`: `staged  0.1.0  stable  0.2.0`.
fn update_line(status: &Value) -> String {
    let chosen = status["release"]["version"].as_str().unwrap_or("-");
    let mut line = format!(
        "{}\t{}\t{}\t{chosen}",
        text(status, "state"),
        text(&status["current"], "version"),
        text(status, "channel")
    );
    if let (Some(received), Some(total)) = (status["received"].as_u64(), status["total"].as_u64())
        && total > 0
    {
        line.push_str(&format!("\t{}%", received * 100 / total));
    }
    line
}

fn invoke(ids: &[&str]) -> Value {
    json!({ "permission": "cmd:invoke", "ids": ids })
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
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

fn fail(message: &str) -> ExitCode {
    eprintln!("desk: {message}");
    ExitCode::from(1)
}
