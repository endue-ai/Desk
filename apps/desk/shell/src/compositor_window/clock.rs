//! The desk's frame clock in compositor mode (#111): the plugin surfaces and the shell page render
//! only on its begin frames (external begin frames, `web_host/frames.rs`), one a desk frame for each
//! one shown and awake, at most at its pace; the window composes what they paint at most once a
//! frame. The window wakes for its next frame, the live budget's next look or the clock's.

use std::time::Instant;

use serde_json::json;

use super::CompositorWindow;
use crate::web_host::frames::FRAME;

impl CompositorWindow {
    /// The clock's look at `now`: the begin frames due, and when it looks next.
    pub(super) fn begin_frames(&mut self, now: Instant) {
        self.begin_due = self.host.begin_frames(now);
    }

    /// The window is in front (the display's rate) or behind (a lower one).
    pub fn focused(&mut self, focused: bool) {
        let fps = if focused { 60 } else { 30 };
        for (surface, _, _) in self.hosted.surfaces().made() {
            let pace = json!({ "type": "pace", "surface": surface, "fps": fps });
            if let Ok(message) = serde_json::from_value(pace) {
                self.host.send(&message);
            }
        }
    }

    /// When the window should wake next: a frame to draw, the budget's look or the clock's.
    pub fn next_frame(&self) -> Option<Instant> {
        let frame = self.shared.lock().dirty.then_some(self.last_frame + FRAME);
        [frame, self.hosted.due(), self.begin_due]
            .into_iter()
            .flatten()
            .min()
    }
}
