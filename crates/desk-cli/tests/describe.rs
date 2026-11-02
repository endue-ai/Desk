//! `desk describe key|command|setting|plugin|grant <x>` against a scripted server on `DESK_SOCKET`:
//! the CLI asks the runtime's `desk.describe.open` over cmd.invoke and prints the text it answers,
//! the same text the runtime's tests read (`packages/runtime/src/describe/golden/`).
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

const GOLDEN: [(&str, &str, &str); 5] = [
    (
        "key",
        "Mod+S",
        include_str!("../../../packages/runtime/src/describe/golden/key.txt"),
    ),
    (
        "command",
        "desk.files.save",
        include_str!("../../../packages/runtime/src/describe/golden/command.txt"),
    ),
    (
        "setting",
        "desk.theme.scheme",
        include_str!("../../../packages/runtime/src/describe/golden/setting.txt"),
    ),
    (
        "plugin",
        "desk.palette",
        include_str!("../../../packages/runtime/src/describe/golden/plugin.txt"),
    ),
    (
        "grant",
        "g5",
        include_str!("../../../packages/runtime/src/describe/golden/grant.txt"),
    ),
];

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A server that records every request and answers each with the lines `script` returns.
struct Server {
    path: PathBuf,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl Server {
    fn start(script: impl Fn(&Value) -> Vec<String> + Send + Sync + 'static) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("dcli-d-{}-{n}.sock", std::process::id()));
        let listener = UnixListener::bind(&path).unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&requests);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut writer = stream.try_clone().unwrap();
                for line in BufReader::new(stream).lines() {
                    let Ok(line) = line else { break };
                    let request: Value = serde_json::from_str(&line).unwrap();
                    recorded.lock().unwrap().push(request.clone());
                    for answer in script(&request) {
                        let _ = writeln!(writer, "{answer}");
                    }
                }
            }
        });
        Self { path, requests }
    }

    fn desk(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_desk"))
            .args(args)
            .env("DESK_SOCKET", &self.path)
            .output()
            .expect("desk runs")
    }

    fn last(&self) -> Value {
        self.requests
            .lock()
            .unwrap()
            .last()
            .cloned()
            .expect("a request")
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Answers cmd.invoke with an invocation, then its `cmd.answered` with `data`.
fn answering(data: impl Fn(&Value) -> Value + Send + Sync + 'static) -> Server {
    Server::start(move |r| {
        let mut event = json!({ "event": "cmd.answered", "data": {
            "invocationId": "i-7", "id": "desk.describe.open", "caller": "cli"
        } });
        let more = data(r);
        event["data"]
            .as_object_mut()
            .unwrap()
            .extend(more.as_object().unwrap().clone());
        vec![
            json!({ "id": r["id"], "ok": true, "result": { "invocationId": "i-7" } }).to_string(),
            event.to_string(),
        ]
    })
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn describe_asks_the_runtime_and_prints_its_text() {
    let server = answering(|r| {
        let args = &r["params"]["args"];
        let text = GOLDEN
            .iter()
            .find(|(kind, name, _)| args["kind"] == *kind && args["name"] == *name)
            .map(|(_, _, text)| text.trim_end_matches('\n'))
            .unwrap_or("?");
        json!({ "ok": true, "result": {
            "kind": args["kind"], "name": args["name"], "summary": text.lines().next(),
            "lines": [], "text": text
        } })
    });
    for (kind, name, text) in GOLDEN {
        let out = server.desk(&["describe", kind, name]);
        assert_eq!(out.status.code(), Some(0), "{kind}: {}", stderr(&out));
        assert_eq!(stdout(&out), text, "{kind} prints the runtime's text");
        let request = server.last();
        assert_eq!(request["method"], "cmd.invoke");
        assert_eq!(
            request["params"],
            json!({
                "id": "desk.describe.open",
                "args": { "kind": kind, "name": name, "show": false },
                "scope": { "permission": "cmd:invoke", "ids": ["desk.describe.open"] }
            })
        );
    }

    let out = server.desk(&["--json", "describe", "key", "Mod+S"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let line: Value = serde_json::from_str(stdout(&out).trim()).unwrap();
    assert_eq!(line["event"], "cmd.answered");
    assert_eq!(
        line["data"]["result"]["text"],
        GOLDEN[0].2.trim_end_matches('\n')
    );
}

#[test]
fn describe_usage_and_failures() {
    let server = answering(|_| {
        json!({ "ok": false, "error": {
            "code": "failed", "message": "desk.describe.open: No setting desk.nope"
        } })
    });
    for args in [
        vec!["describe", "colour", "x"],
        vec!["describe", "key"],
        vec!["describe"],
    ] {
        let out = server.desk(&args);
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(
            stderr(&out).contains("describe"),
            "{args:?}: {}",
            stderr(&out)
        );
    }

    let out = server.desk(&["describe", "setting", "desk.nope"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains("No setting desk.nope"),
        "{}",
        stderr(&out)
    );
    assert_eq!(stdout(&out), "");
}
