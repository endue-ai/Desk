//! Disconnect evidence may cross two threads; neither delivery order may lose an event.

use std::sync::mpsc::{self, Receiver};

use desk_core::Delivery;
use serde_json::{Value, json};

#[path = "layer/event_observation.rs"]
mod event_observation;
use event_observation::{Observed, collect_disconnect};
const CONNECTOR: &str = "example.notes";
const INSTANCE: &str = "work";

fn observe(receiver: &Receiver<Delivery>) -> Result<Vec<Observed>, String> {
    collect_disconnect(receiver, CONNECTOR, INSTANCE)
}

fn status(change: &str) -> Value {
    let mut event = json!({
        "event": "connector.changed",
        "data": { "connector": CONNECTOR, "instance": INSTANCE, "change": change }
    });
    if change != "disconnected" {
        event["data"]["status"] = json!({ "state": "connected" });
    }
    event
}

fn removal(connector: &str) -> Value {
    json!({
        "event": "data.changed",
        "data": { "subscriptionId": "d-1", "changes": [{
            "change": "removed", "source": { "connector": connector, "instance": INSTANCE },
            "id": "alpha.md"
        }] }
    })
}

fn stream(events: &[Value]) -> Receiver<Delivery> {
    let (sender, receiver) = mpsc::channel();
    for event in events {
        sender
            .send(Delivery {
                to: Some(vec!["desk".to_owned()]),
                event: serde_json::from_value(event.clone()).unwrap(),
            })
            .unwrap();
    }
    receiver
}

#[test]
fn disconnect_and_removal_are_retained_in_either_delivery_order() {
    for events in [
        vec![
            status("disconnected"),
            status("updated"),
            removal(CONNECTOR),
        ],
        vec![
            removal(CONNECTOR),
            status("updated"),
            status("disconnected"),
        ],
    ] {
        let observed = observe(&stream(&events)).unwrap();
        let expected: Vec<_> = events
            .into_iter()
            .map(|event| (Some(vec!["desk".to_owned()]), event))
            .collect();
        assert_eq!(observed, expected);
    }
}

#[test]
fn other_sources_and_updated_status_do_not_replace_disconnection_evidence() {
    let events = [
        removal("example.other"),
        status("updated"),
        status("disconnected"),
        removal(CONNECTOR),
    ];
    let observed = observe(&stream(&events)).unwrap();
    assert_eq!(observed.len(), events.len());
    assert_eq!(observed.last().unwrap().1, removal(CONNECTOR));
}

#[test]
fn a_closed_incomplete_stream_reports_missing_evidence() {
    let error = observe(&stream(&[removal(CONNECTOR), status("updated")])).unwrap_err();
    assert!(error.contains("disconnected"), "{error}");
    assert!(error.contains(CONNECTOR), "{error}");
    assert!(error.contains(INSTANCE), "{error}");
}
