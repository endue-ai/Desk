//! Room for a popup widget's first frame (#156). Chromium keeps at most a handful of browsers'
//! frames (its `FrameEvictionManager`: five, more with memory to spare), never evicting a shown
//! one, and CEF's off-screen view embeds a new popup's first surface while that surface is still
//! counted as hidden (`ShowWithVisibility` marks the view showing, then synchronises it, then tells
//! its frame host it is shown). On a desk that shows five browsers or more the popup's frame is
//! evicted the moment it is embedded, its renderer is never given a surface id to draw into, and
//! the list or the picker never paints, though it is open and takes the keys. Nothing in CEF's API
//! reaches a popup's view to give it a new id afterwards.
//!
//! So when a page's popup opens (`on_popup_show`, which CEF calls before it shows the popup), every
//! other shown browser is hidden for that moment, which hands Chromium their frames to evict (the
//! compositor keeps its own copy of each surface's last frame, so nothing changes on screen), and
//! the popup's frame is kept. On the next turn of CEF's loop each of them is shown again and laid
//! out and painted anew, as a surface shown again after others is (`Action::Hide(false)`). A
//! surface the compositor hid or put to sleep meanwhile stays as it is now. The desk's own page
//! stays shown: it is not one of the host's surfaces.

use std::sync::{Mutex, Weak};

use cef::*;

use super::super::lifecycle::State;
use super::super::{Inner, WebHost};

/// A way back to the host's surfaces from a surface's render handler; nothing once the host is gone.
#[derive(Clone)]
pub struct Room(Weak<Mutex<Inner>>);

impl WebHost {
    /// What a render handler makes room through.
    pub fn room(&self) -> Room {
        Room(std::sync::Arc::downgrade(&self.inner))
    }
}

/// Whether a surface in `state` has a frame Chromium keeps: a shown one with its renderer.
fn shown(state: State) -> bool {
    state == State::Live { hidden: false }
}

impl Room {
    /// Room for no surface: one whose host is gone.
    #[cfg(test)]
    pub fn none() -> Room {
        Room(Weak::new())
    }

    /// The browser `opener` (its identifier) opens a popup: hide every other shown browser now and
    /// show them again on the next turn of CEF's loop.
    pub fn make(&self, opener: i32) {
        let Some(inner) = self.0.upgrade() else {
            return;
        };
        // Never wait here: CEF may call while the host holds its lock further up the stack.
        let others: Vec<(String, Browser)> = {
            let Ok(inner) = inner.try_lock() else {
                return;
            };
            (inner.records.iter())
                .filter(|(_, r)| shown(r.state))
                .filter_map(|(s, r)| Some((s.clone(), r.browser.clone()?)))
                .filter(|(_, b)| b.identifier() != opener)
                .collect()
        };
        if others.is_empty() {
            return;
        }
        for (_, browser) in &others {
            if let Some(host) = browser.host() {
                host.was_hidden(1);
            }
        }
        let mut back = GiveBack::new(self.0.clone(), others);
        post_task(ThreadId::UI, Some(&mut back));
    }
}

wrap_task! {
    struct GiveBack {
        inner: Weak<Mutex<Inner>>,
        hidden: Vec<(String, Browser)>,
    }

    impl Task {
        fn execute(&self) {
            let still: Vec<Browser> = {
                let Some(inner) = self.inner.upgrade() else { return };
                let inner = inner.lock().unwrap_or_else(|e| e.into_inner());
                (self.hidden.iter())
                    .filter(|(surface, browser)| {
                        inner.records.get(surface).is_some_and(|r| {
                            shown(r.state)
                                && r.browser.as_ref().map(|b| b.identifier())
                                    == Some(browser.identifier())
                        })
                    })
                    .map(|(_, browser)| browser.clone())
                    .collect()
            };
            for browser in still {
                if let Some(host) = browser.host() {
                    // As a surface shown again after others: its frame was evicted, so it lays out
                    // once more for a new surface id, and paints.
                    host.was_hidden(0);
                    host.was_resized();
                    host.invalidate(PaintElementType::VIEW);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Room, shown};
    use crate::web_host::lifecycle::State;

    #[test]
    fn only_a_shown_surface_with_its_renderer_holds_a_frame_to_hand_over() {
        assert!(shown(State::Live { hidden: false }));
        assert!(!shown(State::Live { hidden: true }));
        assert!(!shown(State::Asleep { hidden: false }));
        assert!(!shown(State::Dead { hidden: false }));
        assert!(!shown(State::Gone));
    }

    #[test]
    fn a_room_without_its_host_makes_none() {
        Room::none().make(7);
    }
}
