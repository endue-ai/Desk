//! proc.write with `close: true` through `Core::handle` (ADR 0248): the data reaches the program,
//! stdin closes so a program reading to the end exits, a PTY answers `unsupported`, and a write
//! without `close` leaves stdin open as bridge v0 always did.
//!
//! The child program is this test binary again (`DESK_CORE_TEST_CHILD` names its role).

mod support;

use std::io::{Read as _, Write as _};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use desk_bridge::ErrorCode;
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const ROLE: &str = "DESK_CORE_TEST_CHILD";
const CALLER: &str = "example.git";
const WAIT: Duration = Duration::from_secs(30);

/// The child program: `cat` reads stdin to its end and prints it back.
#[test]
fn child() {
    let Ok(role) = std::env::var(ROLE) else {
        return;
    };
    let code = match role.as_str() {
        "cat" => {
            let mut all = String::new();
            std::io::stdin().read_to_string(&mut all).unwrap();
            println!("got:{all}:end");
            0
        }
        other => panic!("unknown role {other}"),
    };
    std::io::stdout().flush().unwrap();
    std::process::exit(code);
}

fn program() -> String {
    std::env::current_exe().unwrap().display().to_string()
}

fn scope(pty: bool) -> Value {
    let mut scope = json!({ "permission": "proc:spawn", "commands": [program()] });
    if pty {
        scope["pty"] = json!(true);
    }
    scope
}

fn spawn(core: &Core, pty: bool) -> String {
    let mut params = json!({
        "command": program(),
        "args": ["--exact", "child", "--nocapture", "--test-threads=1"],
        "env": { ROLE: "cat" },
        "scope": scope(pty),
    });
    if pty {
        params["pty"] = json!({ "cols": 80, "rows": 24 });
    }
    let started = call(core, CALLER, "proc.spawn", params).unwrap();
    started["procId"].as_str().unwrap().to_owned()
}

/// Output of `proc_id` and its exit code, or `None` when it did not exit within `wait`.
fn exit_of(events: &Receiver<Delivery>, proc_id: &str, wait: Duration) -> Option<(String, Value)> {
    let deadline = Instant::now() + wait;
    let mut text = String::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(delivery) = events.recv_timeout(left) else {
            break;
        };
        let value = serde_json::to_value(&delivery.event).unwrap();
        if value["data"]["procId"] != proc_id {
            continue;
        }
        if value["event"] == "proc.output" {
            text.push_str(value["data"]["data"].as_str().unwrap_or_default());
        } else if value["event"] == "proc.exit" {
            return Some((text, value["data"]["code"].clone()));
        }
    }
    None
}

fn write(
    core: &Core,
    proc_id: &str,
    data: &str,
    close: Option<bool>,
    pty: bool,
) -> Result<Value, desk_bridge::BridgeError> {
    let mut params = json!({ "procId": proc_id, "data": data, "scope": scope(pty) });
    if let Some(close) = close {
        params["close"] = json!(close);
    }
    call(core, CALLER, "proc.write", params)
}

#[test]
fn proc_write_with_close_lets_the_program_see_the_end() {
    let core = Core::new(roots(&home("proc-close")));
    grant(&core, CALLER, scope(true));
    let events = core.events().subscribe_addressed();

    let proc_id = spawn(&core, false);
    write(&core, &proc_id, "a\n", None, false).unwrap();
    write(&core, &proc_id, "b\n", Some(false), false).unwrap();
    assert!(
        exit_of(&events, &proc_id, Duration::from_millis(500)).is_none(),
        "without close stdin stays open"
    );
    write(&core, &proc_id, "c\n", Some(true), false).unwrap();
    let (text, code) = exit_of(&events, &proc_id, WAIT).expect("the program saw the end");
    assert!(text.contains("got:a\nb\nc\n:end"), "{text:?}");
    assert_eq!(code, 0);
}

#[test]
fn close_with_empty_data_and_a_pty_that_cannot_close() {
    let core = Core::new(roots(&home("proc-close-pty")));
    grant(&core, CALLER, scope(true));
    let events = core.events().subscribe_addressed();

    let proc_id = spawn(&core, false);
    write(&core, &proc_id, "", Some(true), false).unwrap();
    let (text, code) = exit_of(&events, &proc_id, WAIT).expect("an empty close ends input");
    assert!(text.contains("got::end"), "{text:?}");
    assert_eq!(code, 0);

    let pty = spawn(&core, true);
    let refused = write(&core, &pty, "x", Some(true), true).unwrap_err();
    assert_eq!(refused.code, ErrorCode::Unsupported, "{refused:?}");
    let _ = call(
        &core,
        CALLER,
        "proc.kill",
        json!({ "procId": pty, "signal": "kill", "scope": scope(true) }),
    );
}
