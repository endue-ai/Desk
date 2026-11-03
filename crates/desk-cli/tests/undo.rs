//! `desk undo` and `desk redo` through the real binary and the desk socket (ADR 0077): the last
//! write a plugin made is undone by restoring the version the core kept, and done again.
#![cfg(unix)]

use std::fs;
use std::path::Path;
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

fn desk(socket: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("DESK_SOCKET", socket)
        .output()
        .expect("desk runs")
}

fn stdout(out: &Output) -> String {
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(0), "{stderr}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn desk_undo_undoes_the_last_write_and_desk_redo_does_it_again() {
    let home = std::env::temp_dir().join(format!("dcli-undo-{}", std::process::id()));
    let _ = fs::remove_dir_all(&home);
    fs::create_dir_all(home.join("notes")).unwrap();
    fs::write(home.join("notes/a.md"), "# a\n").unwrap();
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

    let socket = home.join("desk.sock");
    let _listener = Listener::bind(&socket, Arc::clone(&core)).expect("bind the desk socket");
    let file = home.join("notes/a.md");

    let undone = stdout(&desk(&socket, &["undo"]));
    let fields: Vec<&str> = undone.trim_end().split('\t').collect();
    assert_eq!(fields[..2], ["fs.write", "example.notes"], "{undone}");
    assert_eq!(fs::read_to_string(&file).unwrap(), "# a\n");

    let redone = stdout(&desk(&socket, &["redo"]));
    assert!(redone.starts_with("fs.write\texample.notes\t"), "{redone}");
    assert_eq!(fs::read_to_string(&file).unwrap(), "# b\n");

    stdout(&desk(&socket, &["undo"]));
    assert_eq!(stdout(&desk(&socket, &["undo"])), "nothing to undo\n");
    stdout(&desk(&socket, &["redo"]));
    assert_eq!(stdout(&desk(&socket, &["redo"])), "nothing to redo\n");
}
