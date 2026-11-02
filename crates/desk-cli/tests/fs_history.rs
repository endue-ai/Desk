//! `desk fs history`, `desk fs restore` and `desk log` through the real binary, the desk socket and a
//! `Core` that keeps a history (ADR 0076), with `cli` holding what the app grants it.
#![cfg(unix)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;

use desk_bridge::{BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, Roots};
use desk_ipc::{CALLER, Listener};
use serde_json::{Value, json};

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Value {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(failure) => panic!("{method}: {:?}", failure.error),
    }
}

fn desk(socket: &Path, cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .current_dir(cwd)
        .env("DESK_SOCKET", socket)
        .output()
        .expect("desk runs")
}

fn stdout(out: &Output) -> String {
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(0), "{stderr}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// A home with `notes/a.md` ("# a\n") that example.notes overwrote once with "# b\n".
fn desk_with_one_version(tag: &str) -> (PathBuf, Arc<Core>) {
    let home = std::env::temp_dir().join(format!("dcli-fs-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&home);
    fs::create_dir_all(home.join("notes")).unwrap();
    fs::write(home.join("notes/a.md"), "# a\n").unwrap();
    // A broken index of another path: the core sets it aside and warns once.
    let paths = home.join(".data/history/paths");
    fs::create_dir_all(&paths).unwrap();
    fs::write(paths.join(format!("{}.json", "0".repeat(64))), "garbage").unwrap();
    let core = Arc::new(
        Core::new(Roots { home: home.clone() }).with_history_dir(home.join(".data/history")),
    );
    for permission in desk_ipc::grants() {
        core.grant(CALLER, permission);
    }
    let write: Permission =
        serde_json::from_value(json!({ "permission": "fs:write", "paths": ["~/notes/**"] }))
            .unwrap();
    core.grant("example.notes", write.clone());
    let scope = serde_json::to_value(&write).unwrap();
    call(
        &core,
        "example.notes",
        "fs.write",
        json!({ "path": "~/notes/a.md", "content": "# b\n", "scope": scope }),
    );
    (home, core)
}

#[test]
fn the_binary_lists_a_files_history_and_restores_a_version() {
    let (home, core) = desk_with_one_version("history");
    let socket = home.join("desk.sock");
    let _listener = Listener::bind(&socket, Arc::clone(&core)).expect("bind the desk socket");
    let file = home.join("notes/a.md");
    let path = file.to_string_lossy().into_owned();

    let listed = stdout(&desk(&socket, &home, &["fs", "history", &path]));
    let lines: Vec<&str> = listed.lines().collect();
    assert_eq!(lines.len(), 1, "{listed}");
    let fields: Vec<&str> = lines[0].split('\t').collect();
    assert_eq!(fields.len(), 4, "{listed}");
    assert_eq!(fields[2], "example.notes");
    assert_eq!(fields[3], "4");
    let version = fields[0];

    // A path relative to the working folder names the same file.
    let relative = stdout(&desk(
        &socket,
        &home.join("notes"),
        &["fs", "history", "a.md"],
    ));
    assert_eq!(relative, listed);

    let restored = stdout(&desk(&socket, &home, &["fs", "restore", &path, version]));
    assert_eq!(restored, "ok\n");
    assert_eq!(fs::read_to_string(&file).unwrap(), "# a\n");
    let after = stdout(&desk(
        &socket,
        &home,
        &["fs", "history", &path, "--limit", "1"],
    ));
    assert!(
        after.contains("\tcli\t"),
        "the restore is kept as cli's: {after}"
    );

    let missing = desk(&socket, &home, &["fs", "restore", &path, "1-abcdef"]);
    assert_eq!(missing.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&missing.stderr).contains("not_found"));
}

#[test]
fn desk_log_prints_the_cores_warning() {
    let (home, core) = desk_with_one_version("log");
    let socket = home.join("desk.sock");
    let _listener = Listener::bind(&socket, Arc::clone(&core)).expect("bind the desk socket");
    let logged = stdout(&desk(&socket, &home, &["log", "--count", "50"]));
    let warnings: Vec<&str> = logged
        .lines()
        .filter(|line| line.contains("\twarn\tcore\t"))
        .collect();
    assert_eq!(warnings.len(), 1, "{logged}");
    assert!(warnings[0].contains(".broken"), "{logged}");
}
