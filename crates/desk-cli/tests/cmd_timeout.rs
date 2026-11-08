//! `desk cmd run --timeout <seconds>`: the CLI stops waiting for an answer that does not come, and
//! exits 1 saying so; an answer in time prints as before.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// A desk on its own socket that answers each request with the lines `answer` returns.
fn desk(name: &str, answer: fn(&Value) -> Vec<String>) -> PathBuf {
    let socket = format!("dcli-timeout-{}-{name}.sock", std::process::id());
    let path = std::env::temp_dir().join(socket);
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).unwrap();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut writer = stream.try_clone().unwrap();
            for line in BufReader::new(stream).lines() {
                let Ok(line) = line else { break };
                let request: Value = serde_json::from_str(&line).unwrap();
                for line in answer(&request) {
                    let _ = writeln!(writer, "{line}");
                }
            }
        }
    });
    path
}

/// `desk <args>` against `path`, and how long it ran.
fn run(path: &PathBuf, args: &[&str]) -> (Output, Duration) {
    let start = Instant::now();
    let out = Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("DESK_SOCKET", path)
        .output()
        .expect("desk runs");
    (out, start.elapsed())
}

fn invoked(request: &Value) -> String {
    json!({ "id": request["id"], "ok": true, "result": { "invocationId": "i-1" } }).to_string()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn a_command_that_never_answers_ends_at_the_timeout() {
    let path = desk("silent", |r| vec![invoked(r)]);
    let (out, took) = run(&path, &["cmd", "run", "endue.mail.open", "--timeout", "1"]);
    assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    let said = stderr(&out);
    assert!(said.contains("endue.mail.open"), "{said}");
    assert!(said.contains("1 s"), "{said}");
    assert!(out.stdout.is_empty());
    assert!(took >= Duration::from_secs(1), "{took:?}");
    assert!(took < Duration::from_secs(10), "{took:?}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn an_answer_in_time_prints_as_before() {
    let path = desk("answers", |r| {
        let answered = json!({ "event": "cmd.answered", "data": {
            "invocationId": "i-1", "id": "desk.theme.toggle", "caller": "cli",
            "ok": true, "result": "dark"
        } });
        vec![invoked(r), answered.to_string()]
    });
    for args in [
        &["cmd", "run", "desk.theme.toggle", "--timeout", "5"][..],
        &[
            "cmd",
            "run",
            "--timeout",
            "5",
            "desk.theme.toggle",
            "--args",
            "{}",
        ],
        &[
            "cmd",
            "run",
            "desk.theme.toggle",
            "--args",
            "{}",
            "--timeout",
            "5",
        ],
    ] {
        let (out, _) = run(&path, args);
        assert_eq!(out.status.code(), Some(0), "{args:?}: {}", stderr(&out));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            "\"dark\"\n",
            "{args:?}"
        );
    }
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_timeout_is_a_whole_number_of_seconds_given_once() {
    let path = std::env::temp_dir().join("dcli-timeout-usage.sock");
    for args in [
        &["cmd", "run", "x", "--timeout"][..],
        &["cmd", "run", "x", "--timeout", "0"],
        &["cmd", "run", "x", "--timeout", "soon"],
        &["cmd", "run", "x", "--timeout", "1", "--timeout", "2"],
    ] {
        let (out, _) = run(&path, args);
        assert_eq!(out.status.code(), Some(2), "{args:?}: {}", stderr(&out));
        assert!(
            stderr(&out).contains("--timeout"),
            "{args:?}: {}",
            stderr(&out)
        );
    }
}
