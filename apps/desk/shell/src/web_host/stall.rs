//! A page that stopped painting (#157). CEF sends a browser no begin frame while one is out, and a
//! begin frame that never ends leaves its page without frames for good: the clock goes on sending
//! (`clock.rs` counts them) and the page draws nothing again, while its scripts, timers and input
//! go on unseen. The shell cannot see a begin frame that is out, but the page's ask script
//! (`frame_asks.js`) can see that frames do not come: an ask that repeats an unmet one says how long
//! its page has waited for a frame since it first asked. A page whose `requestAnimationFrame` loop
//! changes nothing paints nothing either, but its frames come, so its asks never repeat.
//!
//! So a surface is stalled when its page asks again `AFTER` times in a row, each time after begin
//! frames the clock sent it since the ask before (none while it was hidden, asleep or held: such an
//! ask starts the count again), and it painted nothing meanwhile: about `AFTER` seconds, as a
//! waiting page asks again a second on. The host says so once (the log, `compositor_stats`), and a
//! plugin surface's page is loaded again in its browser, which gives it a new frame sink and its
//! frames back; the runtime hands the new page its last `desk:state` as after any load. A second
//! load waits `AGAIN` after the first. The desk's own page is only reported: loading it again would
//! restart the runtime.

use std::time::{Duration, Instant};

/// The asks in a row, a second apart, that make a stall.
pub const AFTER: u32 = 3;
/// The least time between two loads of one surface for its stalls.
pub const AGAIN: Duration = Duration::from_secs(10);

/// What the host does about a stall the watch found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Say so: the page stays as it is (the desk's own page, or one loaded again within `AGAIN`).
    Report,
    /// Say so and load the page again.
    Reload,
}

/// A stall the watch found: what to do, how long the page has waited for a frame since it first
/// asked, and how many begin frames the clock sent it since the count started.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Found {
    pub verdict: Verdict,
    pub waited: Duration,
    pub fed: u64,
}

/// One surface's watch.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Watch {
    /// The paints seen so far.
    paints: u64,
    /// Begin frames sent since the page's last ask, and since the count of asks started.
    fed: u64,
    fed_since: u64,
    /// The asks in a row that repeated an unmet one after begin frames.
    asks: u32,
    /// Found stalled, and nothing painted since.
    stalled: bool,
    /// When its page was last loaded again for a stall.
    reloaded: Option<Instant>,
}

impl Watch {
    /// The surface has painted `paints` frames: a new paint ends any stall and its count.
    pub fn saw(&mut self, paints: u64) {
        if paints != self.paints {
            self.paints = paints;
            self.asks = 0;
            self.fed_since = 0;
            self.stalled = false;
        }
    }

    /// The clock sent it a begin frame.
    pub fn fed(&mut self) {
        self.fed += 1;
        self.fed_since += 1;
    }

    /// Its page asked for frames at `at`, having waited `waited` since its first ask for the want
    /// still unmet (zero: a first ask), with `paints` painted so far. `reload`: the host can load
    /// the page again. A stall found now, unless it was found already and cannot be loaded again yet.
    pub fn asked(
        &mut self,
        at: Instant,
        waited: Duration,
        paints: u64,
        reload: bool,
    ) -> Option<Found> {
        self.saw(paints);
        let fed = std::mem::take(&mut self.fed);
        if waited.is_zero() || fed == 0 {
            // A first ask, or one that no begin frame preceded: the count starts here.
            self.asks = 0;
            self.fed_since = 0;
            return None;
        }
        self.asks += 1;
        if self.asks < AFTER {
            return None;
        }
        let may_reload = reload
            && self
                .reloaded
                .is_none_or(|t| at.saturating_duration_since(t) >= AGAIN);
        let first = !self.stalled;
        self.stalled = true;
        let verdict = if may_reload {
            self.reloaded = Some(at);
            Verdict::Reload
        } else if first {
            Verdict::Report
        } else {
            return None;
        };
        Some(Found {
            verdict,
            waited,
            fed: self.fed_since,
        })
    }

    /// Whether it is stalled now: found, and nothing painted since.
    pub fn stalled(&self) -> bool {
        self.stalled
    }

    /// Its page loads again (a restart, a reload, a new browser): the count starts over; when it
    /// was last loaded for a stall is kept.
    pub fn restart(&mut self) {
        *self = Watch {
            paints: self.paints,
            reloaded: self.reloaded,
            ..Watch::default()
        };
    }
}

#[cfg(test)]
#[path = "stall_tests.rs"]
mod tests;
