//! The desk's frame clock in compositor mode (#111, #117): the plugin surfaces and the shell page
//! render only on its begin frames (external begin frames, `web_host/frames.rs`), at most one a desk
//! frame for each one shown and awake, at its pace, and fewer for one long idle; the window composes
//! what they paint at most once a frame. The window wakes for its next frame, the live budget's next
//! look or the clock's, which wants none while every surface on it rests (#134); CEF's poll rides
//! those wake-ups (#129, `pump.rs`). While CEF's work runs long the pump's stand-in looks at the
//! clock from its own thread (`pump/stand_in.rs`).

use std::sync::Arc;
use std::time::Instant;

use serde_json::json;

use super::CompositorWindow;
use crate::web_host::frames::{self, FRAME};

impl CompositorWindow {
    /// The clock's look at `now`: the begin frames due, and when it looks next. The pump's
    /// stand-in looks too while CEF's work runs long (#129, `pump/stand_in.rs`).
    pub(super) fn begin_frames(&mut self, now: Instant) {
        self.begin_due = self.host.begin_frames(now);
        self.desk.pump.looked(now, self.begin_due);
    }

    /// The pump's stand-in looks at the same clock from its own thread (#129).
    pub(super) fn stand_in(&self) {
        let host = self.host.clone();
        let look = Arc::new(move |now| host.begin_frames(now));
        self.desk.pump.stand_in(look, Arc::new(frames::prompted));
    }

    /// The window is in front (the display's rate) or behind (a lower one).
    pub fn focused(&mut self, focused: bool) {
        let fps = if focused { 60 } else { 30 };
        for (surface, _, _) in self.hosted.surfaces().made() {
            let pace = json!({ "type": "pace", "surface": surface, "fps": fps });
            if let Ok(message) = serde_json::from_value(pace) {
                self.send_to(&message);
            }
        }
    }

    /// When the window should wake next: a frame to draw, the budget's look, the clock's, or a look
    /// for a frame the OS withheld.
    pub fn next_frame(&self) -> Option<Instant> {
        let frame = self.shared.lock().dirty.then_some(self.last_frame + FRAME);
        [
            frame,
            self.hosted.due(),
            self.begin_due,
            self.gpu.withheld(),
        ]
        .into_iter()
        .flatten()
        .min()
    }
}
