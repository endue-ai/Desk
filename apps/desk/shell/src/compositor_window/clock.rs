//! The desk's frame clock in compositor mode (#111, #117): the plugin surfaces and the shell page
//! render only on its begin frames (external begin frames, `web_host/frames.rs`), at most one a desk
//! frame for each one shown and awake, at its pace, and fewer for one long idle; the window composes
//! what they paint at most once a frame. The window wakes for its next frame (none while it is out
//! of sight, #155), the live budget's next look or the clock's, which wants none while every surface
//! on it rests (#134); CEF's poll rides those wake-ups (#129, `pump.rs`). While CEF's work runs long
//! the pump's stand-in looks at the clock from its own thread (`pump/stand_in.rs`). A frame is a
//! display interval after the last (16.667 ms at 60 Hz, 8.333 at 120: `display.rs`, #249), and the
//! begin frames count the display's frames too; the render thread draws each frame a little behind
//! the beat it was laid out on (`Behind`, `render_thread.rs`).

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;

use super::CompositorWindow;
use crate::web_host::frames;
use crate::web_host::view::catch_up::catch_up_page;

impl CompositorWindow {
    /// The clock's look at `now`: the begin frames due, and when it looks next. The pump's
    /// stand-in looks too while CEF's work runs long (#129, `pump/stand_in.rs`).
    pub(super) fn begin_frames(&mut self, now: Instant) {
        self.begin_due = self.host.begin_frames(now);
        self.desk.pump.looked(now, self.begin_due);
        // A page whose window came to rest somewhere new hears its screen (#156, popups).
        self.host.tell_screens(now);
        // A page that has not painted its size hears it again (#248, ADR 0210).
        self.host.catch_up(now);
        catch_up_page(&self.page, self.browser.as_ref(), now);
    }

    /// The pump's stand-in looks at the same clock from its own thread (#129).
    pub(super) fn stand_in(&self) {
        let host = self.host.clone();
        let look = Arc::new(move |now| host.begin_frames(now));
        self.desk.pump.stand_in(look, Arc::new(frames::prompted));
    }

    /// The window is in front (60 frames a second, whatever the display's rate: at 120 Hz a pace of
    /// 60 takes every other desk frame, #249) or behind (30). In front, a window that could not
    /// present tries again, on the display it is on now.
    pub fn focused(&mut self, focused: bool) {
        if focused {
            self.render.resume();
            self.follow_display();
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
            interval: frames::interval(self.rate),
            hosted: self.hosted.due(),
            clock: self.begin_due,
            withheld: self.render.state().withheld,
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
    /// One frame of the window's display.
    pub interval: Duration,
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
        (self.dirty && !self.occluded).then_some(self.last_frame + self.interval)
    }

    /// When to look again for a frame the OS withheld: not while the OS says the window is out of
    /// sight, which its showing again ends.
    pub fn withheld(&self) -> Option<Instant> {
        self.withheld.filter(|_| !self.occluded)
    }

    /// The frame just composed at `now`, as the next one counts from it: the clock's own beat, one
    /// display `interval` after the last, when this one came within a frame of when it was due, so
    /// a late wake-up does not push every frame after it later (the beat drifted by each frame's
    /// lateness, slightly under 60 a second against the display's); `now` when the desk had
    /// nothing to draw a while or a frame was missed, so the beat starts again there.
    pub fn beat(last_frame: Instant, now: Instant, interval: Duration) -> Instant {
        let due = last_frame + interval;
        match now.checked_duration_since(due) {
            Some(late) if late < interval => due,
            _ => now,
        }
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

/// How far behind its slot a frame is drawn: none from rest, then an eighth of a display interval
/// more each frame of a run, up to `most`.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Behind {
    last: Option<Instant>,
}

impl Behind {
    /// The most a frame is drawn behind its slot: the slack a late main thread has.
    pub(super) fn most(every: Duration) -> Duration {
        every * 3 / 4
    }

    /// When to draw the frame laid out on `slot`, seen at `now`, the display's frames `every`
    /// apart: never before the last drawn by half an interval, and at once when late.
    pub(super) fn draw_at(&mut self, slot: Instant, now: Instant, every: Duration) -> Instant {
        let mut at = slot.max(now);
        if let Some(last) = self
            .last
            .filter(|t| now.saturating_duration_since(*t) < every * 2)
        {
            // Grow the margin from the last draw. A restarted beat may already be late enough
            // to use all of it before the newly laid-out scene reaches the render thread.
            let next = last + every;
            let deadline = (slot + Self::most(every)).min(next + every / 8);
            at = at.max(deadline).max(last + every / 2);
        }
        self.last = Some(at);
        at
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::Due;
    use crate::web_host::frames::{FRAME, interval};

    fn due(dirty: bool, occluded: bool) -> Due {
        Due {
            dirty,
            occluded,
            last_frame: Instant::now() - Duration::from_secs(5),
            interval: FRAME,
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
    fn a_frame_is_due_a_display_interval_after_the_last() {
        for (rate, ms) in [(120, 8.333), (60, 16.667)] {
            let every = interval(rate);
            assert!(
                (every.as_secs_f64() * 1e3 - ms).abs() < 1e-3,
                "{rate} Hz: {every:?}"
            );
            let mut shown = due(true, false);
            shown.interval = every;
            assert_eq!(shown.frame(), Some(shown.last_frame + every), "{rate} Hz");
            let last = Instant::now();
            let late = Duration::from_millis(1);
            let beat = Due::beat(last, last + every + late, every);
            assert_eq!(beat, last + every, "{rate} Hz: on the display's beat");
            let missed = last + every * 2 + late;
            assert_eq!(
                Due::beat(last, missed, every),
                missed,
                "{rate} Hz: a frame missed"
            );
        }
        let mut fast = due(true, false);
        fast.interval = interval(120);
        assert_ne!(
            fast.frame(),
            Some(fast.last_frame + FRAME),
            "never a fixed FRAME"
        );
    }

    #[test]
    fn frames_keep_the_clocks_beat_whatever_each_wake_up_is_late() {
        let start = Instant::now();
        let late = Duration::from_millis(3);
        // Woken 3 ms after each frame was due, 60 frames on: on the beat, not 3 ms later each time.
        let mut last = start;
        for _ in 0..60 {
            let due = last + FRAME;
            last = Due::beat(last, due + late, FRAME);
            assert_eq!(last, due, "the frame counts from when it was due");
        }
        assert_eq!(last, start + FRAME * 60);
        // The old count drifted: 60 frames took 60 × (FRAME + 3 ms).
        assert!(start + (FRAME + late) * 60 > last + Duration::from_millis(170));
    }

    #[test]
    fn a_frame_after_a_rest_or_a_missed_one_starts_the_beat_again() {
        let last = Instant::now();
        let rested = last + Duration::from_secs(2);
        assert_eq!(
            Due::beat(last, rested, FRAME),
            rested,
            "nothing drawn a while"
        );
        let missed = last + FRAME * 2 + Duration::from_millis(1);
        assert_eq!(
            Due::beat(last, missed, FRAME),
            missed,
            "a whole frame missed"
        );
        let early = last + FRAME - Duration::from_millis(1);
        assert_eq!(
            Due::beat(last, early, FRAME),
            early,
            "drawn before it was due"
        );
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
