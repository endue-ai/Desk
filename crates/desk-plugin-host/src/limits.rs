//! Per-instance limits: linear memory through a resource limiter, time through epoch interruption.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use wasmtime::{Engine, ResourceLimiter};

/// How often the engine's epoch advances; time limits are rounded up to whole ticks.
pub const TICK: Duration = Duration::from_millis(10);
/// Table elements one instance may hold.
const MAX_TABLE_ELEMENTS: usize = 100_000;

/// What one plugin instance may use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Linear memory, per memory.
    pub memory_bytes: usize,
    /// Wall time for each call into the plugin, instantiation included.
    pub time: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            memory_bytes: 64 << 20,
            time: Duration::from_secs(1),
        }
    }
}

impl Limits {
    /// The time limit in epoch ticks, at least one.
    pub(crate) fn ticks(&self) -> u64 {
        let ticks = self.time.as_nanos().div_ceil(TICK.as_nanos()).max(1);
        u64::try_from(ticks).unwrap_or(u64::MAX)
    }
}

/// Refuses memory and tables past the limits, and remembers that it did, so a trap that follows can
/// be reported as the memory limit rather than as a guest bug.
pub(crate) struct Limiter {
    memory_bytes: usize,
    pub(crate) exceeded: bool,
}

impl Limiter {
    pub(crate) fn new(limits: &Limits) -> Self {
        Self {
            memory_bytes: limits.memory_bytes,
            exceeded: false,
        }
    }
}

impl ResourceLimiter for Limiter {
    fn memory_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        if desired > self.memory_bytes {
            self.exceeded = true;
            wasmtime::bail!("memory limit of {} bytes reached", self.memory_bytes);
        }
        Ok(true)
    }

    fn table_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        Ok(desired <= MAX_TABLE_ELEMENTS)
    }
}

/// Advances the engine's epoch every `TICK` until dropped.
pub(crate) struct Ticker {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Ticker {
    pub(crate) fn start(engine: Engine) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("desk-plugin-epoch".into())
            .spawn(move || {
                while !stopped.load(Ordering::Relaxed) {
                    thread::sleep(TICK);
                    engine.increment_epoch();
                }
            })
            .expect("the epoch thread starts");
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
