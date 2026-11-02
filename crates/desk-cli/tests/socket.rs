//! The `desk` binary against a scripted server on `DESK_SOCKET`: what each subcommand sends, what it
//! prints, and its exit code (0 ok, 1 bridge error or no desk, 2 usage).
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn socket() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("dcli-{}-{n}.sock", std::process::id()))
}

type Script = dyn Fn(&Value) -> Vec<String> + Send + Sync;

/// A server that records every request line and answers each with the lines `script` returns.
struct Server {
    path: PathBuf,
    requests: Arc<Mutex<Vec<Value>>>,
}

impl Server {
    fn start(script: impl Fn(&Value) -> Vec<String> + Send + Sync + 'static) -> Self {
        let path = socket();
        let listener = UnixListener::bind(&path).unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&requests);
        let script: Arc<Script> = Arc::new(script);
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

    /// Run `desk` with `args` against this server.
    fn desk(&self, args: &[&str]) -> Output {
        desk_at(&self.path, args)
    }

    fn requests(&self) -> Vec<Value> {
        self.requests.lock().unwrap().clone()
    }

    fn last(&self) -> Value {
        self.requests().pop().expect("a request")
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn desk_at(path: &PathBuf, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("DESK_SOCKET", path)
        .output()
        .expect("desk runs")
}

fn ok(request: &Value, result: Value) -> String {
    json!({ "id": request["id"], "ok": true, "result": result }).to_string()
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn ping_round_trips() {
    let server = Server::start(|r| vec![ok(r, json!({ "profile": "default", "settings": {} }))]);
    let out = server.desk(&["ping"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "ok\n");
    assert_eq!(server.last()["method"], "init.get");
    assert_eq!(server.last()["id"], 1, "the CLI counts its ids from 1");

    let out = server.desk(&["--json", "ping"]);
    assert_eq!(out.status.code(), Some(0));
    let line = ok(
        &server.last(),
        json!({ "profile": "default", "settings": {} }),
    );
    assert_eq!(stdout(&out), format!("{line}\n"));
}

#[test]
fn cmd_list_sends_a_star_scope_and_prints_one_line_per_command() {
    let server = Server::start(|r| {
        vec![ok(
            r,
            json!({ "commands": [
                { "id": "desk.theme.toggle", "title": "Switch theme", "provider": "desk" },
                { "id": "eris.say", "title": "Say to Eris", "provider": "endue.eris" },
            ] }),
        )]
    });
    let out = server.desk(&["cmd", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let request = server.last();
    assert_eq!(request["method"], "cmd.list");
    assert_eq!(
        request["params"]["scope"],
        json!({ "permission": "cmd:invoke", "ids": ["*"] })
    );
    assert_eq!(
        stdout(&out),
        "desk.theme.toggle\tdesk\tSwitch theme\neris.say\tendue.eris\tSay to Eris\n"
    );
}

#[test]
fn json_prints_the_answer_verbatim() {
    // Key order and spacing the CLI would not produce itself: it must not re-serialise.
    let server = Server::start(|r| {
        vec![format!(
            r#"{{"ok":true, "result":{{"commands":[]}}, "id":{}}}"#,
            r["id"]
        )]
    });
    for args in [["--json", "cmd", "list"], ["cmd", "list", "--json"]] {
        let out = server.desk(&args);
        assert_eq!(out.status.code(), Some(0), "{args:?}: {}", stderr(&out));
        assert_eq!(
            stdout(&out),
            "{\"ok\":true, \"result\":{\"commands\":[]}, \"id\":1}\n",
            "{args:?}"
        );
    }
}

#[test]
fn a_bridge_error_exits_1_and_names_the_code() {
    let failure = |r: &Value| {
        json!({ "id": r["id"], "ok": false, "error": {
            "code": "permission_denied", "message": "no grant covers the scope"
        } })
        .to_string()
    };
    let server = Server::start(move |r| vec![failure(r)]);
    let out = server.desk(&["cmd", "list"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains("permission_denied"),
        "{}",
        stderr(&out)
    );
    assert_eq!(stdout(&out), "");

    let out = server.desk(&["cmd", "list", "--json"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stdout(&out), format!("{}\n", failure(&server.last())));
}

fn answered(invocation: &str, id: &str, data: Value) -> String {
    let mut event = json!({ "event": "cmd.answered", "data": {
        "invocationId": invocation, "id": id, "caller": "cli"
    } });
    event["data"]
        .as_object_mut()
        .unwrap()
        .extend(data.as_object().unwrap().clone());
    event.to_string()
}

#[test]
fn cmd_run_waits_for_its_own_cmd_answered() {
    let server = Server::start(|r| {
        vec![
            ok(r, json!({ "invocationId": "i-1" })),
            json!({ "event": "cmd.changed", "data": {
                "id": "eris.say", "change": "registered", "provider": "endue.eris"
            } })
            .to_string(),
            answered(
                "i-9",
                "eris.say",
                json!({ "ok": true, "result": "not mine" }),
            ),
            answered(
                "i-1",
                "desk.theme.toggle",
                json!({ "ok": true, "result": "dark" }),
            ),
        ]
    });
    let out = server.desk(&[
        "cmd",
        "run",
        "desk.theme.toggle",
        "--args",
        r#"{"to":"dark"}"#,
    ]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "\"dark\"\n");
    let request = server.last();
    assert_eq!(request["method"], "cmd.invoke");
    assert_eq!(request["params"]["id"], "desk.theme.toggle");
    assert_eq!(request["params"]["args"], json!({ "to": "dark" }));
    assert_eq!(
        request["params"]["scope"],
        json!({ "permission": "cmd:invoke", "ids": ["desk.theme.toggle"] })
    );

    let out = server.desk(&["--json", "cmd", "run", "desk.theme.toggle"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let line = answered(
        "i-1",
        "desk.theme.toggle",
        json!({ "ok": true, "result": "dark" }),
    );
    assert_eq!(stdout(&out), format!("{line}\n"));
    assert!(server.last()["params"].get("args").is_none());
}

#[test]
fn cmd_run_reports_a_failed_command() {
    let server = Server::start(|r| {
        vec![
            ok(r, json!({ "invocationId": "i-2" })),
            answered(
                "i-2",
                "desk.theme.toggle",
                json!({ "ok": false, "error": { "code": "failed", "message": "no theme" } }),
            ),
        ]
    });
    let out = server.desk(&["cmd", "run", "desk.theme.toggle"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(stderr(&out).contains("failed"), "{}", stderr(&out));
    assert_eq!(stdout(&out), "");
}

#[test]
fn plugin_and_perm_commands_send_their_manage_scopes() {
    let server = Server::start(|r| {
        let result = match r["method"].as_str().unwrap() {
            "plugin.list" => json!({ "plugins": [
                { "id": "desk.sidebar", "status": "ready", "enabled": true, "builtIn": true, "revision": 1 },
                { "id": "example.broken", "status": "failed", "enabled": false, "builtIn": false,
                  "revision": 0, "error": "no entry" },
            ] }),
            "perm.list" => json!({ "grants": [
                { "caller": "cli", "grant": { "grantId": "g3", "permission": { "permission": "plugin:manage" },
                  "duration": "session", "grantedAt": "2026-10-30T00:00:00Z" } },
            ] }),
            "plugin.setEnabled" => json!({ "plugin": {
                "id": r["params"]["plugin"], "status": "ready", "enabled": r["params"]["enabled"],
                "builtIn": false, "revision": 1
            } }),
            _ => json!({}),
        };
        vec![ok(r, result)]
    });
    let plugin_manage = json!({ "permission": "plugin:manage" });
    let perm_manage = json!({ "permission": "perm:manage" });

    let out = server.desk(&["plugin", "disable", "x"]);
    assert_eq!(
        (out.status.code(), stdout(&out).as_str()),
        (Some(0), "ok\n")
    );
    assert_eq!(server.last()["method"], "plugin.setEnabled");
    assert_eq!(
        server.last()["params"],
        json!({ "plugin": "x", "enabled": false, "scope": plugin_manage })
    );

    let out = server.desk(&["plugin", "enable", "x"]);
    assert_eq!(
        (out.status.code(), stdout(&out).as_str()),
        (Some(0), "ok\n")
    );
    assert_eq!(server.last()["params"]["enabled"], true);

    let out = server.desk(&["plugin", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(server.last()["method"], "plugin.list");
    assert_eq!(server.last()["params"], json!({ "scope": plugin_manage }));
    assert_eq!(
        stdout(&out),
        "desk.sidebar\tready\tenabled\nexample.broken\tfailed\tdisabled\n"
    );

    let out = server.desk(&["perm", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(server.last()["method"], "perm.list");
    assert_eq!(server.last()["params"], json!({ "scope": perm_manage }));
    assert_eq!(
        stdout(&out),
        "g3\tcli\t{\"permission\":\"plugin:manage\"}\n"
    );

    let out = server.desk(&["perm", "revoke", "g3"]);
    assert_eq!(
        (out.status.code(), stdout(&out).as_str()),
        (Some(0), "ok\n")
    );
    assert_eq!(server.last()["method"], "perm.revoke");
    assert_eq!(
        server.last()["params"],
        json!({ "grantId": "g3", "scope": perm_manage })
    );
}

fn status(state: &str, extra: Value) -> Value {
    let mut status = json!({
        "state": state,
        "current": { "version": "0.1.0", "commit": "fa7a4af" },
        "channel": "stable"
    });
    for (key, value) in extra.as_object().unwrap() {
        status[key] = value.clone();
    }
    status
}

fn changed(data: Value) -> String {
    json!({ "event": "update.changed", "data": data }).to_string()
}

#[test]
fn desk_update_prints_the_state_and_the_builds() {
    let staged = status(
        "staged",
        json!({ "release": { "version": "0.2.0" }, "staged": true }),
    );
    let answer = staged.clone();
    let server = Server::start(move |r| vec![ok(r, answer.clone())]);
    let out = server.desk(&["update"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "staged\t0.1.0\tstable\t0.2.0\n");
    assert_eq!(server.last()["method"], "update.status");
    assert_eq!(
        server.last()["params"],
        json!({ "scope": { "permission": "update:manage" } })
    );
    let downloading = status(
        "downloading",
        json!({ "release": { "version": "0.2.0" }, "received": 25, "total": 100 }),
    );
    let server = Server::start(move |r| vec![ok(r, downloading.clone())]);
    let out = server.desk(&["update", "download"]);
    assert_eq!(stdout(&out), "downloading\t0.1.0\tstable\t0.2.0\t25%\n");
    assert_eq!(server.last()["method"], "update.download");
}

#[test]
fn desk_update_check_waits_for_the_check_to_end() {
    let server = Server::start(|r| {
        vec![
            ok(r, status("checking", json!({}))),
            changed(status("checking", json!({}))),
            json!({ "event": "plugin.changed", "data": { "plugin": "example.notes", "change": "enabled", "revision": 2 } }).to_string(),
            changed(status("up-to-date", json!({ "checkedAt": "2026-11-20T09:14:02Z" }))),
        ]
    });
    let out = server.desk(&["update", "check"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "up-to-date\t0.1.0\tstable\t-\n");
    assert_eq!(server.last()["method"], "update.check");

    let server = Server::start(|r| {
        vec![
            ok(r, status("checking", json!({}))),
            changed(status(
                "failed",
                json!({ "reason": "the channel index: offline" }),
            )),
        ]
    });
    let out = server.desk(&["update", "check"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(stderr(&out), "desk: failed: the channel index: offline\n");
}

#[test]
fn desk_update_apply_starts_the_restart() {
    let applying = status(
        "applying",
        json!({ "release": { "version": "0.2.0" }, "staged": true }),
    );
    let server = Server::start(move |r| vec![ok(r, applying.clone())]);
    let out = server.desk(&["update", "apply"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "applying\t0.1.0\tstable\t0.2.0\n");
    assert_eq!(server.last()["method"], "update.apply");
    let usage = server.desk(&["update", "later"]);
    assert_eq!(usage.status.code(), Some(2));
}

#[test]
fn no_desk_at_the_socket_exits_1() {
    let path = socket();
    let out = desk_at(&path, &["ping"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr(&out).contains(path.to_str().unwrap()),
        "{}",
        stderr(&out)
    );
}

#[test]
fn new_usage_errors_exit_2() {
    let path = socket();
    for args in [
        &["cmd"][..],
        &["cmd", "run"],
        &["cmd", "run", "x", "--args", "[1]"],
        &["cmd", "run", "x", "--args", "not json"],
        &["cmd", "run", "x", "--args"],
        &["cmd", "list", "more"],
        &["plugin", "enable"],
        &["plugin", "list", "x"],
        &["perm", "revoke"],
        &["perm"],
        &["ping", "x"],
    ] {
        let out = desk_at(&path, args);
        assert_eq!(out.status.code(), Some(2), "{args:?}: {}", stderr(&out));
        assert!(
            stderr(&out).contains("usage: desk"),
            "{args:?}: {}",
            stderr(&out)
        );
    }
}
