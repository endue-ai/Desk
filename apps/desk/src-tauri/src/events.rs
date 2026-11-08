//! Core events for the web runtime: one Tauri event per delivery, with the callers it is for riding
//! along as `to`, so the runtime can hand an addressed event (a perm.prompt, a subscribed event) to
//! the plugin it names.

use desk_core::Delivery;
use serde_json::Value;

/// The payload of `bridge://event` for one delivery: the event as the bridge contract writes it,
/// plus `to` when the core addressed it to particular callers.
pub fn payload(delivery: Delivery) -> Value {
    let mut value = serde_json::to_value(&delivery.event).unwrap_or(Value::Null);
    if let (Some(to), Some(object)) = (delivery.to, value.as_object_mut()) {
        object.insert("to".to_owned(), Value::from(to));
    }
    value
}

#[cfg(test)]
mod tests {
    use desk_bridge::{BridgeEvent, CmdChangedData, CmdChangedEvent, CommandChange};

    use super::*;

    fn changed() -> BridgeEvent {
        BridgeEvent::CmdChanged(CmdChangedEvent {
            event: Default::default(),
            data: CmdChangedData {
                id: "desk.keys.quit".to_owned(),
                change: CommandChange::Registered,
                provider: "desk".to_owned(),
            },
        })
    }

    #[test]
    fn delivery_payload_names_its_recipients() {
        let addressed = payload(Delivery {
            to: Some(vec!["endue.permissions".to_owned()]),
            event: changed(),
        });
        assert_eq!(addressed["event"], "cmd.changed");
        assert_eq!(addressed["to"], serde_json::json!(["endue.permissions"]));
        let everyone = payload(Delivery {
            to: None,
            event: changed(),
        });
        assert_eq!(everyone["event"], "cmd.changed");
        assert!(everyone.get("to").is_none());
    }
}
