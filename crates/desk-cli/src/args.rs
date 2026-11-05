//! The command line, matched by hand (no parser dependency). `--json` may stand anywhere.

use std::path::PathBuf;

use serde_json::{Map, Value};

pub const USAGE: &str = "usage: desk [--json] <command>
  plugin validate <dir>                 check a plugin folder against specs/plugin v0
  plugin test <dir>                     run a plugin folder's tests on the host for its kind
  ping                                  a round trip to the running desk
  cmd list                              the commands the desk has: id, provider, title
  cmd run <id> [--args <json object>]   run a command and print its result
  cmd tools [<words>]                   the commands agents get as tools: id, provider, reads or acts
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
  doctor [--data <dir>]                 offline: quarantined plugins, .broken state files, crash
                                        reports, and every desk and data file with its owner, size, state
  doctor --last-crash [--data <dir>]    the newest crash report (--json: the file as it is)
  export <dir|file.zip> [--with-data]   copy the desk folder (and the safe data files) with desk.json
  import <dir|file.zip> [--with-data]   restore an export into this HOME; keeps an existing init.yaml
  fs history <path> [--limit <n>]       the versions the desk kept of a file: id, at, caller, size
  fs restore <path> <version>           write a kept version back (what it replaces is kept too)
  log [--count <n>]                     the desk's log, oldest first: at, level, channel, message
  undo | redo                           the desk's undo stack: what was undone or redone, if anything
  doctor --trace <file>                 summarize a start-up trace (DESK_TRACE=1): phases, totals,
                                        the five longest
  mcp [--agent <id>] [--plugin <id>]... serve the running desk to another app over MCP on stdin and
                                        stdout, as the agent <id> (mcp); each --plugin (or *) gives
                                        that plugin's commands tools of their own
--json prints the desk's answer line as it is. Exit codes: 0 ok, 1 failed, 2 usage.";

pub struct Args {
    pub action: Action,
    pub json: bool,
}

pub enum Action {
    Help,
    Validate(PathBuf),
    /// Offline: what the data folder says went wrong (`--data` names another one).
    Doctor(Option<PathBuf>),
    /// `doctor --last-crash`: the newest crash report in the data folder (#322).
    LastCrash(Option<PathBuf>),
    /// `plugin test <dir>`: the folder's tests, on the harness or the SDK's test host.
    Test(PathBuf),
    /// `doctor --trace <file>`: a start-up trace, summarized offline.
    Trace(PathBuf),
    /// `export <dir|file.zip>`: the desk folder, and with `with_data` the data files, as files.
    Export {
        target: PathBuf,
        with_data: bool,
        data: Option<PathBuf>,
    },
    /// `import <dir|file.zip>`: an export restored into this HOME.
    Import {
        source: PathBuf,
        with_data: bool,
        data: Option<PathBuf>,
    },
    /// `mcp`: an MCP server on stdin and stdout for another app, as an agent (ADR 0086).
    Mcp {
        agent: Option<String>,
        plugins: Vec<String>,
    },
    Remote(Remote),
}

/// A subcommand the running desk answers over its socket.
pub enum Remote {
    Ping,
    CmdList,
    /// `cmd tools [<words>]`: cmd.tools, narrowed by the words when there are any.
    CmdTools {
        query: Option<String>,
    },
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
    /// A file's kept versions (ADR 0076).
    Fs(FsStep),
    /// log.tail.
    Log {
        count: Option<u64>,
    },
    /// cmd.undo, or cmd.redo (ADR 0077).
    Undo {
        redo: bool,
    },
}

/// What `desk fs` asks of the desk's history of a file.
pub enum FsStep {
    History { path: PathBuf, limit: Option<u64> },
    Restore { path: PathBuf, version: String },
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
        ["doctor"] => Action::Doctor(None),
        ["doctor", "--data", dir] => Action::Doctor(Some(PathBuf::from(name(dir)?))),
        ["doctor", "--last-crash"] => Action::LastCrash(None),
        ["doctor", "--last-crash", "--data", dir] | ["doctor", "--data", dir, "--last-crash"] => {
            Action::LastCrash(Some(PathBuf::from(name(dir)?)))
        }
        ["plugin", "test", dir] => Action::Test(PathBuf::from(dir)),
        ["doctor", "--trace", file] => Action::Trace(PathBuf::from(file)),
        ["export", target, rest @ ..] => {
            let (with_data, data) = carry(rest)?;
            Action::Export {
                target: PathBuf::from(target),
                with_data,
                data,
            }
        }
        ["import", source, rest @ ..] => {
            let (with_data, data) = carry(rest)?;
            Action::Import {
                source: PathBuf::from(source),
                with_data,
                data,
            }
        }
        ["mcp", rest @ ..] => mcp(rest)?,
        ["ping"] => Action::Remote(Remote::Ping),
        ["cmd", "list"] => Action::Remote(Remote::CmdList),
        ["cmd", "tools", words @ ..] => Action::Remote(Remote::CmdTools {
            query: (!words.is_empty()).then(|| words.join(" ")),
        }),
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
        ["fs", rest @ ..] => Action::Remote(Remote::Fs(fs(rest)?)),
        ["log"] => Action::Remote(Remote::Log { count: None }),
        ["undo"] => Action::Remote(Remote::Undo { redo: false }),
        ["redo"] => Action::Remote(Remote::Undo { redo: true }),
        ["log", "--count", count] => Action::Remote(Remote::Log {
            count: Some(number(count)?),
        }),
        ["inspect"] => Action::Remote(Remote::Inspect { section: None }),
        ["inspect", section] => Action::Remote(Remote::Inspect {
            section: Some(SECTIONS.iter().find(|s| *s == section)?),
        }),
        _ => return None,
    };
    Some(Args { action, json })
}

/// `[--with-data] [--data <dir>]` in either order, for export and import.
fn carry(rest: &[&str]) -> Option<(bool, Option<PathBuf>)> {
    let (mut with_data, mut data) = (false, None);
    let mut words = rest.iter();
    while let Some(word) = words.next() {
        match *word {
            "--with-data" if !with_data => with_data = true,
            "--data" if data.is_none() => data = Some(PathBuf::from(name(words.next()?)?)),
            _ => return None,
        }
    }
    Some((with_data, data))
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

/// `fs history <path> [--limit <n>]` (the flag before or after the path) or `fs restore <path>
/// <version>`.
fn fs(rest: &[&str]) -> Option<FsStep> {
    Some(match rest {
        ["history", path] => FsStep::History {
            path: PathBuf::from(name(path)?),
            limit: None,
        },
        ["history", path, "--limit", limit] | ["history", "--limit", limit, path] => {
            FsStep::History {
                path: PathBuf::from(name(path)?),
                limit: Some(number(limit)?),
            }
        }
        ["restore", path, version] => FsStep::Restore {
            path: PathBuf::from(name(path)?),
            version: name(version)?,
        },
        _ => return None,
    })
}

/// `mcp [--agent <id>] [--plugin <id>]...`, the flags in any order; the agent id as Desk names one.
fn mcp(mut rest: &[&str]) -> Option<Action> {
    let mut agent = None;
    let mut plugins = Vec::new();
    while let [flag, value, more @ ..] = rest {
        match *flag {
            "--agent" if agent.is_none() => {
                desk_core::agent_caller(value)?;
                agent = Some((*value).to_owned());
            }
            "--plugin" => plugins.push(name(value)?),
            _ => return None,
        }
        rest = more;
    }
    rest.is_empty().then_some(Action::Mcp { agent, plugins })
}

/// A count of 1 or more.
fn number(word: &str) -> Option<u64> {
    word.parse().ok().filter(|n| *n > 0)
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
