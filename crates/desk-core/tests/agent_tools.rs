//! The brain's tool calls routed through the core (CORE-14, ADR 0072), against examples/brain-echo:
//! `tool <name> as <agent>: <arguments>` makes brain-echo ask for that tool on behalf of that agent,
//! and the core runs it as `agent:<agent>`, prompting and logging as for any agent call. A brain.ask
//! turn's tool call is its caller's answer (ADR 0059) and never runs, whatever agent it names.

mod common;
mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::time::Duration;

use common::Echo;
use desk_brain::{
    Brain, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest,
    Session, StopReason, ToolCall, ToolCallEvent, ToolResultRequest, TurnCompletedEvent, TurnEvent,
    TurnRequest, TurnStartedEvent,
};
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

const NOTES_ONLY: &str = "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n      - { permission: cmd:invoke, ids: [\"notes.*\"] }\n";

/// A shared core on brain-echo whose tool calls it routes, with `desk` talking to the brain,
/// answering prompts and reading the log, and a router listening.
fn core(echo: &Echo, home: &Path) -> (Arc<Core>, Receiver<Delivery>) {
    core_on(Arc::new(HttpBrain::new(echo.url()).unwrap()), home)
}

fn core_on(brain: Arc<dyn Brain>, home: &Path) -> (Arc<Core>, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, NOTES_ONLY).unwrap();
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file)
        .with_brain(brain, options);
    let core = Arc::new(core);
    core.route_tools();
    for permission in ["brain:converse", "brain:ask", "perm:manage", "log:read"] {
        grant(&core, "desk", json!({ "permission": permission }));
    }
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn say(core: &Core, text: &str) -> String {
    let said = call(
        core,
        "desk",
        "brain.say",
        json!({ "text": text, "scope": { "permission": "brain:converse" } }),
    );
    said.unwrap()["turnId"].as_str().unwrap().to_owned()
}

/// The turn's answer once it completes; the other deliveries on the way are kept in `seen`.
fn answer(deliveries: &Receiver<Delivery>, turn: &str, seen: &mut Vec<Seen>) -> String {
    let mut text = String::new();
    loop {
        let delivery = wait_any(deliveries);
        let data = delivery.data().clone();
        if delivery.name() != "brain.turn" || data["turnId"] != turn {
            seen.push(delivery);
            continue;
        }
        match data["kind"].as_str().unwrap() {
            "delta" => text.push_str(data["text"].as_str().unwrap()),
            "completed" => return text,
            "error" => panic!("the turn failed: {data}"),
            _ => {}
        }
    }
}

fn wait_any(deliveries: &Receiver<Delivery>) -> Seen {
    let delivery = deliveries
        .recv_timeout(Duration::from_secs(10))
        .expect("a delivery within 10 s");
    Seen {
        to: delivery.to,
        event: serde_json::to_value(delivery.event).unwrap(),
    }
}

fn write_call(agent: Option<&str>, path: &str, scope: &str) -> String {
    let arguments = json!({
        "path": path, "content": "Buy milk", "createDirs": true,
        "scope": { "permission": "fs:write", "paths": [scope] },
    });
    match agent {
        Some(agent) => format!("tool fs.write as {agent}: {arguments}"),
        None => format!("tool fs.write: {arguments}"),
    }
}

fn perm_log(core: &Core) -> Vec<Value> {
    let tail = call(
        core,
        "desk",
        "log.tail",
        json!({ "channel": "perm", "scope": { "permission": "log:read" } }),
    );
    tail.unwrap()["entries"].as_array().unwrap().clone()
}

#[test]
fn a_tool_call_runs_as_its_agent_and_the_prompt_names_it() {
    let echo = Echo::start();
    let home = home("tools-prompt");
    let (core, deliveries) = core(&echo, &home);
    let turn = say(
        &core,
        &write_call(Some("mira"), "~/Notes/today.md", "~/Notes/**"),
    );

    let prompt = wait_for(&deliveries, "perm.prompt");
    assert_eq!(prompt.data()["caller"], "agent:mira");
    assert_eq!(
        prompt.data()["permission"],
        json!({ "permission": "fs:write", "paths": ["~/Notes/**"] })
    );
    let params = json!({ "promptId": prompt.data()["promptId"], "granted": true,
        "duration": "session", "scope": manage() });
    call(&core, "desk", "perm.answer", params).unwrap();
    // The write is irreversible: it waits for the person's approval too (ADR 0078).
    let approval = wait_for(&deliveries, "perm.approval");
    assert_eq!(approval.data()["caller"], "agent:mira");
    approve_as_desk(&core, &approval, "once");

    let said = answer(&deliveries, &turn, &mut Vec::new());
    assert!(said.contains("The fs.write tool said:"), "{said}");
    assert!(said.contains("bytesWritten"), "{said}");
    assert_eq!(
        fs::read_to_string(home.join("Notes/today.md")).unwrap(),
        "Buy milk"
    );
    let log = perm_log(&core);
    let allowed = log
        .iter()
        .find(|e| e["fields"]["decision"] == "allowed")
        .expect("the agent's call is logged");
    assert_eq!(allowed["fields"]["caller"], "agent:mira");
    assert_eq!(allowed["fields"]["target"], "~/Notes/today.md");
}

#[test]
fn a_tool_call_outside_the_allowlist_is_refused_with_outside_allowlist() {
    let echo = Echo::start();
    let home = home("tools-outside");
    let (core, deliveries) = core(&echo, &home);
    let turn = say(
        &core,
        &write_call(Some("mira"), "~/Desktop/x.txt", "~/Desktop/**"),
    );
    let mut seen = Vec::new();
    let said = answer(&deliveries, &turn, &mut seen);
    assert!(said.contains("The fs.write tool failed:"), "{said}");
    assert!(said.contains("outside-allowlist"), "{said}");
    assert!(!home.join("Desktop/x.txt").exists());
    assert!(
        seen.iter().all(|d| d.name() != "perm.prompt"),
        "nobody is asked"
    );
    let notice = seen
        .iter()
        .find(|d| d.name() == "ui.notified")
        .expect("a notice");
    assert!(notice.data()["title"].as_str().unwrap().contains("mira"));
}

#[test]
fn cmd_invoke_from_a_tool_call_carries_the_agent() {
    let echo = Echo::start();
    let home = home("tools-cmd");
    let (core, deliveries) = core(&echo, &home);
    let registered = json!({ "id": "notes.add", "title": "Add a note" });
    call(&core, NOTES, "cmd.register", registered).unwrap();
    grant(
        &core,
        "agent:mira",
        json!({ "permission": "cmd:invoke", "ids": ["notes.*"] }),
    );
    let arguments = json!({ "id": "notes.add", "args": { "text": "milk" },
        "scope": { "permission": "cmd:invoke", "ids": ["notes.add"] } });
    let turn = say(&core, &format!("tool cmd.invoke as mira: {arguments}"));

    let invoked = wait_for(&deliveries, "cmd.invoked");
    assert_eq!(invoked.to, strings(&[NOTES]));
    assert_eq!(invoked.data()["caller"], "agent:mira");
    assert_eq!(invoked.data()["args"], json!({ "text": "milk" }));
    let answered = json!({ "invocationId": invoked.data()["invocationId"],
        "result": { "added": "milk" } });
    call(&core, NOTES, "cmd.answer", answered).unwrap();

    let said = answer(&deliveries, &turn, &mut Vec::new());
    assert!(said.contains("The cmd.invoke tool said:"), "{said}");
    assert!(said.contains(r#""added":"milk""#), "{said}");
}

#[test]
fn a_tool_call_that_names_no_agent_only_echoes() {
    let echo = Echo::start();
    let home = home("tools-anonymous");
    let (core, deliveries) = core(&echo, &home);
    let turn = say(&core, &write_call(None, "~/Notes/today.md", "~/Notes/**"));
    let mut seen = Vec::new();
    let said = answer(&deliveries, &turn, &mut seen);
    assert!(said.contains("The fs.write tool failed:"), "{said}");
    assert!(!home.join("Notes/today.md").exists());
    assert!(seen.iter().all(|d| d.name() != "perm.prompt"));

    let turn = say(&core, "tool: ping");
    let said = answer(&deliveries, &turn, &mut Vec::new());
    assert_eq!(said, "Let me ask the echo tool. The echo tool said: ping");
}

/// brain-echo, except that a turn offering tools (brain.ask's) calls the first one with arguments
/// that would write `~/Notes/ask.md`, on behalf of mira; the tool results the core sends are counted.
struct AsksForMira {
    inner: HttpBrain,
    results: AtomicUsize,
}

/// Brain methods handed straight to brain-echo.
macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

impl Brain for AsksForMira {
    pass! {
        create_session(request: &CreateSessionRequest) -> Session;
        get_session(session: &str) -> Session;
        get_lease(session: &str) -> Lease;
        acquire_lease(session: &str, request: &LeaseAcquireRequest) -> Lease;
        renew_lease(session: &str, lease: &str, request: &LeaseRenewRequest) -> Lease;
        release_lease(session: &str, lease: &str) -> ();
    }
    fn create_turn(
        &self,
        session: &str,
        request: &TurnRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let Some(tool) = request.tools.as_ref().and_then(|tools| tools.first()) else {
            return self.inner.create_turn(session, request, on);
        };
        let turn_id = "turn-ask".to_owned();
        let arguments = json!({ "path": "~/Notes/ask.md", "content": "asked", "createDirs": true,
            "scope": { "permission": "fs:write", "paths": ["~/Notes/**"] } });
        let call = ToolCall {
            call_id: "call-ask".to_owned(),
            name: tool.name.clone(),
            arguments: arguments.as_object().cloned().unwrap(),
            agent_id: Some("mira".to_owned()),
        };
        on(TurnEvent::TurnStarted(TurnStartedEvent {
            r#type: Default::default(),
            turn_id: turn_id.clone(),
        }));
        on(TurnEvent::ToolCall(ToolCallEvent {
            r#type: Default::default(),
            turn_id: turn_id.clone(),
            call,
        }));
        on(TurnEvent::TurnCompleted(TurnCompletedEvent {
            r#type: Default::default(),
            turn_id,
            stop_reason: StopReason::ToolCall,
        }));
        Ok(())
    }
    fn submit_tool_result(
        &self,
        session: &str,
        turn: &str,
        request: &ToolResultRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.results.fetch_add(1, Ordering::SeqCst);
        self.inner.submit_tool_result(session, turn, request, on)
    }
}

#[test]
fn a_brain_ask_turn_hands_its_tool_call_back_and_runs_no_agent_tool() {
    let echo = Echo::start();
    let home = home("tools-ask");
    let brain = Arc::new(AsksForMira {
        inner: HttpBrain::new(echo.url()).unwrap(),
        results: AtomicUsize::new(0),
    });
    let (core, deliveries) = core_on(brain.clone(), &home);
    // Were the ask's call run, mira's grant would let it write without asking.
    grant(
        &core,
        "agent:mira",
        json!({ "permission": "fs:write", "paths": ["~/Notes/**"] }),
    );
    let params = json!({ "prompt": "Where does the note go?", "scope": { "permission": "brain:ask" },
        "tool": { "name": "fs.write", "description": "A note", "schema": { "type": "object" } } });
    let asked = call(&core, "desk", "brain.ask", params).unwrap();
    let turn = asked["turnId"].as_str().unwrap();

    let mut seen = Vec::new();
    let completed = loop {
        let delivery = wait_any(&deliveries);
        let data = delivery.data().clone();
        if delivery.name() == "brain.turn" && data["turnId"] == turn && data["kind"] == "completed"
        {
            break data;
        }
        seen.push(delivery);
    };
    assert_eq!(
        completed["structured"]["path"], "~/Notes/ask.md",
        "{completed}"
    );
    assert!(
        !home.join("Notes/ask.md").exists(),
        "the ask's tool call never runs"
    );
    assert_eq!(
        brain.results.load(Ordering::SeqCst),
        0,
        "no tool result is posted"
    );
    assert!(seen.iter().all(|d| d.name() != "perm.prompt"));
    let calls = perm_log(&core);
    assert!(
        calls.iter().all(|e| e["fields"]["decision"] == "granted"),
        "{calls:?}"
    );

    // The desk's conversation still runs mira's tool calls as mira, once the person approves the
    // write (ADR 0078).
    let turn = say(
        &core,
        &write_call(Some("mira"), "~/Notes/today.md", "~/Notes/**"),
    );
    let approval = wait_for(&deliveries, "perm.approval");
    approve_as_desk(&core, &approval, "once");
    let said = answer(&deliveries, &turn, &mut Vec::new());
    assert!(said.contains("The fs.write tool said:"), "{said}");
    assert_eq!(brain.results.load(Ordering::SeqCst), 1);
    assert!(home.join("Notes/today.md").exists());
}
