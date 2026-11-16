//! Closing a process's stdin (ADR 0248): a program that reads to the end of its input, like
//! `git apply -`, sees the end once the writer closes it, a later write fails, and a PTY has no
//! stdin of its own to close.
//!
//! The child program is this test binary again, as in `tests/proc.rs`.
#![cfg(feature = "proc")]

use std::collections::BTreeMap;
use std::io::{Read as _, Write as _};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

use desk_sys::ErrorCode;
use desk_sys::proc::{Event, Exit, Process, PtySize, SpawnOptions, spawn};

const ROLE: &str = "DESK_SYS_TEST_CHILD";
const WAIT: Duration = Duration::from_secs(30);

/// The child program: `cat` reads stdin to its end and prints it back.
#[test]
fn child() {
    let Ok(role) = std::env::var(ROLE) else {
        return;
    };
    let code = match role.as_str() {
        "cat" => {
            let mut all = String::new();
            std::io::stdin().read_to_string(&mut all).unwrap();
            println!("got:{all}:end");
            0
        }
        "sleep" => {
            println!("ready");
            std::io::stdout().flush().unwrap();
            std::thread::sleep(Duration::from_secs(60));
            0
        }
        other => panic!("unknown role {other}"),
    };
    std::io::stdout().flush().unwrap();
    std::process::exit(code);
}

fn options(role: &str) -> SpawnOptions {
    SpawnOptions {
        program: std::env::current_exe().unwrap().display().to_string(),
        args: ["--exact", "child", "--nocapture", "--test-threads=1"]
            .map(String::from)
            .to_vec(),
        env: BTreeMap::from([(ROLE.to_owned(), role.to_owned())]),
        ..SpawnOptions::default()
    }
}

fn start(options: &SpawnOptions) -> (Process, Receiver<Event>) {
    let (sender, receiver) = mpsc::channel();
    let process = spawn(options, move |event| {
        let _ = sender.send(event);
    })
    .unwrap();
    (process, receiver)
}

/// Every output byte up to the exit.
fn finish(events: &Receiver<Event>) -> (String, Exit) {
    let deadline = Instant::now() + WAIT;
    let mut text = String::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match events.recv_timeout(left) {
            Ok(Event::Output { data, .. }) => text.push_str(&String::from_utf8_lossy(&data)),
            Ok(Event::Exit(exit)) => return (text, exit),
            Err(err) => panic!("no exit ({err:?}): the program never saw the end; output {text:?}"),
        }
    }
}

#[test]
fn close_after_write_ends_stdin() {
    let (process, events) = start(&options("cat"));
    process.write(b"one\ntwo\n").unwrap();
    process.close_stdin().unwrap();
    let late = process.write(b"three\n").unwrap_err();
    assert_eq!(late.code, ErrorCode::IoError, "{late}");
    let (text, exit) = finish(&events);
    assert!(text.contains("got:one\ntwo\n:end"), "{text:?}");
    assert_eq!(exit.code, Some(0));
}

#[test]
fn closing_twice_is_harmless() {
    let (process, events) = start(&options("cat"));
    process.close_stdin().unwrap();
    process.close_stdin().unwrap();
    let (text, exit) = finish(&events);
    assert!(text.contains("got::end"), "{text:?}");
    assert_eq!(exit.code, Some(0));
}

#[test]
fn a_pty_has_no_stdin_to_close() {
    let mut pty = options("sleep");
    pty.pty = Some(PtySize { cols: 80, rows: 24 });
    let (process, _events) = start(&pty);
    let err = process.close_stdin().unwrap_err();
    assert_eq!(err.code, ErrorCode::Unsupported, "{err}");
}
