//! The event bus: bridge events fan out to every live subscriber.

use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver, Sender};

use desk_bridge::BridgeEvent;

#[derive(Debug, Default)]
pub struct EventBus {
    subscribers: Mutex<Vec<Sender<BridgeEvent>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// A new subscriber. Dropping the receiver unsubscribes on the next publish.
    pub fn subscribe(&self) -> Receiver<BridgeEvent> {
        let (sender, receiver) = mpsc::channel();
        self.lock().push(sender);
        receiver
    }

    /// Send `event` to every subscriber, in publish order. Returns how many received it.
    pub fn publish(&self, event: BridgeEvent) -> usize {
        let mut subscribers = self.lock();
        subscribers.retain(|sender| sender.send(event.clone()).is_ok());
        subscribers.len()
    }

    pub fn subscriber_count(&self) -> usize {
        self.lock().len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Sender<BridgeEvent>>> {
        self.subscribers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
