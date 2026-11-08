//! Fixtures shared by the `Control` tests: a scripted Notes app, apps, a clock that stops.
#![allow(dead_code)]

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use desk_computer::apps::App;
use desk_computer::ax::{Element, Node};
use desk_computer::fake::{FakeClock, FakeComputer};
use desk_computer::input::Event;
use desk_computer::keys::{Key, Modifiers};
use desk_computer::{Action, Clock, StopFlag, Verdict};

pub const PID: i32 = 412;

pub fn allow(_: &Action) -> Verdict {
    Verdict::Allow
}

pub fn notes() -> Node {
    let window = Node::new(Element::new("AXWindow").title("Untitled")).with(vec![
        Node::new(Element::new("AXTextArea").value("")),
        Node::new(Element::new("AXButton").title("Save").actions(&["AXPress"])),
    ]);
    Node::new(Element::new("AXApplication").title("Notes")).with(vec![window])
}

pub fn app(pid: i32, bundle: &str) -> App {
    App {
        pid,
        name: bundle.rsplit('.').next().unwrap_or(bundle).to_owned(),
        bundle_id: Some(bundle.to_owned()),
        path: Some(format!("/Applications/{bundle}.app")),
        active: false,
        hidden: false,
        regular: true,
    }
}

pub fn fake() -> Arc<FakeComputer> {
    Arc::new(
        FakeComputer::new()
            .with_tree(PID, notes())
            .with_apps(vec![app(PID, "com.apple.Notes")])
            .with_installed(vec![app(0, "com.apple.TextEdit")]),
    )
}

pub fn press(key: Key, modifiers: Modifiers) -> [Event; 2] {
    [
        Event::KeyDown { key, modifiers },
        Event::KeyUp { key, modifiers },
    ]
}

/// A clock that raises the stop flag the first time it is slept on, as a person pressing Stop
/// while an action waits for its turn.
pub struct StopOnSleep {
    pub clock: FakeClock,
    pub stop: StopFlag,
    pub armed: AtomicBool,
}

impl Clock for StopOnSleep {
    fn now(&self) -> Duration {
        self.clock.now()
    }

    fn sleep(&self, duration: Duration) {
        if self.armed.swap(false, Ordering::SeqCst) {
            self.stop.raise();
        }
        self.clock.sleep(duration);
    }
}
