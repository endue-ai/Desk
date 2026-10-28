//! desk-sys proc primitives (feature `proc`): pipes, a pseudo-terminal, input, signals and exits.
#![cfg(unix)]

use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_sys::proc::{Exit, Process, Signal, Size, Spec, Stream, spawn};

/// Every chunk read, with the stream it came from.
type Output = Arc<Mutex<Vec<(Stream, Vec<u8>)>>>;

struct Run {
    process: Process,
    output: Output,
    exit: Receiver<Exit>,
}

fn run(program: &str, args: &[&str], pty: Option<Size>) -> Run {
    let output: Output = Arc::default();
    let (sender, exit) = mpsc::channel();
    let sink = output.clone();
    let process = spawn(
        Spec {
            program: program.to_owned(),
            args: args.iter().map(|a| a.to_string()).collect(),
            pty,
            ..Spec::default()
        },
        move |stream, bytes| sink.lock().unwrap().push((stream, bytes.to_vec())),
        move |exit| {
            let _ = sender.send(exit);
        },
    )
    .unwrap();
    Run {
        process,
        output,
        exit,
    }
}

fn text(run: &Run, stream: Stream) -> String {
    let output = run.output.lock().unwrap();
    let bytes: Vec<u8> = output
        .iter()
        .filter(|(s, _)| *s == stream)
        .flat_map(|(_, b)| b.clone())
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn exit(run: &Run) -> Exit {
    run.exit
        .recv_timeout(Duration::from_secs(10))
        .expect("the process ends")
}

#[test]
fn pipes_keep_stdout_and_stderr_apart_and_report_the_exit_code() {
    let run = run("sh", &["-c", "echo out; echo err >&2; exit 3"], None);
    assert_eq!(
        exit(&run),
        Exit {
            code: Some(3),
            signal: None
        }
    );
    assert_eq!(text(&run, Stream::Stdout), "out\n");
    assert_eq!(text(&run, Stream::Stderr), "err\n");
    assert!(run.process.pid().is_some());
}

#[test]
fn input_reaches_stdin() {
    let run = run("cat", &[], None);
    run.process.write(b"hello\n").unwrap();
    std::thread::sleep(Duration::from_millis(200));
    run.process.signal(Signal::Term).unwrap();
    assert_eq!(
        exit(&run),
        Exit {
            code: None,
            signal: Some(Signal::Term)
        }
    );
    assert_eq!(text(&run, Stream::Stdout), "hello\n");
}

#[test]
fn a_terminal_merges_output_and_can_be_resized() {
    let size = Size { cols: 80, rows: 24 };
    let run = run(
        "sh",
        &["-c", "read line; stty size; echo got $line"],
        Some(size),
    );
    run.process
        .resize(Size {
            cols: 100,
            rows: 30,
        })
        .unwrap();
    run.process.write(b"ping\n").unwrap();
    assert_eq!(exit(&run).code, Some(0));
    let out = text(&run, Stream::Pty);
    assert!(out.contains("30 100"), "stty sees the new size: {out:?}");
    assert!(out.contains("got ping"), "{out:?}");
}

#[test]
fn processes_without_a_terminal_cannot_be_resized_and_a_kill_is_reported() {
    let run = run("sleep", &["30"], None);
    let error = run.process.resize(Size { cols: 1, rows: 1 }).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::Unsupported);
    run.process.signal(Signal::Kill).unwrap();
    assert_eq!(
        exit(&run),
        Exit {
            code: None,
            signal: Some(Signal::Kill)
        }
    );
}

#[test]
fn dropping_a_process_kills_it() {
    let run = run("sleep", &["30"], None);
    let Run { process, exit, .. } = run;
    drop(process);
    let ended = exit.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_eq!(ended.signal, Some(Signal::Kill));
}

#[test]
fn a_missing_program_fails_to_start() {
    let result = spawn(
        Spec {
            program: "desk-no-such-program".to_owned(),
            ..Spec::default()
        },
        |_, _| {},
        |_| {},
    );
    assert!(result.is_err());
}
