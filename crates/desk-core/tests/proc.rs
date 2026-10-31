//! proc.* through `Core::handle`: every call passes the permission engine, a PTY needs a scope and a
//! grant that allow it, output and the exit reach the caller as events in order, a process belongs
//! to its caller, and it ends with the plugin that started it or the grant that allowed it.
//!
//! The child program is this test binary again (`DESK_CORE_TEST_CHILD` names its role), so the tests
//! need no shell and run the same on every OS.

mod support;

use std::io::Write as _;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::{call, grant, home, install_hello, plugin_manage, roots, set_enabled};

const ROLE: &str = "DESK_CORE_TEST_CHILD";
const TERM: &str = "example.term";
const WAIT: Duration = Duration::from_secs(30);

/// The child program. libtest prints its header first, so parents look for their text with `contains`.
#[test]
fn child() {
    let Ok(role) = std::env::var(ROLE) else {
        return;
    };
    let code = match role.as_str() {
        "streams" => {
            println!("out:1");
            std::io::stdout().flush().unwrap();
            eprintln!("err:2");
            7
        }
        "stdin" => {
            let mut line = String::new();
            std::io::stdin().read_line(&mut line).unwrap();
            println!("got:{}", line.trim_end());
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

fn params(role: &str, pty: bool, scope: Value) -> Value {
    let mut params = json!({
        "command": program(),
        "args": ["--exact", "child", "--nocapture", "--test-threads=1"],
        "env": { ROLE: role },
        "scope": scope,
    });
    if pty {
        params["pty"] = json!({ "cols": 80, "rows": 24 });
    }
    params
}

fn core() -> Core {
    Core::new(roots(&home("proc")))
}

fn spawn(core: &Core, caller: &str, params: Value) -> Result<String, BridgeError> {
    call(core, caller, "proc.spawn", params).map(|started| {
        assert!(started["pid"].as_u64().is_some(), "{started}");
        started["procId"].as_str().unwrap().to_owned()
    })
}

/// Deliveries about `proc_id` up to and including its proc.exit.
fn until_exit(events: &Receiver<Delivery>, proc_id: &str) -> Vec<Delivery> {
    let deadline = Instant::now() + WAIT;
    let mut seen = Vec::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(delivery) = events.recv_timeout(left) else {
            break;
        };
        let value = serde_json::to_value(&delivery.event).unwrap();
        if value["data"]["procId"] != proc_id {
            continue;
        }
        let exit = value["event"] == "proc.exit";
        seen.push(delivery);
        if exit {
            return seen;
        }
    }
    panic!("no proc.exit for {proc_id} within {WAIT:?}: {seen:?}");
}

/// Output on `stream` until some of it holds `needle`.
fn wait_for(events: &Receiver<Delivery>, proc_id: &str, needle: &str) -> String {
    let deadline = Instant::now() + WAIT;
    let mut text = String::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(delivery) = events.recv_timeout(left) else {
            break;
        };
        let value = serde_json::to_value(&delivery.event).unwrap();
        if value["event"] == "proc.output" && value["data"]["procId"] == proc_id {
            text.push_str(value["data"]["data"].as_str().unwrap_or_default());
        }
        if text.contains(needle) {
            return text;
        }
    }
    panic!("no {needle:?} from {proc_id} within {WAIT:?}: {text:?}");
}

fn values(deliveries: &[Delivery]) -> Vec<Value> {
    deliveries
        .iter()
        .map(|d| serde_json::to_value(&d.event).unwrap())
        .collect()
}

fn text_of(events: &[Value], stream: &str) -> String {
    events
        .iter()
        .filter(|e| e["event"] == "proc.output" && e["data"]["stream"] == stream)
        .map(|e| e["data"]["data"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn spawn_needs_a_grant_that_covers_the_command() {
    let core = core();
    let refused = spawn(&core, TERM, params("streams", false, scope(false))).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert_eq!(
        serde_json::to_value(refused.permission.unwrap()).unwrap(),
        scope(false),
        "the missing permission is named"
    );
    grant(
        &core,
        TERM,
        json!({ "permission": "proc:spawn", "commands": ["git"] }),
    );
    let refused = spawn(&core, TERM, params("streams", false, scope(false))).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "git is not it");
    let git = json!({ "permission": "proc:spawn", "commands": ["git"] });
    let refused = spawn(&core, TERM, params("streams", false, git)).unwrap_err();
    assert_eq!(
        refused.code,
        ErrorCode::PermissionDenied,
        "the scope must cover the command"
    );
    assert_eq!(core.process_count(), 0);
}

#[test]
fn a_pty_needs_a_scope_and_a_grant_that_allow_it() {
    let core = core();
    grant(&core, TERM, scope(false));
    let refused = spawn(&core, TERM, params("streams", true, scope(false))).unwrap_err();
    assert_eq!(
        refused.code,
        ErrorCode::PermissionDenied,
        "scope without pty"
    );
    let refused = spawn(&core, TERM, params("streams", true, scope(true))).unwrap_err();
    assert_eq!(
        refused.code,
        ErrorCode::PermissionDenied,
        "grant without pty"
    );

    grant(&core, TERM, scope(true));
    let events = core.events().subscribe_addressed();
    let proc_id = spawn(&core, TERM, params("streams", true, scope(true))).unwrap();
    let seen = values(&until_exit(&events, &proc_id));
    let terminal = text_of(&seen, "pty");
    assert!(
        terminal.contains("out:1") && terminal.contains("err:2"),
        "{terminal:?}"
    );
    assert!(text_of(&seen, "stdout").is_empty() && text_of(&seen, "stderr").is_empty());
    assert_eq!(seen.last().unwrap()["data"]["code"], 7);
}

#[test]
fn output_and_the_exit_reach_the_caller_in_order() {
    let core = core();
    grant(&core, TERM, scope(false));
    let events = core.events().subscribe_addressed();
    let proc_id = spawn(&core, TERM, params("streams", false, scope(false))).unwrap();
    assert_eq!(core.process_count(), 1);
    let deliveries = until_exit(&events, &proc_id);
    assert!(
        deliveries
            .iter()
            .all(|d| d.to == Some(vec![TERM.to_owned()])),
        "every event is for the caller"
    );
    let seen = values(&deliveries);
    assert!(text_of(&seen, "stdout").contains("out:1"), "{seen:?}");
    assert!(text_of(&seen, "stderr").contains("err:2"), "{seen:?}");
    assert_eq!(
        seen.last().unwrap()["data"],
        json!({ "procId": proc_id, "code": 7 })
    );
    assert_eq!(core.process_count(), 0, "an ended process leaves the table");
}

#[test]
fn write_reaches_the_program_and_an_ended_process_is_forgotten() {
    let core = core();
    grant(&core, TERM, scope(true));
    let events = core.events().subscribe_addressed();
    let proc_id = spawn(&core, TERM, params("stdin", true, scope(true))).unwrap();
    // A terminal sends Enter as a carriage return; the line discipline makes it a newline.
    call(
        &core,
        TERM,
        "proc.write",
        json!({ "procId": proc_id, "data": "aGVsbG8N", "encoding": "base64", "scope": scope(true) }),
    )
    .unwrap();
    let seen = values(&until_exit(&events, &proc_id));
    assert!(text_of(&seen, "pty").contains("got:hello"), "{seen:?}");
    let gone = call(
        &core,
        TERM,
        "proc.write",
        json!({ "procId": proc_id, "data": "x", "scope": scope(true) }),
    )
    .unwrap_err();
    assert_eq!(gone.code, ErrorCode::NotFound);
}

#[test]
fn a_process_belongs_to_its_caller_and_later_calls_need_a_covering_scope() {
    let core = core();
    grant(&core, TERM, scope(false));
    grant(&core, "example.other", scope(false));
    let events = core.events().subscribe_addressed();
    let proc_id = spawn(&core, TERM, params("sleep", false, scope(false))).unwrap();
    wait_for(&events, &proc_id, "ready");

    let kill = |caller: &str, scope: Value| {
        call(
            &core,
            caller,
            "proc.kill",
            json!({ "procId": proc_id, "scope": scope }),
        )
    };
    let stranger = kill("example.other", scope(false)).unwrap_err();
    assert_eq!(
        stranger.code,
        ErrorCode::NotFound,
        "another caller's process"
    );
    let git = json!({ "permission": "proc:spawn", "commands": ["git"] });
    assert_eq!(
        kill(TERM, git).unwrap_err().code,
        ErrorCode::PermissionDenied,
        "a scope that does not cover the command"
    );
    let resized = call(
        &core,
        TERM,
        "proc.resize",
        json!({ "procId": proc_id, "size": { "cols": 100, "rows": 30 }, "scope": scope(false) }),
    )
    .unwrap_err();
    assert_eq!(resized.code, ErrorCode::Unsupported, "no PTY to resize");

    kill(TERM, scope(false)).unwrap();
    let seen = values(&until_exit(&events, &proc_id));
    let exit = &seen.last().unwrap()["data"];
    if cfg!(unix) {
        assert_eq!(exit["signal"], "term", "{exit}");
    } else {
        assert_ne!(exit["code"], 0, "{exit}");
    }
}

#[cfg(unix)]
#[test]
fn a_pty_can_be_resized() {
    let core = core();
    let sh = json!({ "permission": "proc:spawn", "commands": ["sh"], "pty": true });
    grant(&core, TERM, sh.clone());
    let events = core.events().subscribe_addressed();
    let proc_id = spawn(
        &core,
        TERM,
        json!({ "command": "sh", "args": ["-c", "read x; stty size"], "cwd": "~",
                "pty": { "cols": 80, "rows": 24 }, "scope": sh }),
    )
    .unwrap();
    call(
        &core,
        TERM,
        "proc.resize",
        json!({ "procId": proc_id, "size": { "cols": 120, "rows": 40 }, "scope": sh }),
    )
    .unwrap();
    call(
        &core,
        TERM,
        "proc.write",
        json!({ "procId": proc_id, "data": "go\r", "scope": sh }),
    )
    .unwrap();
    let seen = values(&until_exit(&events, &proc_id));
    assert!(text_of(&seen, "pty").contains("40 120"), "{seen:?}");
}

#[test]
fn a_plugin_turned_off_takes_its_processes_with_it() {
    let home = home("proc");
    let core = Core::new(roots(&home));
    install_hello(&core, &home);
    grant(&core, "example.hello", scope(false));
    grant(&core, "desk", plugin_manage());
    let events = core.events().subscribe_addressed();
    let proc_id = spawn(&core, "example.hello", params("sleep", false, scope(false))).unwrap();
    wait_for(&events, &proc_id, "ready");

    set_enabled(&core, "example.hello", false);
    assert_eq!(core.process_count(), 0);
    let seen = values(&until_exit(&events, &proc_id));
    if cfg!(unix) {
        assert_eq!(seen.last().unwrap()["data"]["signal"], "kill");
    }
}

#[test]
fn revoking_the_grant_ends_its_processes() {
    let core = core();
    let grant_id = grant(&core, TERM, scope(false));
    let events = core.events().subscribe_addressed();
    let proc_id = spawn(&core, TERM, params("sleep", false, scope(false))).unwrap();
    wait_for(&events, &proc_id, "ready");

    call(&core, TERM, "perm.revoke", json!({ "grantId": grant_id })).unwrap();
    assert_eq!(
        core.process_count(),
        0,
        "a revoked grant ends its processes"
    );
    let seen = values(&until_exit(&events, &proc_id));
    if cfg!(unix) {
        assert_eq!(seen.last().unwrap()["data"]["signal"], "kill");
    }
}

#[test]
fn a_missing_program_or_folder_is_not_found() {
    let core = core();
    let missing = json!({ "permission": "proc:spawn", "commands": ["desk-core-no-such-program"] });
    grant(&core, TERM, missing.clone());
    let refused = spawn(
        &core,
        TERM,
        json!({ "command": "desk-core-no-such-program", "scope": missing }),
    )
    .unwrap_err();
    assert_eq!(refused.code, ErrorCode::NotFound);

    grant(&core, TERM, scope(false));
    let mut params = params("streams", false, scope(false));
    params["cwd"] = json!("~/no-such-folder");
    let refused = spawn(&core, TERM, params).unwrap_err();
    assert_eq!(refused.code, ErrorCode::NotFound);
    assert_eq!(core.process_count(), 0);
}
