//! Ordinary contract validation must not consume an artificially accelerated lease.
mod support;

use std::thread;
use std::time::Duration;

use serde_json::json;
use support::{Contract, Echo, Wire, kinds, said, text};

#[test]
fn a_conversation_lease_survives_a_validation_pause() {
    let echo = Echo::start();
    let wire = Wire::new(&echo);
    let contract = Contract::new();
    let session = wire.session();
    let (status, lease) = wire.call(
        "POST",
        &format!("/sessions/{session}/lease"),
        Some(json!({ "holder": { "deskId": "desk-a" }, "ttlSeconds": 60 })),
    );
    assert_eq!(status, 200);
    contract.check("Lease", &lease);
    assert_eq!(lease["ttlSeconds"], 60);
    let lease_id = lease["leaseId"].as_str().unwrap();

    // Model a loaded runner validating schemas, beyond the old fixture's 1.2-second lifetime.
    // This is a lower-bound pause, not a performance deadline or a changed lease TTL.
    thread::sleep(Duration::from_millis(1500));
    let events = wire.stream(
        &format!("/sessions/{session}/turns"),
        said("hello", lease_id),
    );
    for event in &events {
        contract.check("TurnEvent", event);
    }
    assert_eq!(
        kinds(&events),
        ["turn.started", "text.delta", "turn.completed"]
    );
    assert_eq!(text(&events), "hello");
    assert_eq!(events.last().unwrap()["stopReason"], "end_turn");
    let (status, current) = wire.call("GET", &format!("/sessions/{session}/lease"), None);
    assert_eq!(
        status, 200,
        "the conversation lease expired during validation: {current}"
    );
    contract.check("Lease", &current);
    assert_eq!(current["leaseId"], lease["leaseId"]);
}
