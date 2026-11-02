//! The start-up trace. With `DESK_TRACE` set (to anything but empty or `0`) the app records each
//! start-up phase and writes them into its data folder as `trace.json`, in the Trace Event
//! Format's JSON object form (`traceEvents`), which chrome://tracing and Perfetto open.
//! `desk doctor --trace` prints [`summarize`]'s view of one: every phase, totals, the five longest.
//!
//! Times are µs from process start, the first statement of the app's `run()`. The core's phases
//! are taken on its own clock; the runtime's come as User Timing measures (ms from the webview's
//! `performance.timeOrigin`) and are put on the same clock through the wall time at process start.

use std::ffi::OsStr;

mod summary;
mod writer;

pub use summary::{Mark, Phase, Summary, Total, summarize};
pub use writer::{Origin, RuntimePhase, Trace};

/// The environment variable that turns the trace on.
pub const ENV: &str = "DESK_TRACE";
/// The file the trace is written to, in the app's data folder.
pub const FILE: &str = "trace.json";
/// The instant the app printed its ready line (`desk_ready`).
pub const READY_LINE: &str = "ready line";
/// The runtime's phase from desk ready to the frame that shows it.
pub const FIRST_FRAME: &str = "first interactive frame";
/// The gap from the core's last phase to the webview's time origin, filled in by the writer.
pub const WEBVIEW_START: &str = "webview start";
/// A runtime phase named `mount <plugin id>` is that plugin's mount, on a track of its own.
pub const MOUNT: &str = "mount ";

/// Whether a value of [`ENV`] turns the trace on: anything but unset, empty or `0`.
pub fn enabled(value: Option<&OsStr>) -> bool {
    value.is_some_and(|value| !value.is_empty() && value != "0")
}
