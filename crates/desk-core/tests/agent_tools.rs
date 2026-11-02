//! The brain's tool calls routed through the core (CORE-14, ADR 0072), against examples/brain-echo:
//! `tool <name> as <agent>: <arguments>` makes brain-echo ask for that tool on behalf of that agent,
//! and the core runs it as `agent:<agent>`, prompting and logging as for any agent call.

mod common;
mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use common::Echo;
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

const NOTES_ONLY: &str = "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n      - { permission: cmd:invoke, ids: [\"notes.*\"] }\n";

/// A shared core on brain-echo whose tool calls it routes, with `desk` talking to the brain,
/// answering prompts and reading the log, and a router listening.
fn core(echo: &Echo, home: &Path) -> (Arc<Core>, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, NOTES_ONLY).unwrap();
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file)
        .with_brain(brain, options);
    let core = Arc::new(core);
    core.route_tools();
    for permission in ["brain:converse", "perm:manage", "log:read"] {
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
