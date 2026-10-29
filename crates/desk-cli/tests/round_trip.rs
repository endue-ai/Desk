//! The real stack: the `desk` binary, the desk socket (`desk_ipc::Listener`) and a `Core` where the
//! runtime (`desk`) provides `desk.theme.toggle` and the CLI holds `cmd:invoke ["*"]`.
#![cfg(unix)]

use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::Arc;

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, Roots};
use desk_ipc::{CALLER, Listener};
use serde_json::{Value, json};

fn call(core: &Core, caller: &str, method: &str, params: Value) -> BridgeResponse {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    core.handle(caller, request)
}

fn desk(path: &PathBuf, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("DESK_SOCKET", path)
        .output()
        .expect("desk runs")
}

#[test]
fn the_binary_runs_a_command_through_the_socket_and_the_core() {
    let core = Arc::new(Core::new(Roots {
        home: std::env::temp_dir(),
    }));
    let registered = call(
        &core,
        "desk",
        "cmd.register",
        json!({ "id": "desk.theme.toggle", "title": "Switch theme" }),
    );
    assert!(matches!(registered, BridgeResponse::BridgeSuccess(_)));
    let permission: Permission =
        serde_json::from_value(json!({ "permission": "cmd:invoke", "ids": ["*"] })).unwrap();
    core.grant(CALLER, permission);

    // The runtime's part: answer every invocation of its command.
    let events = core.events().subscribe();
    let provider = Arc::clone(&core);
    std::thread::spawn(move || {
        for event in events {
            if let BridgeEvent::CmdInvoked(invoked) = event {
                let answer = json!({ "invocationId": invoked.data.invocation_id, "result": "dark" });
                call(&provider, "desk", "cmd.answer", answer);
            }
        }
    });

    let path = std::env::temp_dir().join(format!("dcli-rt-{}.sock", std::process::id()));
    let _listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");

    let out = desk(&path, &["cmd", "run", "desk.theme.toggle"]);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(0), "{stderr}");
    assert_eq!(String::from_utf8_lossy(&out.stdout), "\"dark\"\n");

    let out = desk(&path, &["cmd", "list"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "desk.theme.toggle\tdesk\tSwitch theme\n"
    );

    let out = desk(&path, &["ping"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(String::from_utf8_lossy(&out.stdout), "ok\n");
}
