//! The desk's frame clock in compositor mode (#111, #117): the plugin surfaces and the shell page
//! render only on its begin frames (external begin frames, `web_host/frames.rs`), at most one a desk
//! frame for each one shown and awake, at its pace, and fewer for one long idle; the window composes
//! what they paint at most once a frame. The window wakes for its next frame (none while it is out
//! of sight, #155), the live budget's next look or the clock's, which wants none while every surface
//! on it rests (#134); CEF's poll rides those wake-ups (#129, `pump.rs`). While CEF's work runs long
//! the pump's stand-in looks at the clock from its own thread (`pump/stand_in.rs`).

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
        // A page whose window came to rest somewhere new hears its screen (#156, popups).
        self.host.tell_screens(now);
    }

    /// The pump's stand-in looks at the same clock from its own thread (#129).
    pub(super) fn stand_in(&self) {
        let host = self.host.clone();
        let look = Arc::new(move |now| host.begin_frames(now));
        self.desk.pump.stand_in(look, Arc::new(frames::prompted));
    }

    /// The window is in front (the display's rate) or behind (a lower one). In front, a window that
    /// could not present tries again.
    pub fn focused(&mut self, focused: bool) {
        if focused {
            self.gpu.resume();
        }
        let fps = if focused { 60 } else { 30 };
        for (surface, _, _) in self.hosted.surfaces().made() {
            let pace = json!({ "type": "pace", "surface": surface, "fps": fps });
            if let Ok(message) = serde_json::from_value(pace) {
                self.send_to(&message);
            }
        }
    }

    /// What the window's next wake-up is made of now.
    pub(super) fn due(&self) -> Due {
        let composed = self.shared.lock();
        let dirty = composed.dirty || !composed.repainted.is_empty();
        drop(composed);
        Due {
            dirty,
            occluded: self.occluded,
            last_frame: self.last_frame,
            hosted: self.hosted.due(),
            clock: self.begin_due,
            withheld: self.gpu.withheld(),
            tips: self.tips.due(),
        }
    }

    /// When the window should wake next: a frame to draw, the budget's look, the clock's, a look
    /// for a frame the OS withheld, or a hover title's rest ending (#156).
    pub fn next_frame(&self) -> Option<Instant> {
        self.due().next()
    }
}

/// What the window's next wake-up is made of. A frame is due only for a change, and only while the
/// window can be seen: out of sight (closed, minimized, hidden, covered, on another Space, the
/// display off) the desk waits for the budget's look, the clock's, CEF's poll or an event, and draws
/// what changed once the window shows again (#155). It named the last frame's due time, long past,
/// and the loop never waited.
#[derive(Clone, Copy, Debug)]
pub(super) struct Due {
    /// The scene, or a picture in it, changed since the last frame.
    pub dirty: bool,
    /// The OS says the window is out of sight (winit's `Occluded`).
    pub occluded: bool,
    pub last_frame: Instant,
    /// The live budget's next look, or when the page's picture counts as painted (`Hosted::due`).
    pub hosted: Option<Instant>,
    /// The frame clock's next look.
    pub clock: Option<Instant>,
    /// When to ask again for a frame the OS withheld.
    pub withheld: Option<Instant>,
    /// When a hover title's rest ends (`tooltip.rs`); `tip_tick` shows it at that wake-up, seen or not.
    pub tips: Option<Instant>,
}

impl Due {
    /// When the next frame is due: none while nothing changed or nothing can be seen.
    pub fn frame(&self) -> Option<Instant> {
        (self.dirty && !self.occluded).then_some(self.last_frame + FRAME)
    }

    /// When to look again for a frame the OS withheld: not while the OS says the window is out of
    /// sight, which its showing again ends.
    pub fn withheld(&self) -> Option<Instant> {
        self.withheld.filter(|_| !self.occluded)
    }

    /// The soonest of them.
    pub fn next(&self) -> Option<Instant> {
        [
            self.frame(),
            self.hosted,
            self.clock,
            self.withheld(),
            self.tips,
        ]
        .into_iter()
        .flatten()
        .min()
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{Due, FRAME};

    fn due(dirty: bool, occluded: bool) -> Due {
        Due {
            dirty,
            occluded,
            last_frame: Instant::now() - Duration::from_secs(5),
            hosted: None,
            clock: None,
            withheld: None,
            tips: None,
        }
    }

    #[test]
    fn a_change_on_a_window_in_sight_is_drawn_a_frame_after_the_last() {
        let shown = due(true, false);
        assert_eq!(shown.frame(), Some(shown.last_frame + FRAME));
        assert_eq!(shown.next(), shown.frame());
        assert_eq!(due(false, false).next(), None, "nothing changed: no frame");
    }

    #[test]
    fn a_window_out_of_sight_names_no_frame_however_much_changed() {
        // #155: the frame it named was the last one's, long past, so the loop never waited.
        let hidden = due(true, true);
        assert_eq!(hidden.frame(), None);
        assert_eq!(hidden.next(), None);
    }

    #[test]
    fn out_of_sight_it_wakes_for_the_budget_and_the_clock_and_no_withheld_frame() {
        let now = Instant::now();
        let budget = now + Duration::from_millis(700);
        let clock = now + Duration::from_millis(100);
        let mut hidden = due(true, true);
        hidden.hosted = Some(budget);
        hidden.withheld = Some(now - Duration::from_secs(1));
        assert_eq!(
            hidden.next(),
            Some(budget),
            "no frame, no look for a withheld one"
        );
        hidden.clock = Some(clock);
        assert_eq!(hidden.next(), Some(clock));
        hidden.occluded = false;
        assert_eq!(
            hidden.next(),
            hidden.frame(),
            "shown again: the frame, at once"
        );
    }
}
