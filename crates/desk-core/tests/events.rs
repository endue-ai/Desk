//! Event bus: publish to every live subscriber, prune the dropped ones.

use desk_bridge::BridgeEvent;
use desk_core::EventBus;
use serde_json::json;

fn changed(path: &str) -> BridgeEvent {
    serde_json::from_value(json!({
        "event": "fs.changed",
        "data": { "watchId": "w1", "path": path, "change": "modified" }
    }))
    .unwrap()
}

#[test]
fn every_subscriber_receives_a_published_event() {
    let bus = EventBus::new();
    let a = bus.subscribe();
    let b = bus.subscribe();
    bus.publish(changed("~/a.md"));
    assert_eq!(a.try_recv().unwrap(), changed("~/a.md"));
    assert_eq!(b.try_recv().unwrap(), changed("~/a.md"));
}

#[test]
fn events_arrive_in_publish_order() {
    let bus = EventBus::new();
    let a = bus.subscribe();
    bus.publish(changed("~/1"));
    bus.publish(changed("~/2"));
    assert_eq!(a.try_recv().unwrap(), changed("~/1"));
    assert_eq!(a.try_recv().unwrap(), changed("~/2"));
}

#[test]
fn dropped_subscribers_are_pruned() {
    let bus = EventBus::new();
    let kept = bus.subscribe();
    drop(bus.subscribe());
    assert_eq!(bus.publish(changed("~/a.md")), 1, "delivered to the live subscriber only");
    assert_eq!(bus.subscriber_count(), 1);
    assert!(kept.try_recv().is_ok());
}
