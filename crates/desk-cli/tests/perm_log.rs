//! `desk perm log [--agent <id>]` against a scripted desk on `DESK_SOCKET`: it reads the `perm`
//! channel with log.tail and prints one line per entry, only the agent's with `--agent` (ADR 0072).
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

/// A desk that answers log.tail with `entries` and records the requests.
fn serve(tag: &str, entries: Value) -> (PathBuf, Arc<Mutex<Vec<Value>>>) {
    let path = std::env::temp_dir().join(format!("dcli-log-{}-{tag}.sock", std::process::id()));
    let _ = std::fs::remove_file(&path);
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
                let answer = json!({ "id": request["id"], "ok": true,
                    "result": { "entries": entries.clone() } });
                let _ = writeln!(writer, "{answer}");
            }
        }
    });
    (path, requests)
}

fn desk(path: &PathBuf, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("DESK_SOCKET", path)
        .output()
        .expect("desk runs")
}

fn entry(at: &str, fields: Value) -> Value {
    json!({ "at": at, "channel": "perm", "level": "info", "message": "m", "fields": fields })
}

fn sample() -> Value {
    json!([
        entry(
            "2026-11-02T09:00:00.000Z",
            json!({ "caller": "desk", "permission": "plugin:manage",
            "scope": { "permission": "plugin:manage" }, "decision": "granted",
            "duration": "session", "grantId": "g1" })
        ),
        entry(
            "2026-11-02T09:00:01.000Z",
            json!({ "caller": "agent:mira", "permission": "fs:write",
            "scope": { "permission": "fs:write", "paths": ["~/Desktop/**"] }, "decision": "refused",
            "reason": "outside-allowlist", "target": "~/Desktop/x.txt" })
        ),
        entry(
            "2026-11-02T09:00:02.000Z",
            json!({ "caller": "agent:theo", "permission": "fs:read",
            "scope": { "permission": "fs:read", "paths": ["~/Notes/**"] }, "decision": "allowed",
            "target": "~/Notes/a.md" })
        ),
    ])
}

#[test]
fn perm_log_prints_the_perm_channel_and_filters_by_agent() {
    let (path, requests) = serve("all", sample());
    let out = desk(&path, &["perm", "log"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let request = requests.lock().unwrap().last().cloned().unwrap();
    assert_eq!(request["method"], "log.tail");
    assert_eq!(
        request["params"],
        json!({ "channel": "perm", "count": 1000, "scope": { "permission": "log:read" } })
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        concat!(
            "2026-11-02T09:00:00.000Z\tdesk\tgranted\tplugin:manage\t{\"permission\":\"plugin:manage\"}\n",
            "2026-11-02T09:00:01.000Z\tagent:mira\trefused\tfs:write\t~/Desktop/x.txt\toutside-allowlist\n",
            "2026-11-02T09:00:02.000Z\tagent:theo\tallowed\tfs:read\t~/Notes/a.md\n",
        )
    );

    let out = desk(&path, &["perm", "log", "--agent", "mira"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "2026-11-02T09:00:01.000Z\tagent:mira\trefused\tfs:write\t~/Desktop/x.txt\toutside-allowlist\n"
    );

    let out = desk(&path, &["--json", "perm", "log", "--agent", "theo"]);
    assert_eq!(out.status.code(), Some(0));
    let lines: Vec<Value> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines, vec![sample()[2].clone()]);

    assert_eq!(
        desk(&path, &["perm", "log", "--agent"]).status.code(),
        Some(2)
    );
    let _ = std::fs::remove_file(&path);
}
