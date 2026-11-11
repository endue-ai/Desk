//! One surface's place on the desk's frame clock (`frames.rs`): which desk frames its pace takes,
//! when it rests, its page's asks and a press's prompt frames.

use std::time::Instant;

use super::{ASKED_FOR, Clock, IDLE, LONG_IDLE, PROMPT, PROMPT_FOR, RATE};

/// When a press asks for its next begin frame, until when, and the paints it was heard at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Press {
    next: Instant,
    until: Instant,
    paints: u64,
}

/// One surface's place on the clock: which desk frames its pace takes, when it last painted or
/// heard something, the begin frames a press asks for, and until when its page asked for frames.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pacing {
    pace: u32,
    /// The desk frame its pace counts from: its first frame since the pace was set.
    base: Option<u64>,
    /// The paints seen so far and when the count last moved.
    paints: u64,
    painted: Option<Instant>,
    /// Its page has painted since it loaded. Until then it counts as asking for frames, so a page
    /// whose start-up script holds its thread past `LONG_IDLE` (and with it the ask's timers) still
    /// gets them once it rests.
    shown_since_load: bool,
    /// When it last painted or heard something (`None`: not looked at yet).
    active: Option<Instant>,
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
            shown_since_load: false,
            active: None,
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
        self.active = Some(self.active.map_or(at, |t| t.max(at)));
    }

    /// Its page started loading at `at` (a first load, a restart, a reload in place): until the new
    /// page paints, it counts as asking for frames.
    pub fn loading(&mut self, at: Instant) {
        self.shown_since_load = false;
        self.heard(at);
    }

    /// Its page asked for frames at `at` (`frame_asks.js`): resting, it takes the desk frames within
    /// `ASKED_FOR`, and a paint they bring wakes it as any paint does.
    pub fn ask(&mut self, at: Instant) {
        self.asked = Some(at + ASKED_FOR);
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
            if self.long_idle(now) {
                return self.asked_at(now);
            }
            if self.base.is_none_or(|base| base > k) {
                self.base = Some(k);
            }
            self.takes(k)
        });
        let pressed = self.pressed(now);
        paced || pressed
    }

    fn saw(&mut self, now: Instant, paints: u64) {
        if paints != self.paints {
            self.paints = paints;
            self.painted = Some(now);
            self.shown_since_load = true;
            self.heard(now);
        }
    }

    /// Whether it painted nothing and heard nothing for `LONG_IDLE` by `now`.
    pub fn long_idle(&self, now: Instant) -> bool {
        self.active
            .is_some_and(|t| now.saturating_duration_since(t) >= LONG_IDLE)
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
    /// frame its pace takes (within a second; `None` while the clock is stopped), or, resting, the
    /// next desk frame while its page's ask holds and none otherwise.
    pub fn next(&self, clock: &Clock, now: Instant) -> Option<Instant> {
        let last = clock.last();
        let paced = if self.long_idle(now) {
            clock
                .next()
                .filter(|at| self.asked_at(now) && self.asked_at(*at))
        } else {
            (1..=u64::from(RATE))
                .map(|j| last + j)
                .find(|k| self.takes(*k))
                .and_then(|k| clock.at(k))
        };
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
#[path = "frames_pacing_tests.rs"]
mod tests;
