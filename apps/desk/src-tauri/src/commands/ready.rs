//! The runtime's status line (desk-boot's `ready`): logged, the start marked ready, the trace's
//! ready line, and init.yaml's MCP servers attached the first time (ADR 0061, ADR 0098).

use desk_boot::mcp::McpServers;
use desk_boot::start::Start;
use desk_boot::trace::Tracing;
use tauri::State;

/// Answers whether the start-up trace is on, so the runtime sends its phases (`desk_trace`) only then.
#[tauri::command]
pub fn desk_ready(
    status: String,
    tracing: State<'_, Tracing>,
    start: State<'_, Start>,
    mcp: State<'_, McpServers>,
) -> bool {
    desk_boot::ready::ready(&status, &tracing, &start, &mcp)
}
