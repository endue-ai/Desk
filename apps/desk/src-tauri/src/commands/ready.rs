use tauri::State;

use super::start::Start;

/// The runtime reports its status line once the bridge answered. Logged so launches can be checked
/// from the terminal and by smoke tests, and marked in last-start.json: this start made it (ADR 0061).
#[tauri::command]
pub fn desk_ready(status: String, start: State<'_, Start>) {
    println!("{status}");
    start.ready();
}
