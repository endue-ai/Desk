//! How this start goes (ADR 0061), from desk-boot's start record: `desk_start` hands the runtime
//! what the start found, `desk_relaunch` starts the desk again without safe mode ("Start normally").

use desk_boot::start::{self, Start};
use serde_json::Value;
use tauri::{AppHandle, State};

/// What this start found: `{ safe?: { reason, heldOff }, broken: [{ name, path }], dataDir }`.
#[tauri::command]
pub fn desk_start(start: State<'_, Start>) -> Value {
    start.info()
}

/// Start the desk again without `--safe` and without `DESK_SAFE`, then quit. The single-instance lock
/// goes first, or the new process would hand its arguments to this one and quit itself.
#[tauri::command]
pub fn desk_relaunch(app: AppHandle) {
    start::relaunch(|| app.cleanup_before_exit());
}
