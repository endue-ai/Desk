//! Retain disconnect evidence from the synchronous connector and asynchronous data event streams.

use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use desk_core::Delivery;
use serde_json::Value;

pub type Observed = (Option<Vec<String>>, Value);

/// Both events must arrive within the integration tests' existing ten-second event deadline.
/// Unlike sequential single-event waits, this keeps deliveries that precede the awaited data.
pub fn collect_disconnect(
    receiver: &Receiver<Delivery>,
    connector: &str,
    instance: &str,
) -> Result<Vec<Observed>, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut observed = Vec::new();
    let (mut removed, mut disconnected) = (false, false);
    while !removed || !disconnected {
        let delivery = receiver
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|error| {
                let missing: Vec<_> = [
                    (!removed, "data.changed removal"),
                    (!disconnected, "connector.changed disconnected"),
                ]
                .into_iter()
                .filter_map(|(missing, name)| missing.then_some(name))
                .collect();
                format!(
                    "missing {} for {connector}/{instance}: {error}; observed {observed:?}",
                    missing.join(" and ")
                )
            })?;
        let event = serde_json::to_value(delivery.event).expect("bridge events serialize");
        let data = &event["data"];
        if event["event"] == "connector.changed"
            && data["connector"] == connector
            && data["instance"] == instance
            && data["change"] == "disconnected"
        {
            disconnected = true;
        }
        if event["event"] == "data.changed"
            && data["changes"].as_array().is_some_and(|changes| {
                changes.iter().any(|change| {
                    change["change"] == "removed"
                        && change["source"]["connector"] == connector
                        && change["source"]["instance"] == instance
                })
            })
        {
            removed = true;
        }
        observed.push((delivery.to, event));
    }
    Ok(observed)
}
