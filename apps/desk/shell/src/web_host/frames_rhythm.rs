//! A lone paint's rhythm (`frames_pacing.rs`): a caret blinks on a timer of its page's own, every
//! half second, and each blink is a lone paint the slow frames meet. Once three of them came on slow
//! frames the same time apart, the slow frames after each blink skip ahead to one slow period
//! before the next is due: two begin frames a blink where the slow frames sent five. The blink
//! still meets the first slow frame after it, as on every slow frame, so it keeps its rhythm; the
//! earlier of the two catches a blink that comes a slow period early, and the slow frames go on
//! after the later one until a paint comes (a blink that came late, moved or stopped). Each blink
//! sets where the next two frames are, a gap after it: a period the slow frames cannot measure
//! (530 ms meets frames 100 ms apart 500 and 600 ms apart) never moves the frames away from the
//! blink, nor merges two blinks into one paint. A blink further from its time than a slow period,
//! or a paint on another frame (input, an ask, every frame while it painted), starts the rhythm
//! again. What it costs: a change between two blinks that the page cannot see to ask for (a CSS
//! animation's step) waits for the next blink's frames, up to the period less a slow frame.

use std::time::{Duration, Instant};

use super::{LONG_IDLE, PAINTING};

/// The slow frames that painted, the same time apart, before the rhythm holds.
const BEATS: usize = 3;
/// How far apart two gaps may be and still count as the same: the slow frames keep times of the
/// surface's own, so a steady blink's gaps are equal to the nanosecond.
const SAME: Duration = Duration::from_millis(1);

/// The slow frames the last lone paints came on, and their period once it holds.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Rhythm {
    beats: Vec<Instant>,
    period: Option<Duration>,
}

impl Rhythm {
    /// A lone paint came on the slow frame at `at`, the slow frames `step` apart: the slow frame
    /// to go on from, while the rhythm holds (`None`: the next one).
    pub fn painted(&mut self, at: Instant, step: Duration) -> Option<Instant> {
        if let (Some(period), Some(last)) = (self.period, self.beats.last()) {
            let gap = at.saturating_duration_since(*last);
            if gap + step + SAME >= period && gap <= (period + step + SAME).min(LONG_IDLE) {
                self.beats = vec![at];
                self.period = Some(gap);
                return Some(at + gap.saturating_sub(step));
            }
            self.broken();
        }
        if self.beats.len() == BEATS {
            self.beats.remove(0);
        }
        self.beats.push(at);
        let gaps: Vec<Duration> = (self.beats.windows(2))
            .map(|w| w[1].saturating_duration_since(w[0]))
            .collect();
        let period = *gaps.last()?;
        let steady = gaps.len() == BEATS - 1
            && gaps.iter().all(|g| g.abs_diff(period) <= SAME)
            && (PAINTING..=LONG_IDLE).contains(&period);
        if !steady {
            return None;
        }
        self.beats = vec![at];
        self.period = Some(period);
        Some(at + period.saturating_sub(step))
    }

    /// A paint came on a frame other than a slow one: the rhythm starts again.
    pub fn broken(&mut self) {
        self.beats.clear();
        self.period = None;
    }

    /// The gap between its last two beats while the rhythm holds.
    pub fn period(&self) -> Option<Duration> {
        self.period
    }
}
