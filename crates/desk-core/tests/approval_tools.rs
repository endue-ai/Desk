//! Approvals for the brain's tool calls (ADR 0078), against examples/brain-echo: a message of several
//! `tool <name> as <agent>: <arguments>` lines makes one turn with one call per line, so "Allow for
//! this task" can be seen letting the rest of the turn through.

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
use serde_json::json;
use support::*;

const NOTES_ONLY: &str =
    "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n";

/// A shared core on brain-echo that routes its tool calls, with `desk` talking to the brain and
/// answering prompts and approvals, and `agent:mira` holding a session grant for `~/Notes/**`.
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
    for permission in ["brain:converse", "perm:manage"] {
        grant(&core, "desk", json!({ "permission": permission }));
    }
    let notes = json!({ "permission": "fs:write", "paths": ["~/Notes/**"] });
    grant(&core, "agent:mira", notes);
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

/// `tool fs.write as mira:` writing `text` to `~/Notes/<name>`.
fn write_line(name: &str, text: &str) -> String {
    let arguments = json!({ "path": format!("~/Notes/{name}"), "content": text,
        "createDirs": true, "scope": { "permission": "fs:write", "paths": ["~/Notes/**"] } });
    format!("tool fs.write as mira: {arguments}")
}

fn approve(core: &Core, approval: &Seen, answer: &str) {
    let params = json!({ "approvalId": approval.data()["approvalId"], "answer": answer,
        "scope": manage() });
    call(core, "desk", "perm.approve", params).unwrap();
}

/// The turn's answer once it completes; other deliveries on the way are kept in `seen`.
fn answer(deliveries: &Receiver<Delivery>, turn: &str, seen: &mut Vec<Seen>) -> String {
    let mut text = String::new();
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .expect("a delivery within 10 s");
        let delivery = Seen {
            to: delivery.to,
            event: serde_json::to_value(delivery.event).unwrap(),
        };
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

#[test]
fn allow_for_this_task_lets_the_rest_of_the_turn_through() {
    let echo = Echo::start();
    let home = home("approve-task-turn");
    let (core, deliveries) = core(&echo, &home);
    let two = format!(
        "{}\n{}",
        write_line("a.md", "first"),
        write_line("b.md", "second")
    );
    let turn = say(&core, &two);

    let approval = wait_for(&deliveries, "perm.approval");
    assert_eq!(approval.data()["caller"], "agent:mira");
    assert_eq!(approval.data()["target"], "~/Notes/a.md");
    assert_eq!(approval.data()["task"], turn.as_str());
    approve(&core, &approval, "task");
    let mut seen = Vec::new();
    let said = answer(&deliveries, &turn, &mut seen);
    assert!(
        seen.iter().all(|d| d.name() != "perm.approval"),
        "the second write is not asked about: {seen:?}"
    );
    assert_eq!(said.matches("The fs.write tool said:").count(), 2, "{said}");
    assert_eq!(
        fs::read_to_string(home.join("Notes/a.md")).unwrap(),
        "first"
    );
    assert_eq!(
        fs::read_to_string(home.join("Notes/b.md")).unwrap(),
        "second"
    );

    // The task ended with its turn: the next turn asks again.
    let next = say(&core, &write_line("c.md", "third"));
    let approval = wait_for(&deliveries, "perm.approval");
    assert_eq!(approval.data()["task"], next.as_str());
    approve(&core, &approval, "once");
    answer(&deliveries, &next, &mut Vec::new());
    assert_eq!(
        fs::read_to_string(home.join("Notes/c.md")).unwrap(),
        "third"
    );
}

#[test]
fn a_denied_tool_call_tells_the_brain_why() {
    let echo = Echo::start();
    let home = home("approve-tool-deny");
    let (core, deliveries) = core(&echo, &home);
    let turn = say(&core, &write_line("a.md", "nope"));
    let approval = wait_for(&deliveries, "perm.approval");
    approve(&core, &approval, "deny");
    let said = answer(&deliveries, &turn, &mut Vec::new());
    assert!(said.contains("The fs.write tool failed:"), "{said}");
    assert!(said.contains("not-approved"), "{said}");
    assert!(!home.join("Notes/a.md").exists());
}
