//! The command line, matched by hand (no parser dependency). `--json` may stand anywhere. Words
//! that are no action say why (`usage::Wrong`): the value that is wrong, or where they stop fitting.

use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::usage::{self, Wrong};

mod forms;

use forms::{CHANNELS, KINDS, carry, cmd_run, fs, mcp, name, number, one_of, theme};

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
    /// `plugin list --lock`: `~/.desk/plugins.lock` from disk.
    Lock,
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
        /// `--timeout`: the seconds to wait for the answer at most.
        timeout: Option<u64>,
    },
    PluginList,
    /// `plugin sync`: on and off as `~/.desk/plugins.lock` says (ADR 0079).
    PluginSync,
    /// `market list` and `market install <id> [--accept]` (ADR 0107).
    MarketList,
    MarketInstall {
        id: String,
        accept: bool,
    },
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
    /// update.setChannel: stable, beta or canary.
    Channel(&'static str),
}

/// What `desk theme` asks of the desk.
pub enum ThemeStep {
    List,
    Apply(String),
    Import(PathBuf),
    Export { id: String, file: Option<PathBuf> },
    Remove(String),
}

/// The action the arguments ask for, or what was wrong with them.
pub fn parse(args: Vec<String>) -> Result<Args, Wrong> {
    let json = args.iter().any(|arg| arg == "--json");
    let words: Vec<&str> = args
        .iter()
        .map(String::as_str)
        .filter(|arg| *arg != "--json")
        .collect();
    let message = match action(&words) {
        Ok(action) => return Ok(Args { action, json }),
        Err(Miss::Wrong(message)) => message,
        Err(Miss::Unmatched) => unmatched(&words),
    };
    let command = words.first().filter(|word| usage::knows(word));
    Err(Wrong {
        message,
        command: command.map(|word| (*word).to_owned()),
    })
}

/// Why words are no action: no form of any command matches them, or one does and a value in it is
/// wrong (that sentence).
enum Miss {
    Unmatched,
    Wrong(String),
}

impl From<String> for Miss {
    fn from(message: String) -> Self {
        Self::Wrong(message)
    }
}

type Parsed<T> = Result<T, Miss>;

fn action(words: &[&str]) -> Parsed<Action> {
    Ok(match words {
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
            let (with_data, data) = carry("export", rest)?;
            Action::Export {
                target: PathBuf::from(target),
                with_data,
                data,
            }
        }
        ["import", source, rest @ ..] => {
            let (with_data, data) = carry("import", rest)?;
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
        ["plugin", "list", "--lock"] => Action::Lock,
        ["plugin", "sync"] => Action::Remote(Remote::PluginSync),
        ["market", "list"] => Action::Remote(Remote::MarketList),
        ["market", "install", id] => Action::Remote(Remote::MarketInstall {
            id: name(id)?,
            accept: false,
        }),
        ["market", "install", id, "--accept"] => Action::Remote(Remote::MarketInstall {
            id: name(id)?,
            accept: true,
        }),
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
        ["update", "channel", channel] => Action::Remote(Remote::Update(UpdateStep::Channel(
            one_of(&CHANNELS, channel, "channel")?,
        ))),
        ["describe", kind, thing] => Action::Remote(Remote::Describe {
            kind: one_of(&KINDS, kind, "kind describe knows")?,
            name: name(thing)?,
        }),
        ["theme", rest @ ..] => Action::Remote(Remote::Theme(theme(rest)?)),
        ["fs", rest @ ..] => Action::Remote(Remote::Fs(fs(rest)?)),
        ["log"] => Action::Remote(Remote::Log { count: None }),
        ["undo"] => Action::Remote(Remote::Undo { redo: false }),
        ["redo"] => Action::Remote(Remote::Undo { redo: true }),
        ["log", "--count", count] => Action::Remote(Remote::Log {
            count: Some(number("--count", count)?),
        }),
        ["inspect"] => Action::Remote(Remote::Inspect { section: None }),
        ["inspect", section] => Action::Remote(Remote::Inspect {
            section: Some(one_of(&SECTIONS, section, "section")?),
        }),
        _ => return Err(Miss::Unmatched),
    })
}

/// What is wrong with words no form matches: an unknown command, a flag with no value at the end,
/// the first word past the longest start that is a whole command, or that they stop short.
fn unmatched(words: &[&str]) -> String {
    let Some(first) = words.first() else {
        return String::new();
    };
    if !usage::knows(first) {
        return format!("no command '{first}'");
    }
    let whole = (1..words.len())
        .rev()
        .find(|&k| action(&words[..k]).is_ok());
    match whole {
        Some(k) if k + 1 == words.len() && usage::takes_value(words[k]) => {
            format!("{} needs a value", words[k])
        }
        Some(k) => format!(
            "'{}' is not expected after 'desk {}'",
            words[k],
            words[..k].join(" ")
        ),
        None => format!("'desk {}' is not complete", words.join(" ")),
    }
}

/// The inspector's sections, in its order (`plugins/inspector/ui/sections.js`).
pub const SECTIONS: [&str; 7] = [
    "tree", "surfaces", "commands", "grants", "settings", "plugins", "calls",
];
