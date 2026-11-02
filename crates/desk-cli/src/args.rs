//! The command line, matched by hand (no parser dependency). `--json` may stand anywhere.

use std::path::PathBuf;

use serde_json::{Map, Value};

pub const USAGE: &str = "usage: desk [--json] <command>
  plugin validate <dir>                 check a plugin folder against specs/plugin v0
  ping                                  a round trip to the running desk
  cmd list                              the commands the desk has: id, provider, title
  cmd run <id> [--args <json object>]   run a command and print its result
  plugin list                           the installed plugins: id, status, enabled
  plugin enable <id> | disable <id>     turn a plugin on or off
  perm list                             every grant: grantId, caller, permission
  perm revoke <grantId>                 take a grant back
  update                                the desk's updates: state, running build, channel, chosen build
  update check                          read the channel index now and print what came of it
  update download | apply               download the chosen build, or restart into the staged one
--json prints the desk's answer line as it is. Exit codes: 0 ok, 1 failed, 2 usage.";

pub struct Args {
    pub action: Action,
    pub json: bool,
}

pub enum Action {
    Help,
    Validate(PathBuf),
    Remote(Remote),
}

/// A subcommand the running desk answers over its socket.
pub enum Remote {
    Ping,
    CmdList,
    CmdRun {
        id: String,
        args: Option<Map<String, Value>>,
    },
    PluginList,
    PluginSetEnabled {
        id: String,
        enabled: bool,
    },
    PermList,
    PermRevoke {
        grant_id: String,
    },
    /// update.status, or update.check, update.download or update.apply.
    Update(UpdateStep),
}

/// What `desk update` asks of the desk's updater (ADR 0054).
pub enum UpdateStep {
    Status,
    Check,
    Download,
    Apply,
}

/// The action the arguments ask for, or `None` for a usage error.
pub fn parse(args: Vec<String>) -> Option<Args> {
    let json = args.iter().any(|arg| arg == "--json");
    let words: Vec<&str> = args
        .iter()
        .map(String::as_str)
        .filter(|arg| *arg != "--json")
        .collect();
    let action = match words.as_slice() {
        ["--help" | "-h" | "help"] => Action::Help,
        ["plugin", "validate", dir] => Action::Validate(PathBuf::from(dir)),
        ["ping"] => Action::Remote(Remote::Ping),
        ["cmd", "list"] => Action::Remote(Remote::CmdList),
        ["cmd", "run", rest @ ..] => Action::Remote(cmd_run(rest)?),
        ["plugin", "list"] => Action::Remote(Remote::PluginList),
        ["plugin", toggle @ ("enable" | "disable"), id] => {
            Action::Remote(Remote::PluginSetEnabled {
                id: name(id)?,
                enabled: *toggle == "enable",
            })
        }
        ["perm", "list"] => Action::Remote(Remote::PermList),
        ["perm", "revoke", grant] => Action::Remote(Remote::PermRevoke {
            grant_id: name(grant)?,
        }),
        ["update"] => Action::Remote(Remote::Update(UpdateStep::Status)),
        ["update", "check"] => Action::Remote(Remote::Update(UpdateStep::Check)),
        ["update", "download"] => Action::Remote(Remote::Update(UpdateStep::Download)),
        ["update", "apply"] => Action::Remote(Remote::Update(UpdateStep::Apply)),
        _ => return None,
    };
    Some(Args { action, json })
}

/// `cmd run <id> [--args <json object>]`, with `--args` before or after the id.
fn cmd_run(rest: &[&str]) -> Option<Remote> {
    let (id, args) = match rest {
        [id] => (id, None),
        [id, "--args", args] | ["--args", args, id] => (id, Some(object(args)?)),
        _ => return None,
    };
    Some(Remote::CmdRun {
        id: name(id)?,
        args,
    })
}

fn object(text: &str) -> Option<Map<String, Value>> {
    match serde_json::from_str(text) {
        Ok(Value::Object(map)) => Some(map),
        _ => None,
    }
}

/// An id or a grant id: anything but a flag.
fn name(word: &str) -> Option<String> {
    (!word.is_empty() && !word.starts_with('-')).then(|| word.to_owned())
}
