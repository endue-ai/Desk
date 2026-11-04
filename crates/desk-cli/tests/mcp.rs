//! `desk mcp` (ADR 0086): the binary speaks MCP on stdin and stdout to a real desk socket and `Core`,
//! runs a command as the agent `--agent` names, and ends when stdin closes. Bad flags are usage.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::Arc;

use desk_bridge::{BridgeEvent, BridgeRequest, Permission};
use desk_core::{Core, Roots};
use desk_ipc::Listener;
use serde_json::{Value, json};

fn call(core: &Core, caller: &str, method: &str, params: Value) {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    core.handle(caller, request);
}

#[test]
fn desk_mcp_runs_a_command_as_the_agent_it_names() {
    let core = Arc::new(Core::new(Roots {
        home: std::env::temp_dir(),
    }));
    for grant in desk_ipc::grants() {
        core.grant(desk_ipc::CALLER, grant);
    }
    let toggle = json!({ "id": "desk.theme.toggle", "title": "Switch theme" });
    call(&core, "desk", "cmd.register", toggle);
    let scope: Permission =
        serde_json::from_value(json!({ "permission": "cmd:invoke", "ids": ["desk.*"] })).unwrap();
    core.grant("agent:claude-code", scope);
    let events = core.events().subscribe();
    let provider = Arc::clone(&core);
    std::thread::spawn(move || {
        for event in events {
            if let BridgeEvent::CmdInvoked(invoked) = event {
                let result = json!({ "by": invoked.data.caller });
                let answer =
                    json!({ "invocationId": invoked.data.invocation_id, "result": result });
                call(&provider, "desk", "cmd.answer", answer);
            }
        }
    });
    let path = std::env::temp_dir().join(format!("dcli-mcp-{}.sock", std::process::id()));
    let _listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");

    let mut child = Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(["mcp", "--plugin", "desk", "--agent", "claude-code"])
        .env("DESK_SOCKET", &path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("desk runs");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ask = |id: u64, method: &str, params: Value| -> Value {
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        writeln!(stdin, "{line}").unwrap();
        loop {
            let mut line = String::new();
            assert!(stdout.read_line(&mut line).unwrap() > 0, "desk mcp ended");
            let message: Value = serde_json::from_str(&line).expect("stdout holds only MCP");
            if message["id"] == id {
                return message;
            }
        }
    };
    let init = ask(
        1,
        "initialize",
        json!({ "protocolVersion": "2025-06-18",
        "capabilities": {}, "clientInfo": { "name": "test", "version": "0" } }),
    );
    assert_eq!(init["result"]["serverInfo"]["name"], "endue-desk");
    let ran = ask(
        2,
        "tools/call",
        json!({ "name": "desk_theme_toggle", "arguments": {} }),
    );
    let text = ran["result"]["content"][0]["text"].as_str().unwrap();
    let output: Value = serde_json::from_str(text).unwrap();
    assert_eq!(output["result"]["by"], "agent:claude-code", "{ran}");

    drop(ask);
    drop(stdin);
    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(0), "desk mcp ends when stdin closes");
}

#[test]
fn desk_mcp_flags_that_are_wrong_are_usage() {
    for args in [
        &["mcp", "--agent", "has space"][..],
        &["mcp", "--agent"],
        &["mcp", "--agent", "a", "--agent", "b"],
        &["mcp", "--plugin", "--agent"],
        &["mcp", "extra"],
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_desk"))
            .args(args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(out.stdout.is_empty(), "{args:?}");
    }
}
