//! The forms of the subcommands that take flags or steps (export and import, theme, fs, mcp, cmd
//! run) and the values in them. Each says what is wrong with a value in one sentence.

use std::path::PathBuf;

use serde_json::{Map, Value};

use super::{Action, FsStep, Miss, Parsed, Remote, ThemeStep};

/// What `desk describe` can name.
pub(super) const KINDS: [&str; 5] = ["key", "command", "setting", "plugin", "grant"];

/// The update channels.
pub(super) const CHANNELS: [&str; 3] = ["stable", "beta", "canary"];

/// `[--with-data] [--data <dir>]` in either order, for export and import.
pub(super) fn carry(command: &str, rest: &[&str]) -> Parsed<(bool, Option<PathBuf>)> {
    let (mut with_data, mut data) = (false, None);
    let mut words = rest.iter();
    while let Some(word) = words.next() {
        match *word {
            "--with-data" if with_data => return Err(twice(word)),
            "--with-data" => with_data = true,
            "--data" if data.is_some() => return Err(twice(word)),
            "--data" => {
                let dir = words.next().ok_or("--data needs a folder".to_owned())?;
                data = Some(PathBuf::from(name(dir)?));
            }
            word => {
                let takes = "one folder or .zip, --with-data and --data <dir>";
                return Err(format!("'{word}' is not expected: {command} takes {takes}").into());
            }
        }
    }
    Ok((with_data, data))
}

/// `theme list | apply <id> | import <file> | export <id> [file] | remove <id>`.
pub(super) fn theme(rest: &[&str]) -> Parsed<ThemeStep> {
    Ok(match rest {
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
        _ => return Err(Miss::Unmatched),
    })
}

/// `fs history <path> [--limit <n>]` (the flag before or after the path) or `fs restore <path>
/// <version>`.
pub(super) fn fs(rest: &[&str]) -> Parsed<FsStep> {
    Ok(match rest {
        ["history", path] => FsStep::History {
            path: PathBuf::from(name(path)?),
            limit: None,
        },
        ["history", path, "--limit", limit] | ["history", "--limit", limit, path] => {
            FsStep::History {
                path: PathBuf::from(name(path)?),
                limit: Some(number("--limit", limit)?),
            }
        }
        ["restore", path, version] => FsStep::Restore {
            path: PathBuf::from(name(path)?),
            version: name(version)?,
        },
        _ => return Err(Miss::Unmatched),
    })
}

/// `mcp [--agent <id>] [--plugin <id>]...`, the flags in any order; the agent id as Desk names one.
pub(super) fn mcp(mut rest: &[&str]) -> Parsed<Action> {
    let mut agent = None;
    let mut plugins = Vec::new();
    while let [flag, more @ ..] = rest {
        let (value, more) = match (*flag, more) {
            ("--agent" | "--plugin", [value, more @ ..]) => (*value, more),
            ("--agent", []) => return Err("--agent needs an agent id".to_owned().into()),
            ("--plugin", []) => return Err("--plugin needs a plugin id or *".to_owned().into()),
            (word, _) => {
                let takes = "desk mcp takes --agent <id> and --plugin <id>";
                return Err(format!("'{word}' is not expected: {takes}").into());
            }
        };
        match *flag {
            "--agent" if agent.is_some() => return Err(twice(flag)),
            "--agent" if desk_core::agent_caller(value).is_none() => {
                return Err(format!("--agent: '{value}' is not an agent id").into());
            }
            "--agent" => agent = Some(value.to_owned()),
            _ => plugins.push(name(value)?),
        }
        rest = more;
    }
    Ok(Action::Mcp { agent, plugins })
}

/// `cmd run <id> [--args <json object>] [--timeout <seconds>]`, each flag once, before or after the id.
pub(super) fn cmd_run(mut rest: &[&str]) -> Parsed<Remote> {
    let (mut id, mut args, mut timeout) = (None, None, None);
    while let [word, more @ ..] = rest {
        rest = match (*word, more) {
            ("--args", []) => return Err("--args needs a JSON object".to_owned().into()),
            ("--timeout", []) => {
                return Err("--timeout needs a number of seconds".to_owned().into());
            }
            ("--args", _) if args.is_some() => return Err(twice(word)),
            ("--timeout", _) if timeout.is_some() => return Err(twice(word)),
            ("--args", [value, more @ ..]) => {
                args = Some(object(value)?);
                more
            }
            ("--timeout", [value, more @ ..]) => {
                timeout = Some(number("--timeout", value)?);
                more
            }
            (word, more) if id.is_none() => {
                id = Some(name(word)?);
                more
            }
            (word, _) => {
                let takes = "cmd run takes one command id";
                return Err(format!("'{word}' is not expected: {takes}").into());
            }
        };
    }
    let id = id.ok_or("cmd run needs a command id".to_owned())?;
    Ok(Remote::CmdRun { id, args, timeout })
}

/// `word` as one of `known`, or a sentence that lists them.
pub(super) fn one_of(
    known: &[&'static str],
    word: &str,
    what: &str,
) -> Result<&'static str, String> {
    let found = known.iter().find(|k| **k == word).copied();
    found.ok_or_else(|| format!("'{word}' is not a {what}: {}", known.join(", ")))
}

/// A count of 1 or more, given to `flag`.
pub(super) fn number(flag: &str, word: &str) -> Result<u64, String> {
    let number = word.parse().ok().filter(|n| *n > 0);
    number.ok_or_else(|| format!("{flag} takes a whole number, 1 or more, not '{word}'"))
}

/// An id, a path or a grant id: anything but a flag.
pub(super) fn name(word: &str) -> Result<String, String> {
    if word.is_empty() {
        return Err("an empty word stands where a name or a path belongs".to_owned());
    }
    if word.starts_with('-') {
        return Err(format!("'{word}' stands where a name or a path belongs"));
    }
    Ok(word.to_owned())
}

/// `--args`: a JSON object, or what the text is instead.
fn object(text: &str) -> Result<Map<String, Value>, String> {
    let other = match serde_json::from_str(text) {
        Ok(Value::Object(map)) => return Ok(map),
        Ok(Value::Array(_)) => "an array",
        Ok(Value::String(_)) => "a string",
        Ok(Value::Number(_)) => "a number",
        Ok(Value::Bool(_)) => "true or false",
        Ok(Value::Null) => "null",
        Err(why) => {
            return Err(format!(
                "--args is not JSON ({why}); it takes a JSON object"
            ));
        }
    };
    Err(format!("--args takes a JSON object, not {other}"))
}

fn twice(flag: &str) -> Miss {
    Miss::Wrong(format!("{flag} is given twice"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrong<T>(parsed: Parsed<T>) -> String {
        match parsed {
            Err(Miss::Wrong(message)) => message,
            Err(Miss::Unmatched) => "unmatched".to_owned(),
            Ok(_) => "ok".to_owned(),
        }
    }

    #[test]
    fn a_wrong_value_says_what_it_is() {
        let run = |words: &[&str]| wrong(cmd_run(words));
        assert_eq!(
            run(&["x", "--args", "[1,2]"]),
            "--args takes a JSON object, not an array"
        );
        assert!(run(&["x", "--args", "not json"]).starts_with("--args is not JSON ("));
        assert_eq!(
            run(&["x", "--timeout", "0"]),
            "--timeout takes a whole number, 1 or more, not '0'"
        );
        assert_eq!(
            run(&["x", "--timeout", "1", "--timeout", "2"]),
            "--timeout is given twice"
        );
        assert_eq!(
            run(&["x", "y"]),
            "'y' is not expected: cmd run takes one command id"
        );
        assert_eq!(run(&["--timeout", "3"]), "cmd run needs a command id");
        assert_eq!(
            wrong(fs(&["history", "a.md", "--limit", "0"])),
            "--limit takes a whole number, 1 or more, not '0'"
        );
        assert_eq!(
            wrong(mcp(&["--agent", "has space"])),
            "--agent: 'has space' is not an agent id"
        );
        assert_eq!(wrong(carry("export", &["--data"])), "--data needs a folder");
    }
}
