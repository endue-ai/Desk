//! Chromium's tracing around a probe run (#117): `DESK_PROBE_TRACE=<file>` writes a trace of the
//! scenario to `<file>` (JSON for `chrome://tracing` or Perfetto), the frame pipeline's categories
//! unless `DESK_PROBE_TRACE_CATEGORIES` names others. CEF writes the file only when the end of
//! tracing has a callback and its message loop runs until the callback comes, which is why #111's
//! runs left none: the probe pumps until then.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use cef::*;

use super::Probe;

/// The browser's input, the renderers' and the display's schedulers, the capture and CEF's paints.
const CATEGORIES: &str = "cc,viz,gpu,gpu.capture,input,benchmark,toplevel,blink,latencyInfo,cef,\
    disabled-by-default-cc.debug.scheduler,disabled-by-default-cc.debug.scheduler.frames";
/// The longest the probe waits for tracing to start or for its file.
const WAIT: Duration = Duration::from_secs(60);

wrap_completion_callback! {
    struct Started {
        done: Arc<AtomicBool>,
    }

    impl CompletionCallback {
        fn on_complete(&self) {
            self.done.store(true, Ordering::SeqCst);
        }
    }
}

wrap_end_tracing_callback! {
    struct Written {
        done: Arc<AtomicBool>,
    }

    impl EndTracingCallback {
        fn on_end_tracing_complete(&self, _tracing_file: Option<&CefString>) {
            self.done.store(true, Ordering::SeqCst);
        }
    }
}

/// Start tracing if this run asks for it, once every process traces: the file to write it to.
pub fn begin(probe: &mut Probe) -> Option<String> {
    let file = std::env::var("DESK_PROBE_TRACE").ok()?;
    let categories =
        std::env::var("DESK_PROBE_TRACE_CATEGORIES").unwrap_or_else(|_| CATEGORIES.to_owned());
    let started = Arc::new(AtomicBool::new(false));
    let mut callback = Started::new(Arc::clone(&started));
    if begin_tracing(Some(&categories.as_str().into()), Some(&mut callback)) != 1 {
        eprintln!("surface probe: Chromium's tracing did not start");
        return None;
    }
    probe.pump_until(WAIT, |_| started.load(Ordering::SeqCst));
    Some(file)
}

/// Stop tracing and run CEF until every process's events are in `file`.
pub fn end(probe: &mut Probe, file: &str) {
    let written = Arc::new(AtomicBool::new(false));
    let mut callback = Written::new(Arc::clone(&written));
    if end_tracing(Some(&file.into()), Some(&mut callback)) != 1
        || !probe.pump_until(WAIT, |_| written.load(Ordering::SeqCst))
    {
        eprintln!("surface probe: no trace written to {file}");
    }
}
