//! Browser action approvals bind the view and site observed by the core.

use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Delivery};

use super::common::Echo;
use super::support::{
    NeverAsk, Seen, approve_as_desk, manage, plugin_manage, set_enabled, wait_for,
};
use super::*;

fn say(core: &Core, calls: &[(&str, Value)]) -> Value {
    let text = calls
        .iter()
        .map(|(name, args)| format!("tool endue_browser_{name} as mira: {args}"))
        .collect::<Vec<_>>()
        .join("\n");
    call(
        core,
        "desk",
        "brain.say",
        json!({
            "text": text, "scope": { "permission": "brain:converse" }
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

fn expect_card(deliveries: &Receiver<Delivery>, turn: &Value, target: &str) -> Seen {
    let card = wait_for(deliveries, "perm.approval");
    assert_eq!(card.data()["action"], "web.act");
    assert_eq!(card.data()["caller"], "agent:mira");
    assert_eq!(card.data()["target"], target);
    assert_eq!(&card.data()["task"], turn);
    card
}

#[test]
fn a_task_covers_different_browser_acts_only_in_the_reviewed_view_and_site() {
    let echo = Echo::start();
    let pages = Arc::new(Pages::default());
    let core = Arc::new(core_with(&pages).with_prompter(NeverAsk).with_brain(
        Arc::new(HttpBrain::new(echo.url()).unwrap()),
        BrainOptions::default(),
    ));
    core.route_tools();
    let plugin = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/browser");
    let installed = core.install_plugin(&plugin, true);
    assert!(installed.built_in);
    grant(&core, "desk", plugin_manage());
    set_enabled(&core, BROWSER, true);
    grant(&core, "desk", manage());
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    for name in ["click", "type", "key"] {
        call(
            &core,
            BROWSER,
            "cmd.register",
            json!({
                "id": format!("endue.browser.{name}"), "title": name,
            }),
        )
        .unwrap();
    }
    let main = view_at(&core, BROWSER, "https://example.com/first");
    let opened = call(
        &core,
        BROWSER,
        "web.open",
        json!({
            "url": "https://example.org/", "surface": "second.endue-browser", "scope": browse(),
        }),
    )
    .unwrap();
    let second = opened["viewId"].as_str().unwrap();
    shows(&core, second, "https://example.org/");
    let deliveries = core.events().subscribe_addressed();
    let calls = [
        ("click", json!({ "ref": "e1" })),
        ("type", json!({ "text": "test" })),
        ("click", json!({ "ref": "e1" })),
        ("click", json!({ "ref": "e1" })),
        ("key", json!({ "key": "Tab" })),
    ];
    let turn = say(&core, &calls);
    let press = json!({ "do": "press", "ref": "e1" });
    std::thread::scope(|threads| {
        let run = |view: &str, action: Value, expected: Option<ErrorCode>| {
            let invoked = wait_for(&deliveries, "cmd.invoked");
            let id = &invoked.data()["invocationId"];
            let params =
                json!({ "viewId": view, "action": action, "invocationId": id, "scope": control() });
            let id = id.clone();
            let core = &core;
            threads.spawn(move || {
                if params["action"]["do"] == "press" {
                    let mut wrong = params.clone();
                    wrong["action"] = json!({ "do": "key", "key": "Tab" });
                    assert_eq!(call(core, BROWSER, "web.act", wrong).unwrap_err().code, ErrorCode::InvalidParams);
                }
                let result = call(core, BROWSER, "web.act", params.clone());
                assert_eq!(call(core, BROWSER, "web.act", params).unwrap_err().code, ErrorCode::InvalidParams);
                let answer = if let Some(code) = expected {
                    assert_eq!(result.unwrap_err().code, code);
                    json!({ "invocationId": id, "error": { "code": "failed", "message": "page moved" } })
                } else {
                    json!({ "invocationId": id, "result": result.unwrap() })
                };
                call(core, BROWSER, "cmd.answer", answer).unwrap();
            })
        };
        let first_act = run(&main, press.clone(), None);
        let first = expect_card(&deliveries, &turn, "https://example.com");
        approve_as_desk(&core, &first, "task");
        first_act.join().unwrap();
        shows(&core, &main, "https://example.com/second");
        run(&main, json!({ "do": "type", "text": "test" }), None)
            .join()
            .unwrap();

        shows(&core, &main, "https://example.net/");
        run(&main, press.clone(), Some(ErrorCode::Cancelled));
        let moved = expect_card(&deliveries, &turn, "https://example.net");
        shows(&core, &main, "https://example.org/");
        approve_as_desk(&core, &moved, "task");

        run(&main, press.clone(), None);
        let new_site = expect_card(&deliveries, &turn, "https://example.org");
        approve_as_desk(&core, &new_site, "task");
        run(second, json!({ "do": "key", "key": "Tab" }), None);
        let other_view = expect_card(&deliveries, &turn, "https://example.org");
        approve_as_desk(&core, &other_view, "task");
        complete(&deliveries, &turn);

        let next = say(&core, &calls[..1]);
        run(&main, press, None);
        let fresh = expect_card(&deliveries, &next, "https://example.org");
        approve_as_desk(&core, &fresh, "once");
        complete(&deliveries, &next);
    });
    let asked = pages.asked();
    assert_eq!(asked.len(), 5, "{asked:?}");
    assert!(asked[1].contains("https://example.com/second"), "{asked:?}");
    assert!(
        asked.iter().all(|act| !act.contains("example.net")),
        "{asked:?}"
    );
}
