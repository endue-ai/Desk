use tauri::State;

use super::start::Start;
use crate::mcp::McpServers;
use crate::trace::Tracing;

/// The runtime reports its status line once the bridge answered. Logged so launches can be checked
/// from the terminal and by smoke tests; a ready line is marked in the start-up trace and in
/// last-start.json: this start made it (ADR 0061). Answers
/// whether that trace is on, so the runtime sends its phases (`desk_trace`) only then. The first ready
/// line attaches init.yaml's MCP servers (ADR 0098): their grant prompts need the runtime.
#[tauri::command]
pub fn desk_ready(
    status: String,
    tracing: State<'_, Tracing>,
    start: State<'_, Start>,
    mcp: State<'_, McpServers>,
) -> bool {
    println!("{status}");
    start.ready();
    if is_ready_line(&status) {
        tracing.instant(desk_trace::READY_LINE);
        tracing.write();
        mcp.attach_once();
    }
    tracing.on()
}

/// Whether `status` is the ready line the install smoke waits for (`^desk ready`, e2e/smoke), not
/// "desk cannot reach the core" or another line printed through this command.
fn is_ready_line(status: &str) -> bool {
    status.starts_with("desk ready")
}

#[cfg(test)]
mod tests {
    use super::is_ready_line;

    #[test]
    fn only_the_desk_ready_line_is_the_ready_line() {
        assert!(is_ready_line("desk ready · bridge: tauri"));
        assert!(!is_ready_line("desk cannot reach the core · bridge: tauri"));
        assert!(!is_ready_line("QA {\"id\":0}"));
    }
}
