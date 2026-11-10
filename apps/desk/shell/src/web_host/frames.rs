//! The desk's frame clock for web surfaces (#111): every windowless browser runs with
//! `external_begin_frame_enabled`, so its page renders only when the clock sends it a begin frame
//! (`SendExternalBeginFrame`). The clock ticks once a desk frame (60 Hz) while a surface is on it;
//! each tick is a begin frame for every visible, awake surface its pace takes (the compositor's
//! `pace` hint as a skip rule: 30 fps takes every other frame, 10 every sixth). Hidden, asleep and
//! dead surfaces are not on it. A press, a key or a composition an idle surface's browser hears
//! (one that painted nothing for `IDLE`) is followed by begin frames every `PROMPT` from
//! `PROMPT_AFTER` on for two frames, whatever its pace, so its paint comes at once rather than at
//! the next desk frames, one a stage of its pipeline; a surface that paints already takes every desk
//! frame. The numbers are #111's measures on the surface probe: a begin frame before the renderer
//! has the press, a longer prompt or one that stops at the paint each left more presses a frame
//! late. Engine free: `clock.rs` sends the begin frames the clock asks for.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use desk_surface::generated::CompositorMessage as M;

use super::lifecycle::State;

/// One desk frame: the display's rate.
pub const FRAME: Duration = Duration::from_micros(16_667);
/// Desk frames a second, the most a surface's pace takes.
pub const RATE: u32 = 60;
/// After input to an idle surface, begin frames from `PROMPT_AFTER` on (once its renderer has the
/// input), this often, for `PROMPT_FOR` (two desk frames).
pub const PROMPT_AFTER: Duration = Duration::from_millis(3);
pub const PROMPT: Duration = Duration::from_millis(1);
pub const PROMPT_FOR: Duration = Duration::from_micros(33_333);
/// A surface that painted nothing for this long is idle: a press prompts it.
pub const IDLE: Duration = Duration::from_micros(33_333);

/// Whether a surface in `state` is on the clock: a visible, awake one with its renderer.
pub fn on_clock(state: State) -> bool {
    state == State::Live { hidden: false }
}

/// Whether `message` is input whose paint should follow at once: presses, keys, compositions and
/// focus. Moves and wheels come in streams and paint on the desk's frames.
pub fn prompts(message: &M) -> bool {
    matches!(
        message,
        M::SurfacePointerDown(_)
            | M::SurfacePointerUp(_)
            | M::SurfaceKeyDown(_)
            | M::SurfaceKeyUp(_)
            | M::SurfaceKeyChar(_)
            | M::SurfaceFocusIn(_)
            | M::SurfaceFocusOut(_)
            | M::SurfaceImeComposition(_)
            | M::SurfaceImeCommit(_)
            | M::SurfaceImeCancel(_)
    )
}

/// The browsers (by identifier) that heard prompting input since the clock last looked, and when.
/// Input reaches a browser through `input::deliver` from the web host and from the compositor's
/// page alike; the host's clock takes them on its next look (CEF's UI thread, both).
static PRESSED: Mutex<Vec<(i32, Instant)>> = Mutex::new(Vec::new());
/// The most presses kept for the next look: the oldest go first.
const KEPT: usize = 64;

/// Browser `browser` heard prompting input now.
pub fn pressed(browser: i32) {
    let mut pressed = PRESSED.lock().unwrap_or_else(|e| e.into_inner());
    if pressed.len() >= KEPT {
        pressed.remove(0);
    }
    pressed.push((browser, Instant::now()));
}

/// The presses since the last call.
pub fn take_pressed() -> Vec<(i32, Instant)> {
    std::mem::take(&mut *PRESSED.lock().unwrap_or_else(|e| e.into_inner()))
}

/// The desk's frames: one every `FRAME` on the clock's own cadence while it runs. A late frame is
/// not made up; a stopped clock's first frame is at once.
#[derive(Clone, Debug, Default)]
pub struct Clock {
    next: Option<Instant>,
}

impl Clock {
    /// Whether `now` is a desk frame.
    pub fn frame(&mut self, now: Instant) -> bool {
        if self.next.is_some_and(|next| now < next) {
            return false;
        }
        let due = self.next.map_or(now, |next| next + FRAME);
        self.next = Some(if due > now { due } else { now + FRAME });
        true
    }

    /// No surface is on the clock: it stops until one is.
    pub fn stop(&mut self) {
        self.next = None;
    }

    /// When the next desk frame is, while the clock runs.
    pub fn next(&self) -> Option<Instant> {
        self.next
    }
}

/// When a press asks for its next begin frame, and until when.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Press {
    next: Instant,
    until: Instant,
}

/// One surface's place on the clock: which desk frames its pace takes, when it last painted, and
/// the begin frames a press asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pacing {
    pace: u32,
    /// Bresenham's error: `RATE` or more and this desk frame is the surface's.
    owed: u32,
    /// The paints seen so far and when the count last moved.
    paints: u64,
    painted: Option<Instant>,
    press: Option<Press>,
}

impl Pacing {
    /// A surface painting at most `pace` frames a second; its first desk frame is its own.
    pub fn new(pace: u32) -> Pacing {
        Pacing {
            pace: pace.clamp(1, RATE),
            owed: RATE,
            paints: 0,
            painted: None,
            press: None,
        }
    }

    pub fn pace(&self) -> u32 {
        self.pace
    }

    /// The compositor's hint: at most `fps` frames a second from the next desk frame on.
    pub fn set_pace(&mut self, fps: u32) {
        self.pace = fps.clamp(1, RATE);
        self.owed = self.owed.min(RATE);
    }

    /// The surface heard a press or a key at `at`, having painted `paints` frames. An idle one
    /// (nothing painted for `IDLE`) gets begin frames every `PROMPT` from `PROMPT_AFTER` on for
    /// `PROMPT_FOR`; one that paints already takes every desk frame and needs none.
    pub fn press(&mut self, at: Instant, paints: u64) {
        self.saw(at, paints);
        if self
            .painted
            .is_some_and(|t| at.saturating_duration_since(t) < IDLE)
        {
            return;
        }
        self.press = Some(Press {
            next: at + PROMPT_AFTER,
            until: at + PROMPT_FOR,
        });
    }

    /// Whether the surface gets a begin frame at `now`, when `desk_frame` says whether `now` is one
    /// of the desk's frames and `paints` how many frames it has painted. Call it on every look.
    pub fn due(&mut self, now: Instant, desk_frame: bool, paints: u64) -> bool {
        self.saw(now, paints);
        let paced = desk_frame && self.paced();
        let pressed = self.pressed(now);
        paced || pressed
    }

    fn saw(&mut self, now: Instant, paints: u64) {
        if paints != self.paints {
            self.paints = paints;
            self.painted = Some(now);
        }
    }

    fn paced(&mut self) -> bool {
        let take = self.owed >= RATE;
        if take {
            self.owed -= RATE;
        }
        self.owed += self.pace;
        take
    }

    fn pressed(&mut self, now: Instant) -> bool {
        let Some(press) = self.press else {
            return false;
        };
        if now < press.next {
            return false;
        }
        let next = press.next + PROMPT;
        self.press = (next <= press.until).then_some(Press { next, ..press });
        true
    }

    /// When a press asks for its next begin frame, besides the desk's frames.
    pub fn next(&self) -> Option<Instant> {
        self.press.map(|p| p.next)
    }
}

impl Default for Pacing {
    fn default() -> Pacing {
        Pacing::new(RATE)
    }
}

#[cfg(test)]
mod tests {
    use super::{Clock, FRAME, IDLE, PROMPT, Pacing, on_clock, prompts};
    use crate::web_host::lifecycle::State;
    use std::time::{Duration, Instant};

    /// Which of `frames` desk frames a surface at `pace` takes, as a string of `x` and `.`.
    fn taken(pace: u32, frames: usize) -> String {
        let mut pacing = Pacing::new(pace);
        let now = Instant::now();
        (0..frames)
            .map(|_| if pacing.due(now, true, 0) { 'x' } else { '.' })
            .collect()
    }

    #[test]
    fn a_surfaces_pace_takes_every_desk_frame_or_skips_evenly() {
        assert_eq!(taken(60, 6), "xxxxxx");
        assert_eq!(taken(240, 3), "xxx", "never more than the desk's frames");
        assert_eq!(taken(30, 6), "x.x.x.");
        assert_eq!(taken(10, 13), "x.....x.....x");
        assert_eq!(taken(45, 8), "x.xxx.xx", "three in four");
        assert_eq!(
            taken(0, 3),
            "x..",
            "at least one a second, the first at once"
        );
        let mut pacing = Pacing::new(60);
        let now = Instant::now();
        assert!(!pacing.due(now, false, 0), "only desk frames are paced");
        pacing.set_pace(30);
        let got: String = (0..4)
            .map(|_| if pacing.due(now, true, 0) { 'x' } else { '.' })
            .collect();
        assert_eq!(got, "x.x.", "a new pace from the next frame");
    }

    #[test]
    fn a_press_on_an_idle_surface_brings_begin_frames_at_once_whatever_its_pace() {
        let mut pacing = Pacing::new(1);
        let t0 = Instant::now();
        assert!(pacing.due(t0, true, 0), "its first frame");
        assert!(!pacing.due(t0 + FRAME, true, 0), "a second's pace");
        let pressed = t0 + FRAME;
        let at = |ms: f64| pressed + Duration::from_secs_f64(ms / 1000.0);
        pacing.press(pressed, 0);
        assert_eq!(
            pacing.next(),
            Some(at(3.0)),
            "once its renderer has the press"
        );
        assert!(!pacing.due(at(1.0), false, 0));
        let looks = [3.0, 3.5, 4.0, 5.0, 6.0];
        let got: Vec<bool> = looks
            .iter()
            .map(|ms| pacing.due(at(*ms), false, 0))
            .collect();
        assert_eq!(got, [true, false, true, true, true], "every {PROMPT:?}");
        let sent = (7..60)
            .filter(|ms| pacing.due(at(f64::from(*ms)), false, 1))
            .count();
        assert_eq!(sent, 27, "two desk frames of them, its paint or not");
        assert_eq!(pacing.next(), None);
        assert!(!pacing.due(at(60.0), true, 1), "then its pace again");
    }

    #[test]
    fn a_press_on_a_surface_that_paints_already_waits_for_its_desk_frames() {
        let mut pacing = Pacing::new(60);
        let t0 = Instant::now();
        assert!(pacing.due(t0, true, 1), "it painted");
        pacing.press(t0 + FRAME, 2);
        assert_eq!(
            pacing.next(),
            None,
            "a surface painting takes every desk frame"
        );
        assert!(pacing.due(t0 + FRAME, true, 2));
        pacing.press(t0 + FRAME * 4, 2);
        assert!(pacing.next().is_some(), "idle again after {IDLE:?}");
    }

    #[test]
    fn the_clock_ticks_once_a_frame_never_makes_up_a_late_one_and_starts_at_once() {
        let mut clock = Clock::default();
        let t0 = Instant::now();
        assert_eq!(clock.next(), None);
        assert!(clock.frame(t0), "a stopped clock's first frame is at once");
        assert!(!clock.frame(t0 + FRAME / 2));
        assert!(clock.frame(t0 + FRAME));
        assert_eq!(clock.next(), Some(t0 + FRAME * 2));
        assert!(clock.frame(t0 + FRAME * 5), "late");
        assert_eq!(clock.next(), Some(t0 + FRAME * 6), "and not made up");
        assert!(!clock.frame(t0 + FRAME * 5 + FRAME / 2));
        clock.stop();
        assert_eq!(clock.next(), None);
        assert!(clock.frame(t0 + FRAME * 5 + FRAME / 2));
    }

    #[test]
    fn only_visible_awake_surfaces_are_on_the_clock_and_presses_prompt() {
        assert!(on_clock(State::Live { hidden: false }));
        for state in [
            State::Live { hidden: true },
            State::Asleep { hidden: false },
            State::Dead { hidden: false },
            State::Gone,
        ] {
            assert!(!on_clock(state), "{state:?}");
        }
        let message = |value: serde_json::Value| serde_json::from_value(value).unwrap();
        let press = serde_json::json!({ "type": "pointer.down", "surface": "s", "x": 1, "y": 1,
            "button": "left", "buttons": [], "clicks": 1, "modifiers": [] });
        let moved = serde_json::json!({ "type": "pointer.move", "surface": "s", "x": 1, "y": 1,
            "buttons": [], "modifiers": [] });
        assert!(prompts(&message(press)));
        assert!(
            !prompts(&message(moved)),
            "moves paint on the desk's frames"
        );
    }
}
