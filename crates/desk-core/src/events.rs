//! The event bus: bridge events fan out to every live subscriber. Clones share the same subscribers,
//! so work on other threads (brain turns) can publish. An event can name the callers it is for;
//! `subscribe` yields every event either way, `subscribe_addressed` yields each with its recipients
//! for whoever routes events to callers.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard};

use desk_bridge::BridgeEvent;

/// An event and the callers it is for. `None` is everyone; `Some` is sorted and names each caller
/// once.
#[derive(Debug, Clone, PartialEq)]
pub struct Delivery {
    pub to: Option<Vec<String>>,
    pub event: BridgeEvent,
}

#[derive(Debug, Default)]
struct Subscribers {
    plain: Vec<Sender<BridgeEvent>>,
    addressed: Vec<Sender<Delivery>>,
}

#[derive(Debug, Default, Clone)]
pub struct EventBus {
    subscribers: Arc<Mutex<Subscribers>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// A new subscriber to every event, addressed or not. Dropping the receiver unsubscribes on the
    /// next publish.
    pub fn subscribe(&self) -> Receiver<BridgeEvent> {
        let (sender, receiver) = mpsc::channel();
        self.lock().plain.push(sender);
        receiver
    }

    /// A new subscriber to every event together with its recipients, for a router.
    pub fn subscribe_addressed(&self) -> Receiver<Delivery> {
        let (sender, receiver) = mpsc::channel();
        self.lock().addressed.push(sender);
        receiver
    }

    /// Send `event` to every subscriber, for everyone, in publish order. Returns how many received it.
    pub fn publish(&self, event: BridgeEvent) -> usize {
        let (plain, addressed) = self.deliver(None, event);
        plain + addressed
    }

    /// Send `event` to every subscriber, for the callers in `to` (each once). Returns how many
    /// subscribers received it.
    pub fn publish_to(&self, to: Vec<String>, event: BridgeEvent) -> usize {
        let (plain, addressed) = self.deliver(Some(to), event);
        plain + addressed
    }

    pub fn subscriber_count(&self) -> usize {
        let subscribers = self.lock();
        subscribers.plain.len() + subscribers.addressed.len()
    }

    /// Publish `event` for `to` and return how many routers (`subscribe_addressed`) received it.
    pub(crate) fn route(&self, to: Vec<String>, event: BridgeEvent) -> usize {
        self.deliver(Some(to), event).1
    }

    /// Whether anything routes addressed events, as far as the bus knows.
    pub(crate) fn has_router(&self) -> bool {
        !self.lock().addressed.is_empty()
    }

    fn deliver(&self, to: Option<Vec<String>>, event: BridgeEvent) -> (usize, usize) {
        let to = to.map(|mut to| {
            to.sort();
            to.dedup();
            to
        });
        let mut subscribers = self.lock();
        subscribers
            .plain
            .retain(|sender| sender.send(event.clone()).is_ok());
        let delivery = Delivery { to, event };
        subscribers
            .addressed
            .retain(|sender| sender.send(delivery.clone()).is_ok());
        (subscribers.plain.len(), subscribers.addressed.len())
    }

    fn lock(&self) -> MutexGuard<'_, Subscribers> {
        self.subscribers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
