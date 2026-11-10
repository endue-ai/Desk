//! Which core events a native plugin's bridge connection hears: those addressed to it, and those of
//! its own calls (a turn's steps, a watch's changes, a subscription's data, a process's output, a
//! socket's data), which the answer to the call that started them claims. An owned event that comes
//! before its claim waits for it, as the runtime's owners do for web plugins
//! (`packages/runtime/src/owners.ts`); everything else is not the plugin's.

use std::collections::{HashSet, VecDeque};

use desk_bridge::BridgeEvent;
use serde_json::Value;

use crate::events::Delivery;

/// How many unclaimed keys keep their early events, and how many events each keeps.
const EARLY_KEYS: usize = 32;
const EARLY_EVENTS: usize = 256;

/// The keys one connection's calls claimed, and early events waiting for a claim.
#[derive(Default)]
pub(crate) struct Claims {
    claimed: HashSet<String>,
    early: VecDeque<(String, Vec<BridgeEvent>)>,
}

/// The key an owned event belongs to, and whether it is the key's last event.
fn owned(event: &BridgeEvent) -> Option<(String, bool)> {
    let value = serde_json::to_value(event).ok()?;
    let data = &value["data"];
    let field = |name: &str| data[name].as_str().map(str::to_owned);
    match value["event"].as_str()? {
        "brain.turn" => {
            let last = matches!(data["kind"].as_str(), Some("completed" | "error"));
            Some((format!("turn:{}", field("turnId")?), last))
        }
        "fs.changed" => Some((format!("watch:{}", field("watchId")?), false)),
        "data.changed" => Some((format!("sub:{}", field("subscriptionId")?), false)),
        "proc.output" => Some((format!("proc:{}", field("procId")?), false)),
        "proc.exit" => Some((format!("proc:{}", field("procId")?), true)),
        "net.data" => Some((format!("net:{}", field("socketId")?), false)),
        "net.closed" => Some((format!("net:{}", field("socketId")?), true)),
        _ => None,
    }
}

/// The key a successful call of `method` starts, from its `result`.
pub(crate) fn claim_key(method: &str, result: &Value) -> Option<String> {
    let field = |name: &str| result[name].as_str().map(str::to_owned);
    match method {
        "brain.say" => Some(format!("turn:{}", field("turnId")?)),
        "fs.watch" => Some(format!("watch:{}", field("watchId")?)),
        "data.subscribe" => Some(format!("sub:{}", field("subscriptionId")?)),
        "proc.spawn" => Some(format!("proc:{}", field("procId")?)),
        "net.connect" => Some(format!("net:{}", field("socketId")?)),
        _ => None,
    }
}

impl Claims {
    /// What of `delivery` plugin `plugin` hears now.
    pub(crate) fn decide(&mut self, plugin: &str, delivery: Delivery) -> Vec<BridgeEvent> {
        if let Some(to) = &delivery.to {
            if to.iter().any(|caller| caller == plugin) {
                self.ended(&delivery.event);
                return vec![delivery.event];
            }
            return Vec::new();
        }
        let Some((key, last)) = owned(&delivery.event) else {
            return Vec::new();
        };
        if self.claimed.contains(&key) {
            if last {
                self.claimed.remove(&key);
            }
            return vec![delivery.event];
        }
        match self.early.iter_mut().find(|(k, _)| *k == key) {
            Some((_, events)) if events.len() < EARLY_EVENTS => events.push(delivery.event),
            Some(_) => {}
            None => {
                if self.early.len() == EARLY_KEYS {
                    self.early.pop_front();
                }
                self.early.push_back((key, vec![delivery.event]));
            }
        }
        Vec::new()
    }

    /// The plugin's call started `key`: it hears its events from now on, and these early ones now.
    pub(crate) fn claim(&mut self, key: String) -> Vec<BridgeEvent> {
        let early = match self.early.iter().position(|(k, _)| *k == key) {
            Some(at) => self.early.remove(at).map(|(_, e)| e).unwrap_or_default(),
            None => Vec::new(),
        };
        let done = early.iter().any(|e| owned(e).is_some_and(|(_, last)| last));
        if !done {
            self.claimed.insert(key);
        }
        early
    }

    /// An addressed event that ends its key frees the claim.
    fn ended(&mut self, event: &BridgeEvent) {
        if let Some((key, true)) = owned(event) {
            self.claimed.remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Claims, claim_key};
    use crate::events::Delivery;
    use desk_bridge::BridgeEvent;
    use serde_json::json;

    fn event(value: serde_json::Value) -> BridgeEvent {
        serde_json::from_value(value).unwrap()
    }

    fn changed(watch: &str) -> BridgeEvent {
        event(
            json!({ "event": "fs.changed", "data": { "watchId": watch, "path": "~/a", "change": "modified" } }),
        )
    }

    #[test]
    fn a_plugin_hears_what_is_addressed_to_it_and_its_own_calls_events_only() {
        let mut claims = Claims::default();
        let notified = event(json!({ "event": "ui.notified",
            "data": { "notificationId": "n-1", "caller": "example.native", "title": "Hi", "level": "info" } }));
        let to = |who: &str| Delivery {
            to: Some(vec![who.to_owned()]),
            event: notified.clone(),
        };
        assert_eq!(
            claims.decide("example.native", to("example.native")).len(),
            1
        );
        assert!(
            claims
                .decide("example.native", to("example.other"))
                .is_empty()
        );
        let everyone = Delivery {
            to: None,
            event: notified.clone(),
        };
        assert!(
            claims.decide("example.native", everyone).is_empty(),
            "a broadcast is not a plugin's"
        );
        // A watch's change before the answer that names the watch waits, then comes with the claim.
        let early = Delivery {
            to: None,
            event: changed("w-1"),
        };
        assert!(claims.decide("example.native", early).is_empty());
        let key = claim_key("fs.watch", &json!({ "watchId": "w-1" })).unwrap();
        assert_eq!(claims.claim(key).len(), 1);
        let later = Delivery {
            to: None,
            event: changed("w-1"),
        };
        assert_eq!(claims.decide("example.native", later).len(), 1);
        let other = Delivery {
            to: None,
            event: changed("w-2"),
        };
        assert!(
            claims.decide("example.native", other).is_empty(),
            "another caller's watch"
        );
    }
}
