//! perm.request with `again` (ADR 0335): a refusal the person made is remembered for the session and
//! answers the same request at once (CORE-03), until the caller asks again because the person pressed
//! its Allow button: that request prompts once more, and its answer decides. Prompts go to `desk`,
//! which holds perm:manage; every prompt a test causes is answered.

mod support;

use std::sync::mpsc::Receiver;
use std::time::Duration;

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

fn prompted(tag: &str) -> (Core, Receiver<Delivery>) {
    let core = Core::new(roots(&home(tag))).with_prompter(NeverAsk);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn documents() -> Value {
    json!({ "permission": "fs:read", "paths": ["~/Documents/**"] })
}

/// perm.request as NOTES with `extra` merged in; every prompt it causes is answered `granted`.
/// Returns the answer and how many prompts went out.
fn ask(core: &Core, deliveries: &Receiver<Delivery>, extra: Value, granted: bool) -> (Value, usize) {
    let mut params = json!({ "permission": documents(), "reason": "To show your files" });
    if let (Some(params), Some(extra)) = (params.as_object_mut(), extra.as_object()) {
        params.extend(extra.clone());
    }
    std::thread::scope(|s| {
        let asking = s.spawn(|| call(core, NOTES, "perm.request", params.clone()));
        let mut prompts = 0;
        loop {
            let finished = asking.is_finished();
            for prompt in drain(deliveries).iter().filter(|d| d.name() == "perm.prompt") {
                prompts += 1;
                let answer = json!({
                    "id": 1,
                    "method": "perm.answer",
                    "params": {
                        "promptId": prompt.data()["promptId"].clone(),
                        "granted": granted,
                        "scope": manage(),
                    },
                });
                let request: BridgeRequest = serde_json::from_value(answer).unwrap();
                assert!(matches!(
                    core.handle("desk", request),
                    BridgeResponse::BridgeSuccess(_)
                ));
            }
            if finished {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        (asking.join().unwrap().unwrap(), prompts)
    })
}

#[test]
fn a_request_with_again_asks_the_person_once_more_after_a_refusal() {
    let (core, deliveries) = prompted("prompt-again");
    let (first, prompts) = ask(&core, &deliveries, json!({}), false);
    assert_eq!((&first["granted"], prompts), (&json!(false), 1));

    // Without `again` the refusal answers at once: nobody is asked.
    let (earlier, prompts) = ask(&core, &deliveries, json!({}), true);
    assert_eq!(
        (earlier, prompts),
        (json!({ "granted": false, "reason": "refused-earlier" }), 0)
    );

    // With it the person is asked again; refused again, it is remembered again.
    let (refused, prompts) = ask(&core, &deliveries, json!({ "again": true }), false);
    assert_eq!((&refused["granted"], prompts), (&json!(false), 1));
    assert!(refused.get("reason").is_none(), "{refused}");
    let (earlier, prompts) = ask(&core, &deliveries, json!({}), true);
    assert_eq!((&earlier["reason"], prompts), (&json!("refused-earlier"), 0));

    // Allowed this time, the grant answers the next request without a prompt.
    let (allowed, prompts) = ask(&core, &deliveries, json!({ "again": true }), true);
    assert_eq!((&allowed["granted"], prompts), (&json!(true), 1));
    let (covered, prompts) = ask(&core, &deliveries, json!({}), false);
    assert_eq!((&covered["granted"], prompts), (&json!(true), 0));
}

#[test]
fn again_false_is_the_plain_request() {
    let (core, deliveries) = prompted("prompt-again-false");
    ask(&core, &deliveries, json!({}), false);
    let (earlier, prompts) = ask(&core, &deliveries, json!({ "again": false }), true);
    assert_eq!((&earlier["reason"], prompts), (&json!("refused-earlier"), 0));
}
