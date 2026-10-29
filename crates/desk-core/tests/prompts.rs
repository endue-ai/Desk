//! Prompting through events: perm.request becomes a perm.prompt to every perm:manage holder and
//! waits for the first perm.answer. With no holder the Prompter decides, as before.

mod support;

use std::sync::mpsc::Receiver;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

/// A core whose Prompter must never be asked, with `holders` holding perm:manage, and the
/// deliveries from before the first request.
fn prompted(home: &std::path::Path, holders: &[&str]) -> (Core, Receiver<Delivery>) {
    let core = Core::new(roots(home)).with_prompter(NeverAsk);
    for holder in holders {
        grant(&core, holder, manage());
    }
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn ask(core: &Core, caller: &str, duration: Option<&str>) -> Result<Value, BridgeError> {
    let mut params = json!({ "permission": notes_read(), "reason": "To open your notes" });
    if let Some(duration) = duration {
        params["duration"] = json!(duration);
    }
    call(core, caller, "perm.request", params)
}

fn answer(
    core: &Core,
    caller: &str,
    prompt: &Value,
    decision: Value,
) -> Result<Value, BridgeError> {
    let mut params = json!({ "promptId": prompt, "scope": manage() });
    params
        .as_object_mut()
        .unwrap()
        .extend(decision.as_object().cloned().unwrap());
    call(core, caller, "perm.answer", params)
}

#[test]
fn a_request_becomes_a_prompt_to_every_perm_manage_holder() {
    let home = home("prompt-holders");
    let (core, deliveries) = prompted(&home, &["endue.permissions", "desk"]);
    let asked = std::thread::scope(|s| {
        let asking = s.spawn(|| ask(&core, NOTES, Some("once")));
        let prompt = wait_for(&deliveries, "perm.prompt");
        assert_eq!(prompt.to, strings(&["desk", "endue.permissions"]));
        let data = prompt.data().clone();
        assert!(data["promptId"].as_str().unwrap().starts_with("p-"));
        assert_eq!(
            data,
            json!({ "promptId": data["promptId"], "caller": NOTES, "permission": notes_read(),
                    "reason": "To open your notes", "duration": "once" })
        );
        answer(
            &core,
            "desk",
            &data["promptId"],
            json!({ "granted": false }),
        )
        .unwrap();
        asking.join().unwrap()
    });
    assert_eq!(asked.unwrap(), json!({ "granted": false }));
    assert!(
        named(&deliveries, "perm.prompt").is_empty(),
        "one prompt only"
    );
}

#[test]
fn the_first_answer_decides_and_the_chosen_duration_wins() {
    let home = home("prompt-first");
    let (core, deliveries) = prompted(&home, &["desk", "endue.permissions"]);
    let (asked, prompt) = std::thread::scope(|s| {
        let asking = s.spawn(|| ask(&core, NOTES, Some("once")));
        let prompt = wait_for(&deliveries, "perm.prompt").data()["promptId"].clone();
        let decided = answer(
            &core,
            "desk",
            &prompt,
            json!({ "granted": true, "duration": "always" }),
        );
        assert_eq!(decided.unwrap(), json!({}));
        (asking.join().unwrap().unwrap(), prompt)
    });
    assert_eq!(asked["granted"], true);
    assert_eq!(asked["grant"]["duration"], "always");
    assert_eq!(asked["grant"]["permission"], notes_read());
    let changed = named(&deliveries, "perm.changed");
    assert_eq!(changed.len(), 1);
    assert_eq!(
        changed[0].data(),
        &json!({ "grantId": asked["grant"]["grantId"], "change": "granted" })
    );
    assert!(changed[0].is_for(NOTES));

    let late = answer(
        &core,
        "endue.permissions",
        &prompt,
        json!({ "granted": false }),
    );
    assert_eq!(late.unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(query(&core, NOTES), vec![asked["grant"].clone()]);
}

#[test]
fn an_answer_without_a_duration_keeps_the_one_asked() {
    let home = home("prompt-duration");
    let (core, deliveries) = prompted(&home, &["desk"]);
    for (asked, expected) in [(None, "session"), (Some("once"), "once")] {
        let granted = std::thread::scope(|s| {
            let asking = s.spawn(|| ask(&core, NOTES, asked));
            let prompt = wait_for(&deliveries, "perm.prompt");
            assert_eq!(prompt.data()["duration"], expected);
            let id = prompt.data()["promptId"].clone();
            answer(&core, "desk", &id, json!({ "granted": true })).unwrap();
            asking.join().unwrap().unwrap()
        });
        assert_eq!(granted["granted"], true);
        assert_eq!(granted["grant"]["duration"], expected);
    }
}

#[test]
fn a_refusal_is_a_result_not_an_error() {
    let home = home("prompt-refuse");
    let (core, deliveries) = prompted(&home, &["desk"]);
    let asked = std::thread::scope(|s| {
        let asking = s.spawn(|| ask(&core, NOTES, None));
        let id = wait_for(&deliveries, "perm.prompt").data()["promptId"].clone();
        answer(&core, "desk", &id, json!({ "granted": false })).unwrap();
        asking.join().unwrap()
    });
    assert_eq!(asked.unwrap(), json!({ "granted": false }));
    assert!(named(&deliveries, "perm.changed").is_empty());
    assert!(query(&core, NOTES).is_empty());
}

#[test]
fn answering_needs_perm_manage_and_unknown_prompts_are_not_found() {
    let home = home("prompt-answer");
    let (core, deliveries) = prompted(&home, &["desk"]);
    std::thread::scope(|s| {
        let asking = s.spawn(|| ask(&core, NOTES, None));
        let id = wait_for(&deliveries, "perm.prompt").data()["promptId"].clone();
        let denied = answer(&core, "example.other", &id, json!({ "granted": true }));
        let denied = denied.unwrap_err();
        assert_eq!(denied.code, ErrorCode::PermissionDenied);
        assert_eq!(serde_json::to_value(denied.permission).unwrap(), manage());
        let missing = answer(&core, "desk", &json!("p-404"), json!({ "granted": true }));
        assert_eq!(missing.unwrap_err().code, ErrorCode::NotFound);
        answer(&core, "desk", &id, json!({ "granted": false })).unwrap();
        assert_eq!(asking.join().unwrap().unwrap(), json!({ "granted": false }));
    });
    assert!(query(&core, "example.other").is_empty());
}

#[test]
fn without_a_perm_manage_holder_the_prompter_decides() {
    let home = home("prompt-prompter");
    let core = Core::new(roots(&home)).with_prompter(SayYes);
    let deliveries = core.events().subscribe_addressed();
    let granted = ask(&core, NOTES, None).unwrap();
    assert_eq!(granted["granted"], true);
    assert_eq!(granted["grant"]["duration"], "session");
    assert!(named(&deliveries, "perm.prompt").is_empty());

    let refusing = Core::new(roots(&home));
    let refusals = refusing.events().subscribe_addressed();
    assert_eq!(
        ask(&refusing, NOTES, Some("always")).unwrap(),
        json!({ "granted": false })
    );
    assert!(named(&refusals, "perm.prompt").is_empty());
}

#[test]
fn a_requester_that_unloads_withdraws_its_prompts() {
    let home = home("prompt-unload");
    let (core, deliveries) = prompted(&home, &["desk"]);
    grant(&core, "desk", plugin_manage());
    install_hello(&core, &home);
    let (asked, id) = std::thread::scope(|s| {
        let asking = s.spawn(|| ask(&core, "example.hello", None));
        let prompt = wait_for(&deliveries, "perm.prompt");
        assert_eq!(prompt.data()["caller"], "example.hello");
        set_enabled(&core, "example.hello", false);
        (asking.join().unwrap(), prompt.data()["promptId"].clone())
    });
    assert_eq!(asked.unwrap_err().code, ErrorCode::Cancelled);
    let late = answer(&core, "desk", &id, json!({ "granted": true }));
    assert_eq!(late.unwrap_err().code, ErrorCode::NotFound);
    assert!(query(&core, "example.hello").is_empty());
}

#[test]
fn when_the_last_holder_loses_perm_manage_the_prompter_decides() {
    let home = home("prompt-last");
    let core = Core::new(roots(&home));
    let held = grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let (asked, id) = std::thread::scope(|s| {
        let asking = s.spawn(|| ask(&core, NOTES, None));
        let prompt = wait_for(&deliveries, "perm.prompt");
        call(&core, "desk", "perm.revoke", json!({ "grantId": held })).unwrap();
        (asking.join().unwrap(), prompt.data()["promptId"].clone())
    });
    assert_eq!(
        asked.unwrap(),
        json!({ "granted": false }),
        "RefuseAll decided"
    );

    grant(&core, "endue.permissions", manage());
    let late = answer(&core, "endue.permissions", &id, json!({ "granted": true }));
    assert_eq!(late.unwrap_err().code, ErrorCode::NotFound);
    assert!(query(&core, NOTES).is_empty());
}

#[test]
fn a_prompt_nothing_can_route_goes_to_the_prompter() {
    // The app forwards plain events and has no router yet: a holder could never hear the prompt.
    let home = home("prompt-unrouted");
    let core = Core::new(roots(&home)).with_prompter(SayYes);
    grant(&core, "endue.permissions", manage());
    let plain = core.events().subscribe();
    let granted = ask(&core, NOTES, Some("once")).unwrap();
    assert_eq!(granted["grant"]["duration"], "once");
    let names: Vec<Value> = plain
        .try_iter()
        .map(|e| serde_json::to_value(e).unwrap()["event"].clone())
        .collect();
    assert!(!names.contains(&json!("perm.prompt")), "{names:?}");

    let refusing = Core::new(roots(&home));
    grant(&refusing, "desk", manage());
    drop(refusing.events().subscribe_addressed());
    assert_eq!(
        ask(&refusing, NOTES, None).unwrap(),
        json!({ "granted": false }),
        "a router that went away routes nothing"
    );
}
