//! `desk inspect [section]` against a scripted server on `DESK_SOCKET` that answers what the inspector
//! plugin's tests answer (`plugins/inspector/tests/golden/answers.json`): the CLI makes the plugin's
//! calls and prints what its Export JSON gives (`export.txt`), byte for byte.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

const ANSWERS: &str = include_str!("../../../plugins/inspector/tests/golden/answers.json");
const EXPORT: &str = include_str!("../../../plugins/inspector/tests/golden/export.txt");
const INSPECT: &str = "desk.inspect.open";

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A server that records every request and answers each with the lines `script` returns.
struct Server {
    path: PathBuf,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl Server {
    fn start(script: impl Fn(&Value) -> Vec<String> + Send + Sync + 'static) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("dcli-i-{}-{n}.sock", std::process::id()));
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

    /// Every request so far, and none from now on.
    fn take(&self) -> Vec<Value> {
        std::mem::take(&mut *self.requests.lock().unwrap())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// The core and the runtime as the golden answers say; `refuse` names a method that is refused.
fn golden(refuse: Option<&'static str>) -> Server {
    let answers: Value = serde_json::from_str(ANSWERS).unwrap();
    let invocations = AtomicU64::new(0);
    Server::start(move |r| {
        let method = r["method"].as_str().unwrap_or_default();
        if Some(method) == refuse {
            let error = json!({ "code": "permission_denied", "message": format!("{method}: no grant"),
                                "permission": { "permission": "perm:manage" } });
            return vec![json!({ "id": r["id"], "ok": false, "error": error }).to_string()];
        }
        if method != "cmd.invoke" {
            let result = answers[method].clone();
            return vec![json!({ "id": r["id"], "ok": true, "result": result }).to_string()];
        }
        let n = invocations.fetch_add(1, Ordering::Relaxed);
        let invocation = format!("i-{n}");
        let section = r["params"]["args"]["section"].as_str().unwrap_or_default();
        let result = answers[INSPECT][section].clone();
        let data = if result.is_null() {
            json!({ "invocationId": invocation, "id": INSPECT, "caller": "cli", "ok": false,
                    "error": { "code": "failed", "message": "Name a section the runtime answers" } })
        } else {
            json!({ "invocationId": invocation, "id": INSPECT, "caller": "cli", "ok": true,
                    "result": result })
        };
        vec![
            json!({ "id": r["id"], "ok": true, "result": { "invocationId": invocation } })
                .to_string(),
            json!({ "event": "cmd.answered", "data": data }).to_string(),
        ]
    })
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

/// What a request asked: its method and params, without its id.
fn asked(request: &Value) -> Value {
    json!({ "method": request["method"], "params": request["params"] })
}

fn runtime(section: &str) -> Value {
    json!({ "method": "cmd.invoke", "params": {
        "id": INSPECT, "args": { "section": section },
        "scope": { "permission": "cmd:invoke", "ids": [INSPECT] }
    } })
}

fn core(method: &str, permission: &str) -> Value {
    json!({ "method": method, "params": { "scope": { "permission": permission } } })
}

#[test]
fn inspect_prints_what_export_json_gives() {
    let server = golden(None);
    let out = server.desk(&["inspect"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), EXPORT);
    let requests: Vec<Value> = server.take().iter().map(asked).collect();
    assert_eq!(
        requests,
        vec![
            runtime("tree"),
            runtime("surfaces"),
            core("cmd.recent", "perm:manage"),
            core("perm.list", "perm:manage"),
            runtime("settings"),
            core("plugin.list", "plugin:manage"),
            core("plugin.stats", "perm:manage"),
        ]
    );

    let all: Value = serde_json::from_str(EXPORT).unwrap();
    let expected = format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({ "commands": all["commands"] })).unwrap()
    );
    for args in [
        vec!["inspect", "commands"],
        vec!["--json", "inspect", "commands"],
    ] {
        let out = server.desk(&args);
        assert_eq!(out.status.code(), Some(0), "{args:?}: {}", stderr(&out));
        assert_eq!(stdout(&out), expected, "{args:?}");
        let requests: Vec<Value> = server.take().iter().map(asked).collect();
        assert_eq!(requests, vec![core("cmd.recent", "perm:manage")]);
    }

    let out = server.desk(&["inspect", "settings"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let printed: Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_eq!(printed, json!({ "settings": all["settings"] }));
}

#[test]
fn inspect_usage_and_failures() {
    let server = golden(Some("perm.list"));
    for args in [
        vec!["inspect", "colours"],
        vec!["inspect", "tree", "surfaces"],
    ] {
        let out = server.desk(&args);
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(
            stderr(&out).contains("inspect"),
            "{args:?}: {}",
            stderr(&out)
        );
    }

    let out = server.desk(&["inspect", "grants"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stdout(&out), "");
    assert!(
        stderr(&out).contains("desk: permission_denied: perm.list: no grant"),
        "{}",
        stderr(&out)
    );
    // The whole desk fails with the first section that fails, and prints nothing.
    let out = server.desk(&["inspect"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stdout(&out), "");
}
