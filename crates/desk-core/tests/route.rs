//! FrameRouter: each frame gets the events of the calls it made; shared events go to every frame.

use desk_bridge::{BridgeEvent, BridgeResponse};
use desk_core::{Delivery, FrameRouter};
use serde_json::json;

fn event(value: serde_json::Value) -> BridgeEvent {
    serde_json::from_value(value).unwrap()
}

fn answered(result: serde_json::Value) -> BridgeResponse {
    serde_json::from_value(json!({ "id": 1, "ok": true, "result": result })).unwrap()
}

fn output(proc_id: &str, data: &str) -> BridgeEvent {
    event(json!({ "event": "proc.output",
        "data": { "procId": proc_id, "stream": "pty", "data": data, "encoding": "utf8" } }))
}

fn exit(proc_id: &str) -> BridgeEvent {
    event(json!({ "event": "proc.exit", "data": { "procId": proc_id, "code": 0 } }))
}

#[test]
fn owned_events_go_to_the_frame_that_made_the_call() {
    let mut router = FrameRouter::new();
    router.claim(
        "frame-2",
        "proc.spawn",
        &answered(json!({ "procId": "p1" })),
    );
    router.claim("main", "fs.watch", &answered(json!({ "watchId": "w1" })));
    assert_eq!(
        router.route(&output("p1", "x")),
        Delivery::To("frame-2".into())
    );
    let changed = event(json!({ "event": "fs.changed",
        "data": { "watchId": "w1", "path": "~/a", "change": "modified" } }));
    assert_eq!(router.route(&changed), Delivery::To("main".into()));
}

#[test]
fn shared_events_go_to_every_frame() {
    let mut router = FrameRouter::new();
    let changed = event(json!({ "event": "plugin.changed",
        "data": { "plugin": "endue.eris", "change": "updated", "revision": 2 } }));
    assert_eq!(router.route(&changed), Delivery::All);
}

#[test]
fn early_events_wait_for_the_answer_and_then_go_in_order() {
    let mut router = FrameRouter::new();
    assert_eq!(router.route(&output("p1", "a")), Delivery::Held);
    assert_eq!(router.route(&output("p1", "b")), Delivery::Held);
    let early = router.claim(
        "frame-2",
        "proc.spawn",
        &answered(json!({ "procId": "p1" })),
    );
    assert_eq!(early, vec![output("p1", "a"), output("p1", "b")]);
    assert_eq!(
        router.route(&output("p1", "c")),
        Delivery::To("frame-2".into())
    );
}

#[test]
fn the_last_event_ends_ownership_and_a_closed_frame_gets_nothing() {
    let mut router = FrameRouter::new();
    router.claim("main", "proc.spawn", &answered(json!({ "procId": "p1" })));
    assert_eq!(router.route(&exit("p1")), Delivery::To("main".into()));
    assert_eq!(router.route(&output("p1", "late")), Delivery::Held);

    router.claim("frame-2", "brain.say", &answered(json!({ "turnId": "t1" })));
    router.frame_closed("frame-2");
    let delta = event(json!({ "event": "brain.turn",
        "data": { "turnId": "t1", "kind": "delta", "text": "hi" } }));
    assert_eq!(router.route(&delta), Delivery::Held);
}

#[test]
fn failed_calls_and_other_methods_claim_nothing() {
    let mut router = FrameRouter::new();
    let failed: BridgeResponse = serde_json::from_value(json!({ "id": 1, "ok": false,
        "error": { "code": "permission_denied", "message": "no" } }))
    .unwrap();
    assert!(router.claim("main", "proc.spawn", &failed).is_empty());
    router.claim("main", "fs.read", &answered(json!({ "procId": "p9" })));
    assert_eq!(router.route(&output("p9", "x")), Delivery::Held);
}

#[test]
fn request_heads_name_the_method_without_the_params() {
    let request: desk_bridge::BridgeRequest = serde_json::from_value(json!({
        "id": 7, "method": "fs.write",
        "params": { "path": "~/a", "content": "x", "scope": { "permission": "fs:write", "paths": ["~/**"] } }
    }))
    .unwrap();
    assert_eq!(desk_core::request_head(&request), (7, "fs.write"));
}
