//! The desk's frame clock for web surfaces (#111, #117): every windowless browser runs with
//! `external_begin_frame_enabled`, so its page renders only when the clock sends it a begin frame
//! (`SendExternalBeginFrame`). The clock counts desk frames (60 Hz) from when a surface comes on it;
//! each is a begin frame for every visible, awake surface its pace takes (the compositor's `pace`
//! hint as a skip rule: 30 fps takes every other frame, 10 every sixth). Hidden, asleep and dead
//! surfaces are not on it.
//!
//! A surface that painted nothing and heard nothing for `LONG_IDLE` rests: it takes no desk frame
//! until it hears something (input, a compositor message for it), or its page asks for frames
//! (`frame_asks.js`: a change of its own, or one a message to it made, that no frame came for), so
//! a desk at rest has nothing on its clock (#134). An ask brings the desk frames within
//! `ASKED_FOR`; input or a compositor message puts it back on every frame its pace takes, and so
//! does painting (`PAINTING`), while a lone paint (a caret's blink) keeps it on slow frames
//! (`SLOW`) for `LONG_IDLE` (#163), two of them a blink once its rhythm shows (R1,
//! `frames_rhythm.rs`). `Pacing` (`frames_pacing.rs`) keeps each surface's.
//!
//! A press, a key, a composition or a focus change an idle surface hears (one that painted nothing
//! for `IDLE`) is followed by a begin frame every `PROMPT`, from `PROMPT_AFTER` after the press on
//! (`PROMPT_AFTER_REST` for a surface at rest), until it paints or `PROMPT_FOR` after the press,
//! whatever its pace: its paint then comes from the first begin frame its page can use rather than
//! the next desk frames. Chromium's display holds a begin frame the page has nothing for yet until
//! its deadline, a desk frame on, and CEF sends no begin frame while one is out, so a prompt that
//! comes before the page has handled the press costs a frame; the full pipeline that ended such a
//! begin frame at once (ADR 0157) stopped the desk's page for good after a resize, and the desk runs
//! without it (ADR 0210, `pipeline.rs`). Engine free: `clock.rs` sends the begin frames.
//!
//! Each paint is a GPU copy, and the GPU's first copy after a second or more without one takes
//! milliseconds more: input to a desk that painted nothing for `COLD` (`Copies`, kept by
//! `copy_wake.rs` from the paints the clock sees) wakes the GPU's copies at once (#133).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use desk_surface::generated::CompositorMessage as M;

use super::lifecycle::State;

#[path = "frames_pacing.rs"]
mod pacing;
pub use pacing::Pacing;

/// One desk frame: the display's rate.
pub const FRAME: Duration = Duration::from_micros(16_667);
/// Desk frames a second, the most a surface's pace takes.
pub const RATE: u32 = 60;
/// After input to an idle surface, begin frames this often from the press on, until its paint, for
/// at most `PROMPT_FOR` (two desk frames).
pub const PROMPT: Duration = Duration::from_millis(1);
pub const PROMPT_FOR: Duration = Duration::from_micros(33_333);
/// A press's first prompt comes this long after it (ADR 0210): time for the page to handle it, so
/// the begin frame finds its change. At once, the press painted 17 to 20 ms after it at the median
/// in the surface probe; 2 ms on, 6 to 8.
pub const PROMPT_AFTER: Duration = Duration::from_millis(2);
/// The same for a surface at rest (`Pacing::long_idle`), whose page takes longer to wake: a press
/// on a desk at rest painted 35.5 ms after it at p95 with its prompts from 0 to 8 ms on, 28 to 29
/// from 14 or 16.
pub const PROMPT_AFTER_REST: Duration = Duration::from_millis(16);
/// A surface that painted nothing for this long is idle: a press prompts it.
pub const IDLE: Duration = Duration::from_micros(33_333);
/// A surface that painted nothing and heard nothing for this long (and was sent `SLOW` begin
/// frames since its last paint) is long idle: it rests.
pub const LONG_IDLE: Duration = Duration::from_secs(1);
/// Two paints less than this apart, the later one less than this ago: the surface is painting (an
/// animation, a video, a GIF of four frames a second or more) and takes every frame its pace takes.
pub const PAINTING: Duration = Duration::from_millis(250);
/// The slow frames a second (100 ms apart, on times of the surface's own) a surface takes after a
/// lone paint, as a caret's blink is, hearing nothing: for `LONG_IDLE` and at least this many.
pub const SLOW: u32 = 10;
/// When the page of a surface resting or on the slow frames asks for frames, it takes the desk
/// frames within this long: two or three, the renderer's frame and the display's.
pub const ASKED_FOR: Duration = Duration::from_micros(41_667);
/// The GPU's first copy after about a second without one takes milliseconds more, in the desk's
/// process and in Chromium's GPU process alike (#133): input to a desk that painted nothing for
/// this long wakes the GPU's copies first (`clock.rs`).
pub const COLD: Duration = Duration::from_millis(500);

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

/// What a browser heard: input, which wakes it onto every desk frame; input whose paint should
/// follow at once (`prompts`); or its page asking for frames while it rests (#134), with how long
/// its main frame has waited since its first ask (#157, `stall.rs`; `None`: a frame in it asked).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Heard {
    Woken,
    Prompt,
    Asked(Option<Duration>),
}

/// What a browser heard since the clock last looked: (identifier, when, what). Input reaches a
/// browser through `input::deliver` from the web host and from the compositor's page alike, and its
/// page's asks as `desk.wake` messages; the host's clock takes them on its next look (CEF's UI
/// thread, all of them).
static HEARD: Mutex<Vec<(i32, Instant, Heard)>> = Mutex::new(Vec::new());
/// The most kept for the next look: the oldest go first.
const KEPT: usize = 64;

/// Browser `browser` heard input now; `prompt`: input whose paint should follow at once
/// (`prompts`), else it only wakes the surface onto every desk frame.
pub fn heard(browser: i32, prompt: bool) {
    hear(browser, if prompt { Heard::Prompt } else { Heard::Woken });
}

/// Browser `browser`'s page asked for frames now (`frame_asks.js`), having waited `waited`.
pub fn asked(browser: i32, waited: Option<Duration>) {
    hear(browser, Heard::Asked(waited));
}

fn hear(browser: i32, what: Heard) {
    let mut heard = HEARD.lock().unwrap_or_else(|e| e.into_inner());
    if heard.len() >= KEPT {
        heard.remove(0);
    }
    heard.push((browser, Instant::now(), what));
}

/// Whether a browser heard input whose paint should follow at once since the clock last looked:
/// the clock wants a look now (the pump's stand-in asks, #129).
pub fn prompted() -> bool {
    HEARD
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .any(|(_, _, what)| *what == Heard::Prompt)
}

/// What the browsers heard since the last call.
pub fn take_heard() -> Vec<(i32, Instant, Heard)> {
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

/// When the desk's GPU last copied: each paint the host takes (a copy to the compositor's texture),
/// and the wake-up input brings to a desk whose copies are cold (#133, `copy_wake.rs`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Copies {
    last: Option<Instant>,
}

impl Copies {
    /// A surface painted at `at`.
    pub fn copied(&mut self, at: Instant) {
        self.last = Some(self.last.map_or(at, |t| t.max(at)));
    }

    /// Input came at `now`: whether the GPU's copies need waking (none for `COLD`), which counts
    /// as a copy.
    pub fn wake(&mut self, now: Instant) -> bool {
        let cold = self
            .last
            .is_none_or(|t| now.saturating_duration_since(t) >= COLD);
        if cold {
            self.copied(now);
        }
        cold
    }
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

#[cfg(test)]
#[path = "frames_tests.rs"]
mod tests;
