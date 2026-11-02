use tauri::State;

use crate::trace::Tracing;

/// The runtime reports its status line once the bridge answered. Logged so launches can be checked
/// from the terminal and by smoke tests; the start-up trace marks it as the ready line. Answers
/// whether that trace is on, so the runtime sends its phases (`desk_trace`) only then.
#[tauri::command]
pub fn desk_ready(status: String, tracing: State<'_, Tracing>) -> bool {
    println!("{status}");
    tracing.instant(desk_trace::READY_LINE);
    tracing.write();
    tracing.on()
}
