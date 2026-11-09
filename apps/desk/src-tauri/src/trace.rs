//! The runtime's start-up phases for the trace (`DESK_TRACE=1`, desk-boot's `Tracing`).

use desk_boot::trace::Tracing;
use desk_trace::RuntimePhase;
use tauri::State;

/// The runtime's start-up phases (User Timing measures, ms from `origin`, the page's
/// `performance.timeOrigin`). Each report replaces the one before. Main window only.
#[tauri::command]
pub fn desk_trace(tracing: State<'_, Tracing>, origin: f64, phases: Vec<RuntimePhase>) {
    tracing.runtime(origin, &phases);
}
