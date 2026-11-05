//! Eris hands work to the local agents (ADR 0088, 0099), with the real `plugins/local-agents`
//! manifest: `endue.local-agents.ask` is read-only, so `agent:eris` runs it without approval;
//! `endue.local-agents.work` is irreversible, so her call waits for the person and, refused, never
//! reaches the plugin. On brain-echo, a line that names a local agent goes to it through Eris's loop
//! (ADR 0089) and comes back as an errand. The plugin's side is played here: it registers the
//! commands by id and title (the manifest gives the rest) and answers what it is asked.

mod common;
mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use common::Echo;
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

const PLUGIN: &str = "endue.local-agents";
const ERIS: &str = "agent:eris";
const ASK: &str = "endue.local-agents.ask";
const WORK: &str = "endue.local-agents.work";

fn plugin_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/local-agents")
}

/// The plugin's two commands, registered by id and title as the plugin does.
fn register(core: &Core) {
    let titles = [
        (ASK, "Local agents: ask an agent"),
        (WORK, "Local agents: hand an agent a task"),
    ];
    for (id, title) in titles {
        let params = json!({ "id": id, "title": title });
        call(core, PLUGIN, "cmd.register", params).unwrap();
    }
}

/// A core with the plugin installed and its two commands registered, `desk` holding perm:manage,
/// Eris granted both commands (so only approvals stop her), and a router listening.
fn core(tag: &str) -> (Core, Receiver<Delivery>) {
    let home = home(tag);
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    core.install_plugin(&plugin_dir(), true);
    register(&core);
    grant(&core, "desk", manage());
    grant(
        &core,
        ERIS,
        json!({ "permission": "cmd:invoke", "ids": [ASK, WORK] }),
    );
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn invoke(core: &Core, id: &str, args: Value) -> Result<Value, desk_bridge::BridgeError> {
    let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
    let params = json!({ "id": id, "args": args, "scope": scope });
    call(core, ERIS, "cmd.invoke", params)
}

/// Answer the plugin's next `cmd.invoked` with `reply`, then wait for `cmd.answered`.
fn plugin_answers(core: &Core, deliveries: &Receiver<Delivery>, reply: Value) -> (Value, Value) {
    let invoked = wait_for(deliveries, "cmd.invoked");
    assert_eq!(invoked.to, strings(&[PLUGIN]));
    let data = invoked.data().clone();
    let answer = json!({ "invocationId": data["invocationId"], "result": reply });
    call(core, PLUGIN, "cmd.answer", answer).unwrap();
    let answered = wait_for(deliveries, "cmd.answered");
    (data, answered.data().clone())
}

#[test]
fn the_manifest_offers_ask_read_only_and_work_irreversible() {
    let (core, _) = core("local-agents-tools");
    let tools = call(&core, ERIS, "cmd.tools", json!({ "query": "local agents" })).unwrap();
    let tools = tools["tools"].as_array().unwrap();
    let tool = |id: &str| tools.iter().find(|t| t["command"] == id).cloned().unwrap();
    assert_eq!(tool(ASK)["readOnly"], true);
    assert_eq!(tool(ASK).get("irreversible"), None);
    assert_eq!(tool(WORK)["irreversible"], true);
    assert!(tool(WORK)["argsSchema"]["properties"]["folder"].is_object());
}

#[test]
fn eris_asks_a_local_agent_without_approval() {
    let (core, deliveries) = core("local-agents-ask");
    let args = json!({ "agent": "claude", "prompt": "Which tests fail?", "folder": "desk" });
    invoke(&core, ASK, args.clone()).unwrap();
    let reply = json!({ "agent": "claude", "answer": "Two tests fail.", "ending": "done" });
    let (invoked, answered) = plugin_answers(&core, &deliveries, reply.clone());
    assert_eq!(invoked["caller"], ERIS);
    assert_eq!(invoked["args"], args);
    assert_eq!(answered["ok"], true);
    assert_eq!(answered["result"], reply);
    let approvals = named(&deliveries, "perm.approval");
    assert!(approvals.is_empty(), "a read-only ask needs no approval");
}

#[test]
fn eris_waits_for_approval_before_a_local_agent_works() {
    let (core, deliveries) = core("local-agents-work");
    let args = json!({ "agent": "codex", "prompt": "Run the tests and fix them" });
    let work = || invoke(&core, WORK, args.clone());
    let (approval, started) = held(&core, &deliveries, "once", work);
    let data = approval.data();
    assert_eq!(data["caller"], ERIS);
    assert_eq!(data["target"], WORK);
    started.unwrap();
    let reply = json!({ "agent": "codex", "answer": "Fixed two tests.", "ending": "done" });
    let (invoked, answered) = plugin_answers(&core, &deliveries, reply);
    assert_eq!(invoked["args"], args);
    assert_eq!(answered["result"]["answer"], "Fixed two tests.");

    let (_, refused) = held(&core, &deliveries, "deny", work);
    assert!(refused.is_err(), "a refused call fails");
    std::thread::sleep(Duration::from_millis(50));
    assert!(
        named(&deliveries, "cmd.invoked").is_empty(),
        "the plugin never hears it"
    );
}

#[test]
fn brain_echo_asks_the_local_agent_a_line_names() {
    let echo = Echo::start();
    let home = home("local-agents-echo");
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let core = Core::new(roots(&home))
        .with_prompter(SayYes)
        .with_brain(brain, options);
    core.install_plugin(&plugin_dir(), true);
    let core = Arc::new(core);
    core.route_tools();
    register(&core);
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    let deliveries = core.events().subscribe_addressed();
    let line = "Ask Claude to run this repo's tests";
    let params = json!({ "text": line, "scope": { "permission": "brain:converse" } });
    let said = call(&core, "desk", "brain.say", params).unwrap();
    let turn = said["turnId"].clone();

    let mut steps = Vec::new();
    loop {
        let delivery = deliveries.recv_timeout(Duration::from_secs(10)).unwrap();
        let seen = serde_json::to_value(&delivery.event).unwrap();
        let data = seen["data"].clone();
        if seen["event"] == "cmd.invoked" {
            assert_eq!(data["id"], ASK);
            assert_eq!(data["caller"], ERIS);
            assert_eq!(data["args"], json!({ "agent": "claude", "prompt": line }));
            let reply = json!({ "agent": "claude", "answer": "All 12 tests pass." });
            let answered = json!({ "invocationId": data["invocationId"], "result": reply });
            call(&core, PLUGIN, "cmd.answer", answered).unwrap();
        } else if seen["event"] == "brain.turn" && data["turnId"] == turn {
            let kind = data["kind"].as_str().unwrap_or("").to_owned();
            assert_ne!(kind, "error", "{data}");
            steps.push(data);
            if kind == "completed" {
                break;
            }
        }
    }
    let tool = steps
        .iter()
        .find(|s| s["kind"] == "tool")
        .unwrap_or_else(|| panic!("no hand-off in {steps:?}"));
    assert_eq!(tool["tool"]["command"], ASK);
    assert!(steps.iter().any(|s| s["kind"] == "tool-result"));
    let text: String = steps.iter().filter_map(|s| s["text"].as_str()).collect();
    assert!(text.contains("All 12 tests pass."), "{text}");
}
