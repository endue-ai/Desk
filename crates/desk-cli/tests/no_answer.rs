//! What the CLI says when no answer comes from the desk (#163): with `--json` its own failure is a
//! JSON line too, and a command that starts the desk again (`desk.start.normally`, whose desk exits
//! before it can answer) is no lost desk when a desk answers at the socket again.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

fn socket(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("dcli-gone-{}-{name}.sock", std::process::id()));
    let _ = std::fs::remove_file(&path);
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

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// The first request on `stream`, answered with `result`.
fn answer_one(stream: &UnixStream, result: Value) -> Value {
    let mut line = String::new();
    BufReader::new(stream.try_clone().unwrap())
        .read_line(&mut line)
        .unwrap();
    let request: Value = serde_json::from_str(&line).unwrap();
    let answer = json!({ "id": request["id"], "ok": true, "result": result });
    writeln!(&*stream, "{answer}").unwrap();
    request
}

/// A desk that takes cmd.invoke and then exits before the command answers, as desk.start.normally
/// makes it do; with `again`, a new desk answers on the same socket afterwards.
fn exits_on_invoke(path: &PathBuf, again: bool) -> std::thread::JoinHandle<Vec<Value>> {
    let listener = UnixListener::bind(path).unwrap();
    let path = path.clone();
    std::thread::spawn(move || {
        let (first, _) = listener.accept().unwrap();
        let invoked = answer_one(&first, json!({ "invocationId": "i-1" }));
        drop(first);
        if !again {
            drop(listener);
            let _ = std::fs::remove_file(&path);
            return vec![invoked];
        }
        let (second, _) = listener.accept().unwrap();
        let ping = answer_one(&second, json!({ "profile": "default", "settings": {} }));
        vec![invoked, ping]
    })
}

#[test]
fn with_json_no_desk_is_a_json_line_on_stdout() {
    let path = socket("none");
    let (out, _) = run(&path, &["--json", "ping"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stderr.is_empty(), "{}", text(&out.stderr));
    let line: Value = serde_json::from_str(text(&out.stdout).trim()).unwrap();
    assert_eq!(line["ok"], false);
    assert_eq!(line["error"]["code"], "no_desk");
    let message = line["error"]["message"].as_str().unwrap();
    assert!(message.contains(path.to_str().unwrap()), "{message}");
}

#[test]
fn a_command_that_starts_the_desk_again_exits_0_once_a_desk_answers_again() {
    let path = socket("again");
    let desk = exits_on_invoke(&path, true);
    let (out, _) = run(&path, &["cmd", "run", "desk.start.normally"]);
    let said = text(&out.stderr);
    assert_eq!(out.status.code(), Some(0), "{said}");
    assert!(out.stdout.is_empty(), "{}", text(&out.stdout));
    assert!(said.contains("desk.start.normally"), "{said}");
    assert!(said.contains("started again"), "{said}");
    let requests = desk.join().unwrap();
    assert_eq!(requests[0]["method"], "cmd.invoke");
    assert_eq!(
        requests[1]["method"], "init.get",
        "the new desk answered a round trip"
    );
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_desk_that_closes_and_does_not_come_back_is_lost() {
    let path = socket("lost");
    let desk = exits_on_invoke(&path, false);
    let (out, took) = run(&path, &["cmd", "run", "desk.start.normally"]);
    let said = text(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{said}");
    assert!(said.contains("lost the desk"), "{said}");
    assert!(said.contains("while desk.start.normally ran"), "{said}");
    assert!(
        took < Duration::from_secs(5),
        "a removed socket ends the wait: {took:?}"
    );
    desk.join().unwrap();

    let desk = exits_on_invoke(&path, false);
    let (out, _) = run(&path, &["--json", "cmd", "run", "desk.start.normally"]);
    assert_eq!(out.status.code(), Some(1));
    let line: Value = serde_json::from_str(text(&out.stdout).trim()).unwrap();
    assert_eq!(line["ok"], false);
    assert_eq!(line["error"]["code"], "io_error");
    desk.join().unwrap();
}
