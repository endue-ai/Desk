//! One surface's place on the desk's frame clock (`frames.rs`): which desk frames its pace takes,
//! when it rests, its page's asks and a press's prompt frames.
//!
//! It takes every desk frame its pace takes while it heard something within `LONG_IDLE`, or while
//! it paints (`PAINTING`: an animation, a video). A lone paint, a change no paint follows soon (a
//! caret's blink every half second), keeps it on slow frames (`SLOW` a second) for `LONG_IDLE`, and
//! until `SLOW` begin frames went out after it: Chromium asks the desk for nothing, so a change its
//! page cannot see (the next blink) still finds a begin frame within a tenth of a second, and an
//! event loop held longer than that (a long task in CEF's work) does not rest the surface with a
//! blink unpainted. The slow frames keep their times from its first one on, not the desk frames'
//! numbers, which start again from a late look (`Clock::frame`): so a blink, on a timer of the
//! page's own, meets them at the same moment each time and keeps its rhythm. Before, a paint put a
//! surface on every frame for a second, so a blinking caret took 60 begin frames a second for two
//! paints (#163). Once three lone paints came on slow frames the same time apart (a caret's blink),
//! its slow frames skip ahead after each to one slow period before the next (`frames_rhythm.rs`):
//! four begin frames a second for a caret where ten kept its desk busy (R1). With nothing painted
//! or heard for `LONG_IDLE` it rests: no desk frame until it hears something or its page asks
//! (#134).

use std::time::{Duration, Instant};

use super::{
    ASKED_FOR, Clock, FRAME, IDLE, LONG_IDLE, PAINTING, PROMPT, PROMPT_AFTER, PROMPT_FOR, RATE,
    SLOW,
};

#[path = "frames_rhythm.rs"]
mod rhythm;
use rhythm::Rhythm;

/// When a press asks for its next begin frame, until when, and the paints it was heard at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Press {
    next: Instant,
    until: Instant,
    paints: u64,
}

/// Which desk frames a surface takes now (`Pacing::mode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// Every frame its pace takes: it heard something within `LONG_IDLE`, or it is painting.
    Every,
    /// The slow frames: a lone paint within `LONG_IDLE` or fewer than `SLOW` frames ago, nothing
    /// heard.
    Slow,
    /// None: it painted nothing for `LONG_IDLE` and `SLOW` frames, and heard nothing.
    Rest,
}

/// One surface's place on the clock: which desk frames its pace takes, when it last painted or
/// heard something, the begin frames a press asks for, and until when its page asked for frames.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pacing {
    pace: u32,
    /// The desk frame its pace counts from: its first frame since the pace was set.
    base: Option<u64>,
    /// The paints seen so far, when the count last moved, when it moved before that, and the begin
    /// frames sent since.
    paints: u64,
    painted: Option<Instant>,
    painted_before: Option<Instant>,
    fed: u32,
    /// Its page has painted since it loaded. Until then it counts as asking for frames, so a page
    /// whose start-up script holds its thread past `LONG_IDLE` (and with it the ask's timers) still
    /// gets them once it rests.
    shown_since_load: bool,
    /// When it last heard something (`None`: not looked at yet).
    heard_at: Option<Instant>,
    /// On the slow frames, when the next one is.
    slow_at: Option<Instant>,
    /// The last begin frame's time on the slow frames, while it was a slow one: a paint seen next
    /// came on it, a beat of its lone paints' rhythm.
    sent_slow: Option<Instant>,
    rhythm: Rhythm,
    press: Option<Press>,
    asked: Option<Instant>,
}

impl Pacing {
    /// A surface painting at most `pace` frames a second; its first desk frame is its own.
    pub fn new(pace: u32) -> Pacing {
        Pacing {
            pace: pace.clamp(1, RATE),
            base: None,
            paints: 0,
            painted: None,
            painted_before: None,
            fed: 0,
            shown_since_load: false,
            heard_at: None,
            slow_at: None,
            sent_slow: None,
            rhythm: Rhythm::default(),
            press: None,
            asked: None,
        }
    }

    pub fn pace(&self) -> u32 {
        self.pace
    }

    /// When a look last saw it paint.
    pub fn painted(&self) -> Option<Instant> {
        self.painted
    }

    /// The compositor's hint: at most `fps` frames a second from the next desk frame on.
    pub fn set_pace(&mut self, fps: u32) {
        self.pace = fps.clamp(1, RATE);
        self.base = None;
    }

    /// The surface heard something at `at` (input, a message, a lifecycle change): it is awake.
    pub fn heard(&mut self, at: Instant) {
        self.heard_at = Some(self.heard_at.map_or(at, |t| t.max(at)));
    }

    /// Its page started loading at `at` (a first load, a restart, a reload in place): until the new
    /// page paints, it counts as asking for frames.
    pub fn loading(&mut self, at: Instant) {
        self.shown_since_load = false;
        self.heard(at);
    }

    /// Its page asked for frames at `at` (`frame_asks.js`): resting or on the slow frames, it takes
    /// the desk frames within `ASKED_FOR`.
    pub fn ask(&mut self, at: Instant) {
        self.asked = Some(at + ASKED_FOR);
    }

    /// The surface heard a press or a key at `at`, having painted `paints` frames. An idle one
    /// (nothing painted for `IDLE`) gets begin frames every `PROMPT` from `PROMPT_AFTER` after `at`
    /// on until it paints, until `PROMPT_FOR` after `at` at most, and no desk frame before the first
    /// (`due`); one that paints already takes every desk frame and needs none.
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
            next: at + PROMPT_AFTER,
            until: at + PROMPT_FOR,
            paints: self.paints,
        });
    }

    /// Whether the surface gets a begin frame at `now`, when `frame` is the desk frame `now` is (if
    /// a look has not seen it yet) and `paints` how many frames it has painted. Call it on every look.
    pub fn due(&mut self, now: Instant, frame: Option<u64>, paints: u64) -> bool {
        self.saw(now, paints);
        self.heard_at.get_or_insert(now);
        let mode = self.mode(now);
        if mode != Mode::Slow {
            self.slow_at = None;
        }
        let asked = frame.is_some() && self.asked_at(now);
        let mut slow = None;
        let paced = match mode {
            Mode::Every => frame.is_some_and(|k| {
                if self.base.is_none_or(|base| base > k) {
                    self.base = Some(k);
                }
                self.takes(k)
            }),
            Mode::Slow => {
                slow = self.slow(now);
                slow.is_some() || asked
            }
            Mode::Rest => asked,
        };
        let prompt = self.pressed(now);
        // A press's desk frames wait for its first prompt: a begin frame before its page handled
        // the press finds nothing to draw, Chromium's display holds it to its deadline, and CEF
        // sends none while it is out, so the prompt would wait a frame behind it (ADR 0210).
        let held = !prompt && self.press.is_some_and(|p| now < p.next);
        let due = prompt || paced && !held;
        if due {
            self.sent_slow = slow;
        }
        self.fed = self.fed.saturating_add(u32::from(due));
        due
    }

    /// The period of the lone paints' rhythm it takes its slow frames at, while it holds.
    pub fn rhythm(&self) -> Option<Duration> {
        self.rhythm.period()
    }

    /// A look at `now` saw `paints` painted. A new page's first paint wakes it as input does: the
    /// page has only just come up.
    fn saw(&mut self, now: Instant, paints: u64) {
        if paints != self.paints {
            self.paints = paints;
            self.painted_before = self.painted;
            self.painted = Some(now);
            self.fed = 0;
            // On a slow frame, a beat of a rhythm; on another, none.
            match self.sent_slow.take() {
                Some(at) => {
                    let step = self.slow_period();
                    if let Some(next) = self.rhythm.painted(at, step) {
                        self.slow_at = Some(next);
                    }
                }
                None => self.rhythm.broken(),
            }
            if !self.shown_since_load {
                self.shown_since_load = true;
                self.heard(now);
            }
        }
    }

    /// Which desk frames it takes at `now`.
    fn mode(&self, now: Instant) -> Mode {
        let within =
            |at: Option<Instant>, d| at.is_some_and(|t| now.saturating_duration_since(t) < d);
        let apart =
            (self.painted.zip(self.painted_before)).map(|(p, b)| p.saturating_duration_since(b));
        let painting = within(self.painted, PAINTING) && apart.is_some_and(|d| d < PAINTING);
        if painting || self.heard_at.is_none() || within(self.heard_at, LONG_IDLE) {
            Mode::Every
        } else if within(self.painted, LONG_IDLE) || self.painted.is_some() && self.fed < SLOW {
            Mode::Slow
        } else {
            Mode::Rest
        }
    }

    /// Whether it rests at `now`: it painted nothing for `LONG_IDLE` (and `SLOW` frames sent since
    /// its last paint) and heard nothing.
    pub fn long_idle(&self, now: Instant) -> bool {
        self.mode(now) == Mode::Rest
    }

    /// Whether its page's ask still holds at `now`, or its page has not painted since it loaded (its
    /// asks may not have run yet).
    fn asked_at(&self, now: Instant) -> bool {
        !self.shown_since_load || self.asked.is_some_and(|until| now <= until)
    }

    /// Whether desk frame `k` is one its pace takes, counted from its base.
    fn takes(&self, k: u64) -> bool {
        let from = self.base.filter(|base| *base <= k).unwrap_or(k);
        (k - from) * u64::from(self.pace) % u64::from(RATE) < u64::from(self.pace)
    }

    /// How far apart its slow frames are: `SLOW` a second, or its pace if that is slower.
    fn slow_period(&self) -> Duration {
        FRAME * RATE.div_ceil(self.pace.min(SLOW))
    }

    /// On the slow frames at `now`: the time of the one due. The first comes a period after it came
    /// on them, each later one a whole number of periods after it, or where its rhythm skipped
    /// them to; a late look takes one.
    fn slow(&mut self, now: Instant) -> Option<Instant> {
        let period = self.slow_period();
        let at = *self.slow_at.get_or_insert(now + period);
        if now < at {
            return None;
        }
        let missed = now.duration_since(at).as_nanos() / period.as_nanos();
        let ahead = u32::try_from(missed + 1).unwrap_or(u32::MAX);
        self.slow_at = Some(at + period.saturating_mul(ahead));
        Some(at)
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

    /// When it wants its next look on `clock` at `now` (`None` while the clock is stopped): a press's
    /// next begin frame (its desk frames wait for it), or the next desk frame its pace takes, or the
    /// next slow one, or, resting, none; short of every frame, the next desk frame while its page's
    /// ask holds.
    pub fn next(&self, clock: &Clock, now: Instant) -> Option<Instant> {
        if let Some(press) = self.press {
            return Some(press.next);
        }
        let last = clock.last();
        let mode = self.mode(now);
        let paced = match mode {
            Mode::Every => (1..=u64::from(RATE))
                .map(|j| last + j)
                .find(|k| self.takes(*k))
                .and_then(|k| clock.at(k)),
            Mode::Slow => clock
                .at(last)
                .map(|_| self.slow_at.unwrap_or(now + self.slow_period())),
            Mode::Rest => None,
        };
        let asked = clock
            .next()
            .filter(|at| mode != Mode::Every && self.asked_at(now) && self.asked_at(*at));
        [paced, asked].into_iter().flatten().min()
    }
}

impl Default for Pacing {
    fn default() -> Pacing {
        Pacing::new(RATE)
    }
}

#[cfg(test)]
#[path = "frames_pacing_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "frames_slow_tests.rs"]
mod slow_tests;
