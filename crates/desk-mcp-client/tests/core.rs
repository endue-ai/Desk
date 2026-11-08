//! The fixture server attached to a real `Core` as `mcp:fixture` (ADR 0098): it starts only under a
//! `proc:spawn` grant, its tools are agent commands in `cmd.tools` (read-only where the server says
//! so, irreversible otherwise), an agent's call reaches it and comes back, a changed tool list is
//! registered again, and revoking the grant stops it.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use desk_bridge::{BridgeError, BridgeEvent, BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, Prompter, Roots};
use desk_mcp_client::{Host, ServerConfig};
use serde_json::{Value, json};

const WAIT: Duration = Duration::from_secs(30);
const AGENT: &str = "agent:tester";

struct Yes;

impl Prompter for Yes {
    fn ask(&self, _: &str, _: &Permission, _: &str) -> bool {
        true
    }
}

fn home(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("desk-mcp-client-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn core(tag: &str, prompter: impl Prompter + 'static) -> (Arc<Core>, PathBuf) {
    let home = home(tag);
    let core = Core::new(Roots { home: home.clone() }).with_prompter(prompter);
    let core = Arc::new(core);
    for permission in [
        json!({ "permission": "perm:manage" }),
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
        json!({ "permission": "log:read" }),
    ] {
        core.grant("desk", serde_json::from_value(permission).unwrap());
    }
    (core, home)
}

fn attach(core: &Arc<Core>, home: PathBuf) -> Host {
    let config = ServerConfig {
        name: "fixture".to_owned(),
        command: env!("CARGO_BIN_EXE_desk-mcp-fixture").to_owned(),
        args: Vec::new(),
        env: Vec::new(),
    };
    Host::attach(core, vec![config], home)
}

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
    let request = json!({ "id": 1, "method": method, "params": params });
    let request: BridgeRequest = serde_json::from_value(request).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(failed) => Err(failed.error),
    }
}

/// The ids of the registered `mcp.fixture.*` commands.
fn fixture_commands(core: &Core) -> Vec<String> {
    let scope = json!({ "permission": "cmd:invoke", "ids": ["*"] });
    let listed = call(core, "desk", "cmd.list", json!({ "scope": scope })).unwrap();
    let ids = listed["commands"].as_array().unwrap().iter();
    let ids = ids
        .filter_map(|c| c["id"].as_str())
        .filter(|id| id.starts_with("mcp.fixture."));
    ids.map(str::to_owned).collect()
}

fn until(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting until {what}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// cmd.invoke of `id` as `caller`, then the `cmd.answered` data.
fn invoke(core: &Core, caller: &str, id: &str, args: Value) -> Value {
    let events = core.events().subscribe();
    let params =
        json!({ "id": id, "args": args, "scope": { "permission": "cmd:invoke", "ids": [id] } });
    let started = call(core, caller, "cmd.invoke", params).unwrap();
    let invocation = started["invocationId"].as_str().unwrap().to_owned();
    loop {
        if let BridgeEvent::CmdAnswered(answered) = events.recv_timeout(WAIT).unwrap()
            && answered.data.invocation_id == invocation
        {
            return serde_json::to_value(answered.data).unwrap();
        }
    }
}

#[test]
fn tools_are_agent_commands_in_cmd_tools() {
    let (core, home) = core("tools", Yes);
    let _host = attach(&core, home);
    until("the tools are registered", || {
        fixture_commands(&core).len() == 5
    });
    let tools = call(&core, AGENT, "cmd.tools", json!({ "query": "fixture" })).unwrap();
    let tools = tools["tools"].as_array().unwrap();
    let named = |name: &str| tools.iter().find(|t| t["name"] == name).unwrap().clone();
    let echo = named("mcp_fixture_echo");
    assert_eq!(echo["command"], "mcp.fixture.echo");
    assert_eq!(echo["provider"], "mcp:fixture");
    assert_eq!(echo["description"], "Answers the text it is given.");
    assert_eq!(echo["readOnly"], true);
    assert_eq!(echo.get("irreversible"), None);
    assert_eq!(echo["argsSchema"]["required"], json!(["text"]));
    let note = named("mcp_fixture_add-note");
    assert_eq!(note["irreversible"], true);
    assert_eq!(note.get("readOnly"), None);
    assert_eq!(note["title"], "fixture: Add a note");
}

#[test]
fn an_agent_calls_a_tool_and_gets_its_answer() {
    let (core, home) = core("round-trip", Yes);
    let _host = attach(&core, home);
    until("echo is registered", || {
        fixture_commands(&core).contains(&"mcp.fixture.echo".into())
    });
    let answered = invoke(&core, AGENT, "mcp.fixture.echo", json!({ "text": "hello" }));
    assert_eq!(answered["ok"], true, "{answered}");
    assert_eq!(answered["caller"], AGENT);
    assert_eq!(answered["result"]["content"][0]["text"], "hello");
    let failed = invoke(&core, AGENT, "mcp.fixture.fail", json!({}));
    assert_eq!(failed["ok"], false);
    assert_eq!(failed["error"]["message"], "it failed on purpose");
    // The agent's args are checked against the tool's input schema before the server sees them.
    let params = json!({ "id": "mcp.fixture.echo", "args": {},
        "scope": { "permission": "cmd:invoke", "ids": ["mcp.fixture.echo"] } });
    let refused = call(&core, AGENT, "cmd.invoke", params).unwrap_err();
    assert!(refused.message.contains("text"), "{}", refused.message);
}

#[test]
fn a_refused_grant_starts_nothing() {
    let (core, home) = core("refused", desk_core::RefuseAll);
    let host = attach(&core, home);
    let scope = json!({ "permission": "log:read" });
    until("the server says why it did not start", || {
        let tail = json!({ "channel": "mcp:fixture", "scope": scope });
        let entries = call(&core, "desk", "log.tail", tail).unwrap();
        entries["entries"].as_array().is_some_and(|e| {
            e.iter().any(|entry| {
                entry["message"]
                    .as_str()
                    .unwrap_or("")
                    .contains("not started")
            })
        })
    });
    host.stop();
    assert!(fixture_commands(&core).is_empty());
}

#[test]
fn revoking_the_grant_stops_the_server() {
    let (core, home) = core("revoke", Yes);
    let _host = attach(&core, home);
    until("the tools are registered", || {
        fixture_commands(&core).len() == 5
    });
    let params = json!({ "caller": "mcp:fixture", "scope": { "permission": "perm:manage" } });
    let grants = call(&core, "desk", "perm.list", params).unwrap();
    let grant = &grants["grants"][0]["grant"];
    assert_eq!(grant["permission"]["permission"], "proc:spawn");
    assert_eq!(grant["duration"], "always");
    let revoke = json!({ "grantId": grant["grantId"], "scope": { "permission": "perm:manage" } });
    call(&core, "desk", "perm.revoke", revoke).unwrap();
    until("the tools are gone", || fixture_commands(&core).is_empty());
}

#[test]
fn a_changed_tool_list_is_registered_again() {
    let (core, home) = core("changed", Yes);
    let _host = attach(&core, home);
    until("the tools are registered", || {
        fixture_commands(&core).len() == 5
    });
    let grew = invoke(&core, "desk", "mcp.fixture.grow", json!({}));
    assert_eq!(grew["ok"], true, "{grew}");
    until("extra is registered", || {
        fixture_commands(&core).contains(&"mcp.fixture.extra".into())
    });
}
