//! The command line, matched by hand (no parser dependency). `--json` may stand anywhere.

use std::path::PathBuf;

use serde_json::{Map, Value};

pub const USAGE: &str = "usage: desk [--json] <command>
  plugin validate <dir>                 check a plugin folder against specs/plugin v0
  plugin test <dir>                     run a plugin folder's tests on the host for its kind
  ping                                  a round trip to the running desk
  cmd list                              the commands the desk has: id, provider, title
  cmd run <id> [--args <json object>]   run a command and print its result
  plugin list                           the installed plugins: id, status, enabled
  plugin enable <id> | disable <id>     turn a plugin on or off
  perm list                             every grant: grantId, caller, permission
  perm revoke <grantId>                 take a grant back
  perm log [--agent <id>]               grants, refusals and agents' calls; one agent's only
  describe key|command|setting|plugin|grant <x>
                                        what it is, where it comes from and who may call it
  inspect [tree|surfaces|commands|grants|settings|plugins|calls]
                                        what the desk holds now, as the inspector's Export JSON
  update                                the desk's updates: state, running build, channel, chosen build
  update check                          read the channel index now and print what came of it
  update download | apply               download the chosen build, or restart into the staged one
  theme list                            the installed themes: id, status, built-in or user, name
  theme apply <id>                      put an installed theme in force
  theme import <file>                   install a .desk-theme file as a user theme; prints its id
  theme export <id> [file]              write a theme as a .desk-theme file (default: in Downloads)
  theme remove <id>                     delete a user theme
  doctor --trace <file>                 summarize a start-up trace (DESK_TRACE=1): phases, totals,
                                        the five longest
--json prints the desk's answer line as it is. Exit codes: 0 ok, 1 failed, 2 usage.";

pub struct Args {
    pub action: Action,
    pub json: bool,
}

pub enum Action {
    Help,
    Validate(PathBuf),
    /// `plugin test <dir>`: the folder's tests, on the harness or the SDK's test host.
    Test(PathBuf),
    /// `doctor --trace <file>`: a start-up trace, summarized offline.
    Trace(PathBuf),
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
    /// The `perm` log channel, or one agent's entries in it (ADR 0072).
    PermLog {
        agent: Option<String>,
    },
    /// update.status, or update.check, update.download or update.apply.
    Update(UpdateStep),
    /// What a key, command, setting, plugin or grant is: the runtime's desk.describe.open answers.
    Describe {
        kind: &'static str,
        name: String,
    },
    /// The installed themes and the person's own (ADR 0058).
    Theme(ThemeStep),
    /// What the desk holds now, one section or all, as the inspector exports it.
    Inspect {
        section: Option<&'static str>,
    },
}

/// What `desk update` asks of the desk's updater (ADR 0054).
pub enum UpdateStep {
    Status,
    Check,
    Download,
    Apply,
}

/// What `desk theme` asks of the desk.
pub enum ThemeStep {
    List,
    Apply(String),
    Import(PathBuf),
    Export { id: String, file: Option<PathBuf> },
    Remove(String),
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
        ["plugin", "test", dir] => Action::Test(PathBuf::from(dir)),
        ["doctor", "--trace", file] => Action::Trace(PathBuf::from(file)),
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
        ["perm", "log"] => Action::Remote(Remote::PermLog { agent: None }),
        ["perm", "log", "--agent", agent] => Action::Remote(Remote::PermLog {
            agent: Some(name(agent)?),
        }),
        ["update"] => Action::Remote(Remote::Update(UpdateStep::Status)),
        ["update", "check"] => Action::Remote(Remote::Update(UpdateStep::Check)),
        ["update", "download"] => Action::Remote(Remote::Update(UpdateStep::Download)),
        ["update", "apply"] => Action::Remote(Remote::Update(UpdateStep::Apply)),
        ["describe", kind, thing] => Action::Remote(Remote::Describe {
            kind: KINDS.iter().find(|k| *k == kind)?,
            name: name(thing)?,
        }),
        ["theme", rest @ ..] => Action::Remote(Remote::Theme(theme(rest)?)),
        ["inspect"] => Action::Remote(Remote::Inspect { section: None }),
        ["inspect", section] => Action::Remote(Remote::Inspect {
            section: Some(SECTIONS.iter().find(|s| *s == section)?),
        }),
        _ => return None,
    };
    Some(Args { action, json })
}

/// What `desk describe` can name.
const KINDS: [&str; 5] = ["key", "command", "setting", "plugin", "grant"];

/// The inspector's sections, in its order (`plugins/inspector/ui/sections.js`).
pub const SECTIONS: [&str; 7] = [
    "tree", "surfaces", "commands", "grants", "settings", "plugins", "calls",
];

/// `theme list | apply <id> | import <file> | export <id> [file] | remove <id>`.
fn theme(rest: &[&str]) -> Option<ThemeStep> {
    Some(match rest {
        ["list"] => ThemeStep::List,
        ["apply", id] => ThemeStep::Apply(name(id)?),
        ["import", file] => ThemeStep::Import(PathBuf::from(name(file)?)),
        ["export", id] => ThemeStep::Export {
            id: name(id)?,
            file: None,
        },
        ["export", id, file] => ThemeStep::Export {
            id: name(id)?,
            file: Some(PathBuf::from(name(file)?)),
        },
        ["remove", id] => ThemeStep::Remove(name(id)?),
        _ => return None,
    })
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
