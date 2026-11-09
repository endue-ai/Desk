//! Crash reports from the shell's window (#322, desk-boot's `Crash`).

use desk_boot::crash::Crash;
use serde_json::Value;
use tauri::State;

/// An uncaught error or rejection in the shell's window.
#[tauri::command]
pub fn desk_crash(message: String, stack: String, crash: State<'_, Crash>) -> bool {
    crash.record(&message, &stack)
}

/// The newest report not shown yet, now marked shown.
#[tauri::command]
pub fn take_last_crash(crash: State<'_, Crash>) -> Option<Value> {
    crash.take_last()
}
