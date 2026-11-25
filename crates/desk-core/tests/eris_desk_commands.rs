//! The desk commands Eris can use without a scope prompt (ADR 0369).

mod support;

use std::{fs, sync::mpsc::Receiver, thread};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const ERIS: &str = "agent:eris";
const OPEN: &str = "desk.plugins.open";
const READ: &str = "desk.design.get";
const TRANSCRIPT: &str = "desk.agents.transcript";
const CAPABILITIES: &str = "desk.capabilities";
const HELLO: &str = "example.hello";

fn setup(init: &str) -> (Core, Receiver<Delivery>) {
    let home = home("eris-desk-scope");
    let file = home.join("init.yaml");
    fs::write(&file, init).unwrap();
    let core = Core::new(roots(&home))
        .with_prompter(NeverAsk)
        .with_init_file(file);
    let deliveries = core.events().subscribe_addressed();
    grant(&core, "desk", plugin_manage());
    install_hello(&core, &home);
    set_enabled(&core, HELLO, true);
    register(&core, "desk", CAPABILITIES, false, false);
    register(&core, "desk", READ, true, false);
    register(&core, "desk", TRANSCRIPT, true, false);
    register(&core, "desk", OPEN, false, false);
    (core, deliveries)
}

fn register(core: &Core, provider: &str, id: &str, read_only: bool, irreversible: bool) {
    call(
        core,
        provider,
        "cmd.register",
        json!({ "id": id, "title": id, "description": "Test command.", "agent": true,
            "readOnly": read_only, "irreversible": irreversible }),
    )
    .unwrap();
}

fn scope(id: &str) -> Value {
    json!({ "permission": "cmd:invoke", "ids": [id] })
}

fn invoke(core: &Core, caller: &str, id: &str, args: Value) -> Result<Value, BridgeError> {
    call(
        core,
        caller,
        "cmd.invoke",
        json!({ "id": id, "args": args, "scope": scope(id) }),
    )
}

fn refuse_prompt(
    core: &Core,
    deliveries: &Receiver<Delivery>,
    caller: &str,
    id: &str,
    args: Value,
) {
    grant(core, "desk", manage());
    thread::scope(|s| {
        let running = s.spawn(|| invoke(core, caller, id, args));
        let prompt = wait_for(deliveries, "perm.prompt");
        assert_eq!(prompt.data()["caller"], caller);
        assert_eq!(prompt.data()["permission"], scope(id));
        let answer = json!({ "promptId": prompt.data()["promptId"], "granted": false,
            "scope": manage() });
        call(core, "desk", "perm.answer", answer).unwrap();
        assert_eq!(
            running.join().unwrap().unwrap_err().code,
            ErrorCode::PermissionDenied
        );
    });
    assert!(named(deliveries, "cmd.invoked").is_empty());
}

#[test]
fn eris_opens_an_enabled_plugin_and_reads_the_desk_without_a_grant() {
    let (core, deliveries) = setup("");
    for (id, args) in [
        (CAPABILITIES, json!({})),
        (READ, json!({})),
        (OPEN, json!({ "plugin": HELLO })),
    ] {
        invoke(&core, ERIS, id, args).unwrap();
        let invoked = wait_for(&deliveries, "cmd.invoked");
        assert_eq!(invoked.data()["id"], id);
        assert_eq!(invoked.data()["caller"], ERIS);
    }
    assert!(query(&core, ERIS).is_empty());
    grant(&core, "desk", json!({ "permission": "log:read" }));
    let tail = call(
        &core,
        "desk",
        "log.tail",
        json!({ "channel": "perm", "count": 1000,
        "scope": { "permission": "log:read" } }),
    )
    .unwrap();
    let allowed: Vec<&Value> = tail["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| &e["fields"])
        .filter(|fields| fields["caller"] == ERIS && fields["decision"] == "allowed")
        .collect();
    assert_eq!(allowed.len(), 3);
    assert_eq!(allowed[0]["target"], CAPABILITIES);
    assert_eq!(allowed[2]["target"], OPEN);
}

#[test]
fn tool_discovery_marks_only_unconditional_commands_as_granted() {
    let (core, _) = setup("");
    let result = call(&core, ERIS, "cmd.tools", json!({})).unwrap();
    let tools = result["tools"].as_array().unwrap();
    for (id, granted) in [
        (CAPABILITIES, true),
        (READ, true),
        (OPEN, false),
        (TRANSCRIPT, false),
    ] {
        let tool = tools.iter().find(|tool| tool["command"] == id).unwrap();
        assert_eq!(tool["granted"], granted, "{id}");
    }
}

#[test]
fn other_agents_and_eris_reading_a_transcript_still_ask() {
    let (core, deliveries) = setup("");
    refuse_prompt(&core, &deliveries, "agent:mira", CAPABILITIES, json!({}));
    refuse_prompt(&core, &deliveries, ERIS, TRANSCRIPT, json!({}));
}

#[test]
fn eris_still_asks_before_opening_a_disabled_plugin() {
    let (core, deliveries) = setup("");
    set_enabled(&core, HELLO, false);
    refuse_prompt(&core, &deliveries, ERIS, OPEN, json!({ "plugin": HELLO }));
}

#[test]
fn eris_opens_a_built_in_view_freely_and_a_custom_view_with_scope() {
    let (core, deliveries) = setup("");
    register(&core, "desk.views", "desk.views.open", false, false);
    for (id, built_in) in [("example.built-in", true), ("example.custom", false)] {
        let dir = home(id);
        let manifest = json!({ "id": id, "version": "0.1.0", "kind": "policy",
            "contributes": { "commands": [{ "id": format!("{id}.open"), "title": "Open",
                "runs": { "command": "desk.views.open" } }] } });
        fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
        core.install_plugin(&dir, built_in);
        set_enabled(&core, id, true);
        let args = json!({ "plugin": id });
        if built_in {
            invoke(&core, ERIS, OPEN, args).unwrap();
            assert_eq!(wait_for(&deliveries, "cmd.invoked").data()["id"], OPEN);
        } else {
            refuse_prompt(&core, &deliveries, ERIS, OPEN, args);
        }
    }
}

#[test]
fn eris_still_asks_before_reading_from_an_mcp_server() {
    let (core, deliveries) = setup("");
    let id = "mcp.fixture.state";
    register(&core, "mcp:fixture", id, true, false);
    refuse_prompt(&core, &deliveries, ERIS, id, json!({}));
}

#[test]
fn the_allowlist_still_caps_reads_and_opening_an_enabled_plugin() {
    let (core, deliveries) = setup(
        "agents:\n  eris:\n    allow:\n      - { permission: cmd:invoke, ids: [\"desk.allowed\"] }\n",
    );
    for (id, args) in [(READ, json!({})), (OPEN, json!({ "plugin": HELLO }))] {
        let refused = invoke(&core, ERIS, id, args).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied);
        assert!(refused.message.contains("allowlist"), "{}", refused.message);
    }
    assert!(named(&deliveries, "perm.prompt").is_empty());
    assert!(named(&deliveries, "cmd.invoked").is_empty());
}

#[test]
fn eris_still_needs_approval_for_a_marked_command() {
    let (core, deliveries) = setup("");
    let id = "desk.windows.remove";
    register(&core, "desk", id, false, true);
    grant(&core, "desk", manage());
    grant(&core, ERIS, scope(id));
    let args = json!({ "window": "example.hello" });
    let (approval, result) = held(&core, &deliveries, "deny", || {
        invoke(&core, ERIS, id, args.clone())
    });
    assert_eq!(approval.data()["caller"], ERIS);
    assert_eq!(result.unwrap_err().code, ErrorCode::PermissionDenied);
    assert!(named(&deliveries, "cmd.invoked").is_empty());
}
