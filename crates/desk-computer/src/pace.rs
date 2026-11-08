//! How fast and whether input goes out: the stop flag, the rate limit and the clock they run on.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// The longest a rate-limited wait sleeps before it looks at the stop flag again.
const STOP_POLL: Duration = Duration::from_millis(10);
/// The shortest wait, so a clock that only moves when slept on always moves.
const MIN_SLEEP: Duration = Duration::from_micros(100);

/// The emergency stop. Raising it aborts every queued and running action at its next event, and
/// refuses new ones, until it is cleared: only the person (through the core) should clear it.
/// Clones share one flag; the desk holds one `Control`, so its flag stops all of the desk's input.
#[derive(Debug, Clone, Default)]
pub struct StopFlag(Arc<AtomicBool>);

impl StopFlag {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn raise(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn clear(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    pub fn is_raised(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// At most `per_second` events a second on average, and up to `burst` at once after a pause. An AX
/// action or an app action counts as one event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RateLimit {
    pub per_second: u32,
    pub burst: u32,
}

impl RateLimit {
    /// Both at least 1.
    pub fn new(per_second: u32, burst: u32) -> Self {
        Self {
            per_second: per_second.max(1),
            burst: burst.max(1),
        }
    }
}

impl Default for RateLimit {
    /// 60 events a second, 10 at once: a double click goes out at once, a 20-step drag in about
    /// 0.2 s, a page of text in about a second.
    fn default() -> Self {
        Self::new(60, 10)
    }
}

/// Monotonic time and sleeping, injectable so tests run on a fake clock.
pub trait Clock: Send + Sync {
    /// Time since some fixed start; never goes back.
    fn now(&self) -> Duration;
    fn sleep(&self, duration: Duration);
}

/// The real clock.
#[derive(Debug, Clone, Copy)]
pub struct SystemClock {
    start: Instant,
}

impl SystemClock {
    pub fn new() -> Self {
        Self {
            start: Instant::now(),
        }
    }
}

impl Default for SystemClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for SystemClock {
    fn now(&self) -> Duration {
        self.start.elapsed()
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

/// A token bucket over a `RateLimit`: full (`burst` tokens) at first use, refilled at `per_second`.
#[derive(Debug)]
pub(crate) struct Bucket {
    limit: RateLimit,
    tokens: f64,
    /// When `tokens` was last brought up to date; `None` before the first event.
    at: Option<Duration>,
}

/// The stop flag was raised while an event waited for its turn.
pub(crate) struct Stopped;

impl Bucket {
    pub(crate) fn new(limit: RateLimit) -> Self {
        Self {
            limit,
            tokens: 0.0,
            at: None,
        }
    }

    /// Wait until one event may go out and take its token. Waits in slices of at most 10 ms and
    /// gives up with `Stopped` as soon as `stop` is raised.
    pub(crate) fn take(&mut self, clock: &dyn Clock, stop: &StopFlag) -> Result<(), Stopped> {
        let rate = f64::from(self.limit.per_second);
        let burst = f64::from(self.limit.burst);
        loop {
            let now = clock.now();
            self.tokens = match self.at {
                None => burst,
                Some(at) => (self.tokens + now.saturating_sub(at).as_secs_f64() * rate).min(burst),
            };
            self.at = Some(now);
            // A whole token, give or take rounding in the durations.
            if self.tokens >= 1.0 - 1e-6 {
                self.tokens = (self.tokens - 1.0).max(0.0);
                return Ok(());
            }
            if stop.is_raised() {
                return Err(Stopped);
            }
            let wait = Duration::from_secs_f64((1.0 - self.tokens) / rate);
            clock.sleep(wait.clamp(MIN_SLEEP, STOP_POLL));
            if stop.is_raised() {
                return Err(Stopped);
            }
        }
    }
}
