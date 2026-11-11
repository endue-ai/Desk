//! What `desk --help` prints, and what a command line `desk` cannot run prints: what was wrong with
//! it, then only the usage lines of the command it was about (#163).

pub const USAGE: &str = "usage: desk [--json] <command>
  plugin validate <dir>                 check a plugin folder against specs/plugin v0
  plugin test <dir>                     run a plugin folder's tests on the host for its kind
  ping                                  a round trip to the running desk
  cmd list                              the commands the desk has: id, provider, title
  cmd run <id> [--args <json object>] [--timeout <seconds>]
                                        run a command and print its result; with --timeout, stop
                                        waiting for it after that many seconds and exit 1
  cmd tools [<words>]                   the commands agents get as tools: id, provider, reads or acts
  plugin list                           the installed plugins: id, status, enabled
  plugin list --lock                    ~/.desk/plugins.lock as it is (no desk needed)
  plugin sync                           turn plugins on and off as plugins.lock says; report the
                                        ones it names that are not installed
  market list                           what the markets offer: kind, id, version, state, verified
  market install <id> [--accept]        install from a market; --accept takes the permissions it asks
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
  update channel <stable|beta|canary>   follow another channel from the next check on
  theme list                            the installed themes and design systems: id, kind, status,
                                        where from (built-in, user, pack or dev), name; theme
                                        remove deletes a user one
  theme apply <id>                      put an installed theme or design system in force
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
--json prints the desk's answer line as it is; when none came, {\"ok\":false,\"error\":{code,message}}.
Exit codes: 0 ok, 1 failed, 2 usage.";

/// A command line `desk` cannot run.
pub struct Wrong {
    /// What was wrong, in one sentence; empty when no command was given at all.
    pub message: String,
    /// The first word, when it names a command: its usage lines follow the message.
    pub command: Option<String>,
}

/// What a usage error prints on stderr: all of USAGE when no command was given, otherwise
/// `desk: <what was wrong>`, the usage header and the lines of the command it was about.
pub fn wrong(wrong: &Wrong) -> String {
    if wrong.message.is_empty() {
        return format!("{USAGE}\n");
    }
    let mut text = format!("desk: {}\n", wrong.message);
    let mut lines = USAGE.lines();
    if let Some(header) = lines.next() {
        text.push_str(header);
        text.push('\n');
    }
    if let Some(command) = &wrong.command {
        let mut within = false;
        for line in lines {
            within = match indent(line) {
                2 => names(line, command),
                0 => false,
                _ => within,
            };
            if within {
                text.push_str(line);
                text.push('\n');
            }
        }
    }
    text.push_str("desk --help lists every command.\n");
    text
}

/// Whether `word` is the first word of a command (`redo` too, which shares a line with `undo`).
pub fn knows(word: &str) -> bool {
    USAGE
        .lines()
        .skip(1)
        .any(|line| indent(line) == 2 && names(line, word))
}

/// Whether some command's usage gives `flag` a value (`--data <dir>`).
pub fn takes_value(flag: &str) -> bool {
    USAGE.contains(&format!("{flag} <"))
}

/// Whether the usage line `line` is for the command `word`: its synopsis starts with it, or is
/// `<other> | <word>`.
fn names(line: &str, word: &str) -> bool {
    let synopsis = line.trim_start().split("  ").next().unwrap_or_default();
    let words: Vec<&str> = synopsis.split_whitespace().collect();
    words.first() == Some(&word) || (words.get(1) == Some(&"|") && words.get(2) == Some(&word))
}

fn indent(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wrong_for(command: &str) -> String {
        wrong(&Wrong {
            message: "it was wrong".to_owned(),
            command: Some(command.to_owned()),
        })
    }

    #[test]
    fn a_usage_error_shows_the_lines_of_its_command_only() {
        let text = wrong_for("cmd");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "desk: it was wrong");
        assert_eq!(lines[1], "usage: desk [--json] <command>");
        assert!(lines[2].starts_with("  cmd list "), "{text}");
        assert!(lines[3].starts_with("  cmd run <id> "), "{text}");
        assert!(lines[4].trim_start().starts_with("run a command"), "{text}");
        assert!(lines[6].starts_with("  cmd tools "), "{text}");
        assert_eq!(lines[7], "desk --help lists every command.");
        assert_eq!(lines.len(), 8, "{text}");
    }

    #[test]
    fn redo_is_known_by_the_line_it_shares_with_undo() {
        assert!(knows("redo") && knows("undo") && knows("ping") && knows("mcp"));
        assert!(!knows("nope") && !knows("disable") && !knows("--data"));
        assert!(wrong_for("redo").contains("  undo | redo "));
    }

    #[test]
    fn the_json_note_is_not_a_command_line() {
        assert!(!wrong_for("doctor").contains("--json prints"));
        assert!(wrong_for("doctor").contains("  doctor --trace <file> "));
        assert!(takes_value("--data") && takes_value("--trace") && !takes_value("--lock"));
    }
}
