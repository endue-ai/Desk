//! App approvals have a conversation lifetime, and pointer motion needs no card.

use std::sync::Arc;
use std::sync::mpsc::Receiver;

use desk_brain::{Brain, ClientInfo, CreateSessionRequest};
use desk_brain_endue::HttpBrain;
use desk_bridge::ErrorCode;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};

use super::common::Echo;
use super::fake::*;
use super::support::*;

fn tool(method: &str, mut params: Value) -> String {
    params["scope"] = control(None);
    format!("tool computer.{method} as mira: {params}")
}

fn say(core: &Core, calls: Vec<String>) -> Value {
    call(
        core,
        "desk",
        "brain.say",
        json!({
            "text": calls.join("\n"), "scope": { "permission": "brain:converse" },
        }),
    )
    .unwrap()["turnId"]
        .clone()
}

fn complete(deliveries: &Receiver<Delivery>, turn: &Value) {
    loop {
        let seen = wait_for(deliveries, "brain.turn");
        if &seen.data()["turnId"] == turn && seen.data()["kind"] == "completed" {
            break;
        }
    }
}

fn status(core: &Core, caller: &str) -> Value {
    call(
        core,
        caller,
        "computer.permissions.status",
        json!({ "scope": see(None) }),
    )
    .unwrap()
}

fn click_at(x: f64) -> String {
    tool("input.click", json!({ "x": x, "y": 100.0 }))
}

#[test]
fn motion_is_free_and_an_app_allowance_survives_only_until_stop_or_a_new_conversation() {
    let echo = Echo::start();
    let (home, fake) = (home("computer-app-approval"), fake());
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let core = Arc::new(core(&home, &fake).with_brain(brain.clone(), BrainOptions::default()));
    core.route_tools();
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    grant(&core, "desk", control(None));
    grant(&core, MIRA, control(None));
    grant(&core, MIRA, see(None));
    grant(&core, PLUGIN, see(None));
    let deliveries = core.events().subscribe_addressed();

    let first = say(
        &core,
        vec![
            tool("input.move", json!({ "x": 100.0, "y": 100.0 })),
            tool("input.scroll", json!({ "dy": 2 })),
            click_at(100.0),
        ],
    );
    let card = wait_for(&deliveries, "perm.approval");
    assert_eq!(card.data()["action"], "computer.input.click");
    assert_eq!(card.data()["untilStopApp"], "Safari");
    assert_eq!(
        fake.posted().len(),
        2,
        "move and scroll happened before the first card"
    );
    approve_as_desk(&core, &card, "app");
    complete(&deliveries, &first);
    let now = status(&core, MIRA);
    assert_eq!(now["allowedApps"], json!([SAFARI]));
    assert_eq!(now["stopped"], false);
    assert!(now["accessibility"].is_boolean());
    assert!(now["screenRecording"].is_boolean());
    assert!(status(&core, PLUGIN).get("allowedApps").is_none());

    let second = say(
        &core,
        vec![
            click_at(120.0),
            click_at(900.0),
            tool(
                "input.drag",
                json!({ "from": { "x": 120.0, "y": 100.0 }, "to": { "x": 900.0, "y": 100.0 } }),
            ),
            tool("apps.quit", json!({ "pid": 412 })),
        ],
    );
    let other = wait_for(&deliveries, "perm.approval");
    assert_eq!(other.data()["untilStopApp"], "TextEdit");
    assert_eq!(fake.posted().len(), 8, "the next turn's Safari click ran");
    approve_as_desk(&core, &other, "deny");
    let drag = wait_for(&deliveries, "perm.approval");
    assert_eq!(drag.data()["action"], "computer.input.drag");
    assert_eq!(
        drag.data()["target"],
        "Safari (com.apple.Safari) to TextEdit (com.apple.TextEdit)"
    );
    assert!(drag.data()["untilStopApp"].is_null());
    assert!(drag.data()["task"].is_null());
    approve_as_desk(&core, &drag, "deny");
    let quit = wait_for(&deliveries, "perm.approval");
    assert_eq!(quit.data()["action"], "computer.apps.quit");
    assert!(quit.data()["untilStopApp"].is_null());
    assert!(quit.data()["task"].is_null());
    approve_as_desk(&core, &quit, "deny");
    complete(&deliveries, &second);
    assert_eq!(fake.running().len(), 2);

    call(
        &core,
        "desk",
        "computer.stop",
        json!({ "scope": control(None) }),
    )
    .unwrap();
    assert_eq!(status(&core, MIRA)["allowedApps"], json!([]));
    assert_eq!(status(&core, MIRA)["stopped"], true);
    let stopped = call(
        &core,
        MIRA,
        "computer.input.scroll",
        json!({ "dy": 2, "scope": control(None) }),
    );
    assert_eq!(stopped.unwrap_err().code, ErrorCode::Cancelled);
    core.resume_computer();
    let again = say(&core, vec![click_at(100.0)]);
    let fresh = wait_for(&deliveries, "perm.approval");
    assert_eq!(fresh.data()["untilStopApp"], "Safari");
    approve_as_desk(&core, &fresh, "app");
    complete(&deliveries, &again);

    let new = brain
        .create_session(&CreateSessionRequest {
            title: None,
            client: ClientInfo {
                name: "test".to_owned(),
                version: "0".to_owned(),
            },
        })
        .unwrap();
    core.open_session(&new.id).unwrap();
    assert_eq!(status(&core, MIRA)["allowedApps"], json!([]));
    let last = say(&core, vec![click_at(100.0)]);
    let fresh = wait_for(&deliveries, "perm.approval");
    assert_eq!(fresh.data()["untilStopApp"], "Safari");
    approve_as_desk(&core, &fresh, "deny");
    complete(&deliveries, &last);
}

#[test]
fn a_scroll_with_no_point_checks_the_real_pointer_app() {
    let (home, fake) = (home("computer-scroll-target"), fake());
    let core = core(&home, &fake);
    grant(&core, PLUGIN, control(None));
    grant(&core, MIRA, control(Some(&[SAFARI])));
    call(
        &core,
        PLUGIN,
        "computer.input.move",
        json!({
            "x": 900.0, "y": 100.0, "scope": control(None),
        }),
    )
    .unwrap();
    let before = fake.posted().len();
    let acted = call(
        &core,
        MIRA,
        "computer.input.scroll",
        json!({
            "dy": 2, "scope": control(Some(&[SAFARI])),
        }),
    );
    assert_eq!(acted.unwrap_err().code, ErrorCode::PermissionDenied);
    assert_eq!(fake.posted().len(), before);
}
