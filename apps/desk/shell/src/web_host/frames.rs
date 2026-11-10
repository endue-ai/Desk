//! The desk's frame clock for web surfaces (#111, #117): every windowless browser runs with
//! `external_begin_frame_enabled`, so its page renders only when the clock sends it a begin frame
//! (`SendExternalBeginFrame`). The clock counts desk frames (60 Hz) from when a surface comes on it;
//! each is a begin frame for every visible, awake surface its pace takes (the compositor's `pace`
//! hint as a skip rule: 30 fps takes every other frame, 10 every sixth). Hidden, asleep and dead
//! surfaces are not on it.
//!
//! A surface that painted nothing and heard nothing for `LONG_IDLE` takes at most `IDLE_RATE`
//! frames a second, on frames every long-idle surface shares, so a desk at rest wakes for its clock
//! 10 times a second rather than 60. Input, a message for it or to its page and a paint put it back
//! on every frame its pace takes.
//!
//! A press, a key, a composition or a focus change an idle surface hears (one that painted nothing
//! for `IDLE`) is followed by a begin frame every `PROMPT` from the press on, until it paints or for
//! `PROMPT_FOR`, whatever its pace: its paint then takes a few milliseconds rather than the next
//! desk frames, one a stage of its pipeline. That holds because Chromium runs its full pipeline
//! (ADR 0157, `app.rs`): a begin frame the renderer cannot use yet ends at once, where Chromium's
//! display held it for a whole frame and CEF sends no begin frame while one is out, the frame #111
//! saw one press in ten wait for (#117). Engine free: `clock.rs` sends the begin frames.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use desk_surface::generated::CompositorMessage as M;

use super::lifecycle::State;

/// One desk frame: the display's rate.
pub const FRAME: Duration = Duration::from_micros(16_667);
/// Desk frames a second, the most a surface's pace takes.
pub const RATE: u32 = 60;
/// After input to an idle surface, begin frames this often from the press on, until its paint, for
/// at most `PROMPT_FOR` (two desk frames).
pub const PROMPT: Duration = Duration::from_millis(1);
pub const PROMPT_FOR: Duration = Duration::from_micros(33_333);
/// A surface that painted nothing for this long is idle: a press prompts it.
pub const IDLE: Duration = Duration::from_micros(33_333);
/// A surface that painted nothing and heard nothing for this long is long idle: on the slow clock.
pub const LONG_IDLE: Duration = Duration::from_secs(1);
/// The most desk frames a second a long-idle surface takes.
pub const IDLE_RATE: u32 = 10;

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

/// What a browser heard since the clock last looked: (identifier, when, whether it prompts).
/// Input reaches a browser through `input::deliver` from the web host and from the compositor's
/// page alike, and messages to its page through `host::send`; the host's clock takes them on its
/// next look (CEF's UI thread, all of them).
static HEARD: Mutex<Vec<(i32, Instant, bool)>> = Mutex::new(Vec::new());
/// The most kept for the next look: the oldest go first.
const KEPT: usize = 64;

/// Browser `browser` heard input or a message now; `prompt`: input whose paint should follow at
/// once (`prompts`), else it only wakes the surface onto every desk frame.
pub fn heard(browser: i32, prompt: bool) {
    let mut heard = HEARD.lock().unwrap_or_else(|e| e.into_inner());
    if heard.len() >= KEPT {
        heard.remove(0);
    }
    heard.push((browser, Instant::now(), prompt));
}

/// What the browsers heard since the last call.
pub fn take_heard() -> Vec<(i32, Instant, bool)> {
    std::mem::take(&mut *HEARD.lock().unwrap_or_else(|e| e.into_inner()))
}

/// The desk's frames: frame `k` is `k` frames after the clock started, so frames keep their numbers
/// across looks that skip some. A late frame is not made up; a look half a frame late or more starts
/// the cadence again from itself; a stopped clock's first frame is at once.
#[derive(Clone, Debug, Default)]
pub struct Clock {
    epoch: Option<Instant>,
    last: u64,
}

/// Desk frame `k` after `epoch`.
fn frame_at(epoch: Instant, k: u64) -> Instant {
    epoch + Duration::from_nanos(FRAME.as_nanos() as u64 * k)
}

impl Clock {
    /// The desk frame `now` is, if no look saw it yet.
    pub fn frame(&mut self, now: Instant) -> Option<u64> {
        let Some(epoch) = self.epoch else {
            self.epoch = Some(now);
            self.last = 0;
            return Some(0);
        };
        let k = (now.saturating_duration_since(epoch).as_nanos() / FRAME.as_nanos()) as u64;
        if k <= self.last {
            return None;
        }
        let late = now.saturating_duration_since(frame_at(epoch, k));
        if late >= FRAME / 2 {
            self.epoch = Some(now - (frame_at(epoch, k) - epoch));
        }
        self.last = k;
        Some(k)
    }

    /// No surface is on the clock: it stops until one is.
    pub fn stop(&mut self) {
        self.epoch = None;
    }

    /// When desk frame `k` is, while the clock runs.
    pub fn at(&self, k: u64) -> Option<Instant> {
        self.epoch.map(|epoch| frame_at(epoch, k))
    }

    /// The last desk frame a look saw.
    pub fn last(&self) -> u64 {
        self.last
    }

    /// When the next desk frame is, while the clock runs.
    pub fn next(&self) -> Option<Instant> {
        self.at(self.last + 1)
    }
}

/// When a press asks for its next begin frame, until when, and the paints it was heard at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Press {
    next: Instant,
    until: Instant,
    paints: u64,
}

/// One surface's place on the clock: which desk frames its pace takes, when it last painted or
/// heard something, and the begin frames a press asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pacing {
    pace: u32,
    /// The desk frame its pace counts from: its first frame since the pace was set.
    base: Option<u64>,
    /// The paints seen so far and when the count last moved.
    paints: u64,
    painted: Option<Instant>,
    /// When it last painted or heard something (`None`: not looked at yet).
    active: Option<Instant>,
    press: Option<Press>,
}

impl Pacing {
    /// A surface painting at most `pace` frames a second; its first desk frame is its own.
    pub fn new(pace: u32) -> Pacing {
        Pacing {
            pace: pace.clamp(1, RATE),
            base: None,
            paints: 0,
            painted: None,
            active: None,
            press: None,
        }
    }

    pub fn pace(&self) -> u32 {
        self.pace
    }

    /// The compositor's hint: at most `fps` frames a second from the next desk frame on.
    pub fn set_pace(&mut self, fps: u32) {
        self.pace = fps.clamp(1, RATE);
        self.base = None;
    }

    /// The surface heard something at `at` (input, a message, a lifecycle change): it is awake.
    pub fn heard(&mut self, at: Instant) {
        self.active = Some(self.active.map_or(at, |t| t.max(at)));
    }

    /// The surface heard a press or a key at `at`, having painted `paints` frames. An idle one
    /// (nothing painted for `IDLE`) gets begin frames every `PROMPT` from `at` until it paints, for
    /// at most `PROMPT_FOR`; one that paints already takes every desk frame and needs none.
    pub fn press(&mut self, at: Instant, paints: u64) {
        self.saw(at, paints);
        self.heard(at);
        if self
            .painted
            .is_some_and(|t| at.saturating_duration_since(t) < IDLE)
        {
            return;
        }
        self.press = Some(Press {
            next: at,
            until: at + PROMPT_FOR,
            paints: self.paints,
        });
    }

    /// Whether the surface gets a begin frame at `now`, when `frame` is the desk frame `now` is (if
    /// a look has not seen it yet) and `paints` how many frames it has painted. Call it on every look.
    pub fn due(&mut self, now: Instant, frame: Option<u64>, paints: u64) -> bool {
        self.saw(now, paints);
        self.active.get_or_insert(now);
        let paced = frame.is_some_and(|k| {
            let long_idle = self.long_idle(now);
            let takes = self.takes(k, long_idle);
            if !long_idle && self.base.is_none_or(|base| base > k) {
                self.base = Some(k);
            }
            takes
        });
        let pressed = self.pressed(now);
        paced || pressed
    }

    fn saw(&mut self, now: Instant, paints: u64) {
        if paints != self.paints {
            self.paints = paints;
            self.painted = Some(now);
            self.heard(now);
        }
    }

    /// Whether it painted nothing and heard nothing for `LONG_IDLE` by `now`.
    pub fn long_idle(&self, now: Instant) -> bool {
        self.active
            .is_some_and(|t| now.saturating_duration_since(t) >= LONG_IDLE)
    }

    /// Whether desk frame `k` is one its pace takes: counted from its base, or, long idle, at most
    /// `IDLE_RATE` a second on the frames every long-idle surface takes.
    fn takes(&self, k: u64, long_idle: bool) -> bool {
        let (rate, from) = if long_idle {
            (self.pace.min(IDLE_RATE), 0)
        } else {
            (self.pace, self.base.filter(|base| *base <= k).unwrap_or(k))
        };
        (k - from) * u64::from(rate) % u64::from(RATE) < u64::from(rate)
    }

    fn pressed(&mut self, now: Instant) -> bool {
        let Some(press) = self.press else {
            return false;
        };
        if self.paints != press.paints {
            // Its paint came: the next frames are the desk's.
            self.press = None;
            return false;
        }
        if now < press.next {
            return false;
        }
        // A look that came a `PROMPT` late or more takes one, not every one it missed.
        let mut next = press.next + PROMPT;
        if next <= now {
            next = now + PROMPT;
        }
        self.press = (next <= press.until).then_some(Press { next, ..press });
        true
    }

    /// When it wants its next look on `clock` at `now`: a press's next begin frame, or the next desk
    /// frame its pace takes (within a second; `None` while the clock is stopped).
    pub fn next(&self, clock: &Clock, now: Instant) -> Option<Instant> {
        let long_idle = self.long_idle(now);
        let last = clock.last();
        let paced = (1..=u64::from(RATE))
            .map(|j| last + j)
            .find(|k| self.takes(*k, long_idle))
            .and_then(|k| clock.at(k));
        [self.press.map(|p| p.next), paced]
            .into_iter()
            .flatten()
            .min()
    }
}

impl Default for Pacing {
    fn default() -> Pacing {
        Pacing::new(RATE)
    }
}

#[cfg(test)]
#[path = "frames_tests.rs"]
mod tests;
