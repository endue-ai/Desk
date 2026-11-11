//! A command line `desk` cannot run says what was wrong in its first line, then only the usage
//! lines of the command it was about, and exits 2 (#163). No desk is needed: nothing is sent.

use std::process::{Command, Output};

fn desk(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env(
            "DESK_SOCKET",
            std::env::temp_dir().join("dcli-usage-none.sock"),
        )
        .output()
        .expect("desk runs")
}

/// Exit 2, nothing on stdout, and stderr as its lines.
fn usage(args: &[&str]) -> Vec<String> {
    let out = desk(args);
    let said = String::from_utf8_lossy(&out.stderr).into_owned();
    assert_eq!(out.status.code(), Some(2), "{args:?}: {said}");
    assert!(out.stdout.is_empty(), "{args:?}");
    said.lines().map(str::to_owned).collect()
}

#[test]
fn a_bad_value_says_what_was_wrong_and_shows_its_command_only() {
    for (args, first, command) in [
        (
            &["cmd", "run", "x", "--args", "not json"][..],
            "desk: --args is not JSON (",
            "  cmd run <id> ",
        ),
        (
            &["cmd", "run", "x", "--args", "[1,2]"],
            "desk: --args takes a JSON object, not an array",
            "  cmd run <id> ",
        ),
        (
            &["cmd", "run", "x", "--timeout", "0"],
            "desk: --timeout takes a whole number, 1 or more, not '0'",
            "  cmd run <id> ",
        ),
        (
            &["cmd", "run", "x", "--timeout", "abc"],
            "desk: --timeout takes a whole number, 1 or more, not 'abc'",
            "  cmd run <id> ",
        ),
        (
            &["log", "--count", "0"],
            "desk: --count takes a whole number, 1 or more, not '0'",
            "  log [--count <n>] ",
        ),
        (
            &["fs", "history", "notes/a.md", "--limit", "0"],
            "desk: --limit takes a whole number, 1 or more, not '0'",
            "  fs history <path> ",
        ),
        (
            &["ping", "extra"],
            "desk: 'extra' is not expected after 'desk ping'",
            "  ping ",
        ),
    ] {
        let lines = usage(args);
        assert!(lines[0].starts_with(first), "{args:?}: {lines:#?}");
        assert_eq!(lines[1], "usage: desk [--json] <command>", "{args:?}");
        assert!(
            lines.iter().any(|line| line.starts_with(command)),
            "{args:?}: {lines:#?}"
        );
        assert!(
            lines.len() <= 10,
            "{args:?}: not the whole usage: {lines:#?}"
        );
        assert_eq!(
            lines.last().map(String::as_str),
            Some("desk --help lists every command.")
        );
    }
}

#[test]
fn words_that_stop_short_or_name_no_command_say_so() {
    let lines = usage(&["plugin", "enable"]);
    assert_eq!(lines[0], "desk: 'desk plugin enable' is not complete");
    assert!(lines.iter().any(|l| l.starts_with("  plugin enable <id> ")));
    assert!(
        !lines.iter().any(|l| l.starts_with("  ping ")),
        "{lines:#?}"
    );

    assert_eq!(
        usage(&["doctor", "--trace"])[0],
        "desk: --trace needs a value"
    );
    assert_eq!(
        usage(&["update", "channel", "nightly"])[0],
        "desk: 'nightly' is not a channel: stable, beta, canary"
    );
    assert_eq!(
        usage(&["redo", "now"])[0],
        "desk: 'now' is not expected after 'desk redo'"
    );

    let lines = usage(&["nope"]);
    assert_eq!(lines[0], "desk: no command 'nope'");
    assert_eq!(lines.len(), 3, "{lines:#?}");
}

#[test]
fn no_command_at_all_prints_the_whole_usage() {
    let lines = usage(&[]);
    assert_eq!(lines[0], "usage: desk [--json] <command>");
    assert!(lines.len() > 40, "{}", lines.len());
    let help = desk(&["--help"]);
    assert_eq!(help.status.code(), Some(0));
    assert_eq!(
        String::from_utf8_lossy(&help.stdout).lines().count(),
        lines.len()
    );
}
