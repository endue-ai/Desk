//! The start-up trace (`DESK_TRACE=1`, crates/desk-trace): the core's phases from the boot, the
//! ready line from `desk_ready`, and the runtime's phases from `desk_trace`, written to `trace.json` in
//! the data folder each time something is added. Without `DESK_TRACE` every call does nothing.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use desk_trace::{Origin, RuntimePhase, Trace};

/// The trace of this start, when there is one.
#[derive(Clone, Default)]
pub struct Tracing(Option<Arc<Trace>>);

impl Tracing {
    /// A trace of this start when `DESK_TRACE` asks for one, into `data`.
    pub fn from_env(origin: Origin, data: &Path) -> Self {
        Self(Trace::from_env(origin, data).map(Arc::new))
    }

    pub fn on(&self) -> bool {
        self.0.is_some()
    }

    /// A core phase from `start` until now.
    pub fn phase(&self, name: &str, start: Instant) {
        if let Some(trace) = &self.0 {
            trace.phase(name, start);
        }
    }

    pub fn instant(&self, name: &str) {
        if let Some(trace) = &self.0 {
            trace.instant(name);
        }
    }

    /// The runtime's start-up phases (User Timing measures, ms from `origin`, the page's
    /// `performance.timeOrigin`). Each report replaces the one before; the file is written at once.
    pub fn runtime(&self, origin: f64, phases: &[RuntimePhase]) {
        if let Some(trace) = &self.0 {
            trace.runtime(origin, phases);
        }
        self.write();
    }

    /// Write the file now. A failure is logged once per write and the desk runs on.
    pub fn write(&self) {
        if let Some(trace) = &self.0
            && let Err(why) = trace.write()
        {
            let file = trace.file().unwrap_or(Path::new(desk_trace::FILE));
            eprintln!(
                "endue Desk: the start-up trace was not written to {} ({why})",
                file.display()
            );
        }
    }
}
