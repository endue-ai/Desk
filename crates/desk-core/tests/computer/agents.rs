//! An agent's act and a plugin's act on an agent's invocation wait for the person's approval
//! (ADR 0078) and are runs with a screenshot after them (ADR 0100); "Allow for this task" lets the
//! same app through until the turn ends, against examples/brain-echo.

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use desk_brain_endue::HttpBrain;
use desk_bridge::ErrorCode;
use desk_core::BrainOptions;
use serde_json::{Value, json};

use super::common::Echo;
use super::fake::*;
use super::support::*;

#[test]
fn an_agents_input_waits_for_approval_and_is_a_run_with_its_screenshot() {
    let (home, fake) = (home("computer-approve"), fake());
    let core = core(&home, &fake);
    let deliveries = core.events().subscribe_addressed();
    grant(&core, MIRA, control(None));
    let (approval, done) = held(&core, &deliveries, "once", || {
        let done = click(&core, MIRA, 100.0, control(None));
        assert!(!fake.posted().is_empty(), "it acted only once approved");
        done
    });
    let data = approval.data();
    assert_eq!(data["caller"], MIRA);
    assert_eq!(data["action"], "computer.input.click");
    assert_eq!(data["target"], "Safari (com.apple.Safari)");
    assert_eq!(
        data["preview"],
        json!({ "kind": "input", "text": "click left at (100, 100) in Safari" })
    );
    let done = done.unwrap();
    let run = runs(&core)
        .into_iter()
        .find(|r| r["id"] == done["runId"])
        .unwrap();
    assert_eq!(run["agent"], "mira");
    assert_eq!(run["state"], "done");
    assert_eq!(run["title"], "click left at (100, 100) in Safari");
    let step = &run["raw"]["computer"]["steps"][0];
    assert_eq!(step["ok"], true);
    let url = step["screenshot"].as_str().unwrap();
    assert_eq!(run["deepLink"], url);
    assert!(url.starts_with("file://") && url.ends_with(".png"), "{url}");
    let shots: Vec<_> = fs::read_dir(home.join("shots"))
        .unwrap()
        .flatten()
        .collect();
    assert_eq!(shots.len(), 1);

    let posted = fake.posted().len();
    let (_, denied) = held(&core, &deliveries, "deny", || {
        click(&core, MIRA, 100.0, control(None))
    });
    assert_eq!(denied.unwrap_err().code, ErrorCode::PermissionDenied);
    assert_eq!(fake.posted().len(), posted, "a denied act posts nothing");
    let states: Vec<Value> = runs(&core).iter().map(|r| r["state"].clone()).collect();
    assert_eq!(states, [json!("done"), json!("cancelled")]);
}

#[test]
fn a_plugins_act_on_an_agents_invocation_is_the_agents_and_waits_for_approval() {
    let (home, fake) = (home("computer-invoked"), fake());
    let core = core(&home, &fake);
    computer_plugin(&core, &home);
    let ids = json!({ "permission": "cmd:invoke", "ids": ["example.computer.click"] });
    grant(&core, MIRA, ids.clone());
    let deliveries = core.events().subscribe_addressed();
    let invoke = json!({ "id": "example.computer.click", "args": {}, "scope": ids });
    call(&core, MIRA, "cmd.invoke", invoke).unwrap();
    let invocation = wait_for(&deliveries, "cmd.invoked").data()["invocationId"].clone();

    let params =
        json!({ "x": 100.0, "y": 100.0, "invocationId": invocation, "scope": control(None) });
    let (approval, done) = held(&core, &deliveries, "once", || {
        call(&core, PLUGIN, "computer.input.click", params)
    });
    assert_eq!(
        approval.data()["caller"],
        MIRA,
        "the card names the agent, not the plugin"
    );
    let done = done.unwrap();
    let run = runs(&core)
        .into_iter()
        .find(|r| r["id"] == done["runId"])
        .unwrap();
    assert_eq!(
        run["command"], "example.computer.click",
        "the invocation's own run"
    );
    assert_eq!(run["state"], "running", "it ends with the plugin's answer");
    assert_eq!(
        run["raw"]["computer"]["steps"][0]["action"],
        "click left at (100, 100) in Safari"
    );

    let foreign = json!({ "x": 1.0, "y": 1.0, "invocationId": invocation, "scope": control(None) });
    grant(&core, NOTES, control(None));
    let refused = call(&core, NOTES, "computer.input.click", foreign).unwrap_err();
    assert_eq!(
        refused.code,
        ErrorCode::InvalidParams,
        "another plugin's invocation"
    );
}

#[test]
fn allow_for_this_task_lets_the_same_app_through_until_the_turn_ends() {
    let echo = Echo::start();
    let (home, fake) = (home("computer-task"), fake());
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let core = Arc::new(core(&home, &fake).with_brain(brain, options));
    core.route_tools();
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    grant(&core, MIRA, control(None));
    let deliveries = core.events().subscribe_addressed();
    let line = |x: f64| {
        let args = json!({ "x": x, "y": 100.0, "scope": control(None) });
        format!("tool computer.input.click as mira: {args}")
    };
    let text = [line(100.0), line(200.0), line(900.0)].join("\n");
    let said = call(
        &core,
        "desk",
        "brain.say",
        json!({ "text": text, "scope": { "permission": "brain:converse" } }),
    );
    let turn = said.unwrap()["turnId"].clone();
    let first = wait_for(&deliveries, "perm.approval");
    assert_eq!(first.data()["task"], turn);
    approve_as_desk(&core, &first, "task");
    let second = wait_for(&deliveries, "perm.approval");
    assert_eq!(
        second.data()["target"],
        "TextEdit (com.apple.TextEdit)",
        "Safari's second click passed"
    );
    approve_as_desk(&core, &second, "deny");
    loop {
        let seen = wait_for(&deliveries, "brain.turn");
        if seen.data()["turnId"] == turn && seen.data()["kind"] == "completed" {
            break;
        }
    }
    assert_eq!(
        fake.posted().len(),
        6,
        "two clicks in Safari, none in TextEdit"
    );
}

#[test]
fn a_plugins_acts_for_an_agent_in_one_turn_share_its_allow_for_this_task() {
    let echo = Echo::start();
    let (home, fake) = (home("computer-turn"), fake());
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let core = Arc::new(core(&home, &fake).with_brain(brain, options));
    core.route_tools();
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    computer_plugin(&core, &home);
    let ids = json!({ "permission": "cmd:invoke", "ids": ["example.computer.click"] });
    grant(&core, MIRA, ids);
    let deliveries = core.events().subscribe_addressed();
    let text = ["tool example_computer_click as mira: {}"; 2].join("\n");
    let params = json!({ "text": text, "scope": { "permission": "brain:converse" } });
    let turn = call(&core, "desk", "brain.say", params).unwrap()["turnId"].clone();
    let mut cards = Vec::new();
    std::thread::scope(|s| {
        loop {
            let seen = wait_for_any(&deliveries);
            match seen.name() {
                // The plugin clicks for each invocation and answers once the click is done.
                "cmd.invoked" => {
                    let invocation = seen.data()["invocationId"].clone();
                    let core = &core;
                    s.spawn(move || {
                        let act = json!({ "x": 100.0, "y": 100.0, "invocationId": invocation,
                            "scope": control(None) });
                        let done = call(core, PLUGIN, "computer.input.click", act).unwrap();
                        let answer = json!({ "invocationId": invocation, "result": done });
                        call(core, PLUGIN, "cmd.answer", answer).unwrap();
                    });
                }
                "perm.approval" => {
                    assert_eq!(seen.data()["task"], turn, "the act is in the agent's turn");
                    approve_as_desk(&core, &seen, "task");
                    cards.push(seen);
                }
                "brain.turn"
                    if seen.data()["turnId"] == turn && seen.data()["kind"] == "completed" =>
                {
                    break;
                }
                _ => {}
            }
        }
    });
    assert_eq!(cards.len(), 1, "the second click in Safari needed no card");
    assert_eq!(fake.posted().len(), 6);
}

/// The next delivery, whatever it is.
fn wait_for_any(deliveries: &std::sync::mpsc::Receiver<desk_core::Delivery>) -> Seen {
    let delivery = deliveries
        .recv_timeout(Duration::from_secs(10))
        .expect("a delivery within 10 s");
    Seen {
        to: delivery.to,
        event: serde_json::to_value(delivery.event).unwrap(),
    }
}

#[test]
fn no_agent_operates_the_desk_itself() {
    let home = home("computer-desk");
    let desk = std::process::id() as i32;
    let fake = Arc::new(desk_computer::fake::FakeComputer::new().with_apps(vec![app(
        desk,
        "endue Desk",
        "ai.endue.desk",
        true,
    )]));
    let core = core(&home, &fake);
    grant(&core, MIRA, control(None));
    let text = json!({ "text": "yes", "scope": control(None) });
    let refused = call(&core, MIRA, "computer.input.type", text.clone()).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert!(
        refused.message.contains("desk itself"),
        "{}",
        refused.message
    );
    assert!(fake.posted().is_empty(), "nothing reached the desk's cards");
    assert_eq!(runs(&core)[0]["state"], "failed");
    grant(&core, PLUGIN, control(None));
    call(&core, PLUGIN, "computer.input.type", text).unwrap();
}
