//! desk-sys proc primitives (feature `proc`): spawn without a shell in pipes or a PTY, write, resize,
//! signals, exit and reaping.
//!
//! The child program is this test binary again: the `child` test acts only when `DESK_SYS_TEST_CHILD`
//! names a role, so the tests need no shell and run the same on every OS.

use std::collections::BTreeMap;
use std::io::{IsTerminal, Write};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use desk_sys::ErrorCode;
use desk_sys::proc::{Event, Exit, Process, PtySize, Signal, SpawnOptions, Stream, spawn};

const ROLE: &str = "DESK_SYS_TEST_CHILD";
const WAIT: Duration = Duration::from_secs(30);

/// The child program. libtest prints its header first, so parents look for their text with `contains`.
#[test]
fn child() {
    let Ok(role) = std::env::var(ROLE) else {
        return;
    };
    let code = match role.as_str() {
        "args" => {
            let args: Vec<String> = std::env::args().skip_while(|a| a != "--").skip(1).collect();
            println!("args:{}", args.join("|"));
            0
        }
        "streams" => {
            println!("out:1");
            std::io::stdout().flush().unwrap();
            eprintln!("err:2");
            7
        }
        "cwd-env" => {
            let cwd = std::env::current_dir().unwrap().canonicalize().unwrap();
            println!("cwd:{}", cwd.display());
            println!(
                "env:{}",
                std::env::var("DESK_SYS_TEST_VALUE").unwrap_or_default()
            );
            println!("path:{}", std::env::var_os("PATH").is_some());
            0
        }
        "stdin" => {
            let mut line = String::new();
            std::io::stdin().read_line(&mut line).unwrap();
            println!("got:{}", line.trim_end());
            0
        }
        "tty" => {
            println!("tty:{}", std::io::stdout().is_terminal());
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

fn child_options(role: &str) -> SpawnOptions {
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

#[derive(Debug, Default)]
struct Output {
    stdout: String,
    stderr: String,
    pty: String,
}

impl Output {
    fn push(&mut self, stream: Stream, data: &[u8]) {
        let text = String::from_utf8_lossy(data);
        match stream {
            Stream::Stdout => self.stdout.push_str(&text),
            Stream::Stderr => self.stderr.push_str(&text),
            Stream::Pty => self.pty.push_str(&text),
        }
    }
}

/// All output up to the exit, which must be the last event: the callback is dropped after it.
fn finish(events: &Receiver<Event>) -> (Output, Exit) {
    let deadline = Instant::now() + WAIT;
    let mut output = Output::default();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match events.recv_timeout(left) {
            Ok(Event::Output { stream, data }) => output.push(stream, &data),
            Ok(Event::Exit(exit)) => {
                assert_eq!(
                    events.recv_timeout(Duration::from_secs(5)).err(),
                    Some(RecvTimeoutError::Disconnected),
                    "the exit is the last event"
                );
                return (output, exit);
            }
            Err(err) => panic!("no exit ({err:?}); output so far: {output:?}"),
        }
    }
}

/// Output until some stream holds `needle`.
fn wait_for(events: &Receiver<Event>, needle: &str) -> Output {
    let deadline = Instant::now() + WAIT;
    let mut output = Output::default();
    while Instant::now() < deadline {
        match events.recv_timeout(Duration::from_millis(100)) {
            Ok(Event::Output { stream, data }) => output.push(stream, &data),
            Ok(Event::Exit(exit)) => panic!("exited ({exit:?}) before {needle:?}: {output:?}"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if [&output.stdout, &output.stderr, &output.pty]
            .iter()
            .any(|s| s.contains(needle))
        {
            return output;
        }
    }
    panic!("no {needle:?} in {WAIT:?}: {output:?}");
}

fn pty() -> Option<PtySize> {
    Some(PtySize { cols: 80, rows: 24 })
}

#[test]
fn spawn_passes_args_without_a_shell() {
    let mut options = child_options("args");
    options
        .args
        .extend(["--", "$HOME", "a b", "*", "x;y"].map(String::from));
    let (_process, events) = start(&options);
    let (output, exit) = finish(&events);
    assert!(output.stdout.contains("args:$HOME|a b|*|x;y"), "{output:?}");
    assert_eq!(exit.code, Some(0));
}

#[test]
fn spawn_streams_stdout_and_stderr_then_reports_the_exit_code() {
    let (_process, events) = start(&child_options("streams"));
    let (output, exit) = finish(&events);
    assert!(output.stdout.contains("out:1"), "{output:?}");
    assert!(!output.stdout.contains("err:2"), "{output:?}");
    assert!(output.stderr.contains("err:2"), "{output:?}");
    assert!(output.pty.is_empty());
    assert_eq!(
        exit,
        Exit {
            code: Some(7),
            signal: None
        }
    );
}

#[test]
fn spawn_sets_cwd_and_adds_env() {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-sys-proc-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut options = child_options("cwd-env");
    options.cwd = Some(dir.clone());
    options
        .env
        .insert("DESK_SYS_TEST_VALUE".to_owned(), "a=b c".to_owned());
    let (_process, events) = start(&options);
    let (output, exit) = finish(&events);
    let cwd = dir.canonicalize().unwrap();
    assert!(
        output.stdout.contains(&format!("cwd:{}", cwd.display())),
        "{output:?}"
    );
    assert!(output.stdout.contains("env:a=b c"), "{output:?}");
    assert!(
        output.stdout.contains("path:true"),
        "the environment is inherited"
    );
    assert_eq!(exit.code, Some(0));
}

#[test]
fn write_reaches_stdin() {
    let (process, events) = start(&child_options("stdin"));
    process.write(b"hello\n").unwrap();
    let (output, exit) = finish(&events);
    assert!(output.stdout.contains("got:hello"), "{output:?}");
    assert_eq!(exit.code, Some(0));
}

#[test]
fn pty_merges_output_into_one_terminal_stream() {
    let mut options = child_options("streams");
    options.pty = pty();
    let (_process, events) = start(&options);
    let (output, exit) = finish(&events);
    assert!(output.pty.contains("out:1"), "{output:?}");
    assert!(output.pty.contains("err:2"), "{output:?}");
    assert!(output.stdout.is_empty() && output.stderr.is_empty());
    assert_eq!(exit.code, Some(7));

    let mut options = child_options("tty");
    options.pty = pty();
    let (_process, events) = start(&options);
    assert!(finish(&events).0.pty.contains("tty:true"));
    let (_process, events) = start(&child_options("tty"));
    assert!(finish(&events).0.stdout.contains("tty:false"));
}

#[test]
fn pty_write_reaches_the_program() {
    let mut options = child_options("stdin");
    options.pty = pty();
    let (process, events) = start(&options);
    // A terminal sends Enter as a carriage return; the line discipline turns it into a newline.
    process.write(b"hello\r").unwrap();
    let (output, exit) = finish(&events);
    assert!(output.pty.contains("got:hello"), "{output:?}");
    assert_eq!(exit.code, Some(0));
}

#[test]
fn resize_without_a_pty_is_unsupported() {
    let (process, events) = start(&child_options("sleep"));
    wait_for(&events, "ready");
    let err = process
        .resize(PtySize {
            cols: 100,
            rows: 30,
        })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::Unsupported, "{err}");
}

#[cfg(unix)]
#[test]
fn resize_changes_the_size_the_program_sees() {
    let options = SpawnOptions {
        program: "sh".to_owned(),
        args: ["-c", "read line; stty size"].map(String::from).to_vec(),
        pty: pty(),
        ..SpawnOptions::default()
    };
    let (process, events) = start(&options);
    process
        .resize(PtySize {
            cols: 100,
            rows: 30,
        })
        .unwrap();
    process.write(b"\r").unwrap();
    let (output, exit) = finish(&events);
    assert!(output.pty.contains("30 100"), "{output:?}");
    assert_eq!(exit.code, Some(0));
}

#[test]
fn kill_ends_the_process_with_each_portable_signal() {
    for in_pty in [false, true] {
        for signal in [Signal::Term, Signal::Kill, Signal::Int, Signal::Hup] {
            let mut options = child_options("sleep");
            options.pty = if in_pty { pty() } else { None };
            let (process, events) = start(&options);
            wait_for(&events, "ready");
            process.kill(signal).unwrap();
            let (_, exit) = finish(&events);
            if cfg!(unix) {
                assert_eq!(
                    exit,
                    Exit {
                        code: None,
                        signal: Some(signal)
                    },
                    "pty: {in_pty}"
                );
            } else {
                assert_ne!(exit.code, Some(0), "pty: {in_pty}, {signal:?}");
            }
            process
                .kill(Signal::Kill)
                .expect("killing an exited process is a no-op");
        }
    }
}

/// Whether `ps` still lists the process, zombie or not.
#[cfg(unix)]
fn listed(pid: u32) -> bool {
    let out = std::process::Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    !String::from_utf8_lossy(&out.stdout).trim().is_empty()
}

#[cfg(unix)]
#[test]
fn exited_and_dropped_processes_leave_no_zombies() {
    for in_pty in [false, true] {
        let mut options = child_options("streams");
        options.pty = if in_pty { pty() } else { None };
        let (process, events) = start(&options);
        let pid = process.pid().unwrap();
        finish(&events);
        assert!(
            !listed(pid),
            "pid {pid} is still listed after its exit (pty: {in_pty})"
        );

        options.env.insert(ROLE.to_owned(), "sleep".to_owned());
        let (process, events) = start(&options);
        let pid = process.pid().unwrap();
        wait_for(&events, "ready");
        drop(process);
        let deadline = Instant::now() + WAIT;
        while listed(pid) {
            assert!(
                Instant::now() < deadline,
                "pid {pid} outlived its handle (pty: {in_pty})"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        let (_, exit) = finish(&events);
        assert_eq!(exit.signal, Some(Signal::Kill));
    }
}

#[test]
fn spawn_reports_a_missing_program_as_not_found() {
    let missing = std::env::temp_dir().join("desk-sys-no-such-program");
    for program in [
        "desk-sys-no-such-program".to_owned(),
        missing.display().to_string(),
    ] {
        for size in [None, pty()] {
            let options = SpawnOptions {
                program: program.clone(),
                pty: size,
                ..SpawnOptions::default()
            };
            let err = spawn(&options, |_| {})
                .err()
                .expect("a missing program fails");
            assert_eq!(
                err.code,
                ErrorCode::NotFound,
                "{program} (pty: {size:?}): {err}"
            );
        }
    }
}

#[test]
fn spawn_rejects_a_missing_cwd_and_an_empty_pty_size() {
    let mut options = child_options("args");
    options.cwd = Some(std::env::temp_dir().join("desk-sys-no-such-folder"));
    let err = spawn(&options, |_| {}).err().expect("a missing cwd fails");
    assert_eq!(err.code, ErrorCode::NotFound, "{err}");

    let mut options = child_options("args");
    options.pty = Some(PtySize { cols: 0, rows: 24 });
    let err = spawn(&options, |_| {}).err().expect("an empty PTY fails");
    assert_eq!(err.code, ErrorCode::InvalidParams, "{err}");
}
