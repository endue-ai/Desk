//! When a desk reads its channel index by itself: 30 s after start, then every four hours spread
//! ± 10 % so desks do not arrive together, and sooner after a failure (1 m, 5 m, 30 m) before
//! falling back to the four hours.

use std::time::Duration;

pub const START: Duration = Duration::from_secs(30);
pub const INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);
pub const BACKOFF: [Duration; 3] = [
    Duration::from_secs(60),
    Duration::from_secs(5 * 60),
    Duration::from_secs(30 * 60),
];

/// Failures in a row so far.
#[derive(Debug, Default)]
pub struct Schedule {
    failures: usize,
}

impl Schedule {
    /// The wait before the first check.
    pub fn first(&self) -> Duration {
        START
    }

    /// The wait after a check that `succeeded`; `jitter` in -1..=1 spreads the interval ± 10 %.
    pub fn next(&mut self, succeeded: bool, jitter: f64) -> Duration {
        if succeeded {
            self.failures = 0;
        } else {
            self.failures += 1;
            if let Some(wait) = BACKOFF.get(self.failures - 1) {
                return *wait;
            }
        }
        INTERVAL.mul_f64(1.0 + jitter.clamp(-1.0, 1.0) * 0.1)
    }
}

/// A jitter in -1..=1 from the OS's randomness (0 when there is none).
pub fn jitter() -> f64 {
    let mut bytes = [0u8; 4];
    if getrandom::fill(&mut bytes).is_err() {
        return 0.0;
    }
    f64::from(u32::from_le_bytes(bytes)) / f64::from(u32::MAX) * 2.0 - 1.0
}
