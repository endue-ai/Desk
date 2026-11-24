//! The runtime's status line (`desk_ready`).

use crate::mcp::McpServers;
use crate::start::Start;
use crate::trace::Tracing;

/// The runtime reports its status line once the bridge answered. Logged so launches can be checked
/// from the terminal and by smoke tests; a ready line is marked in the start-up trace and in
/// last-start.json: this start made it (ADR 0061). Answers
/// whether that trace is on, so the runtime sends its phases (`desk_trace`) only then. The first ready
/// line attaches init.yaml's MCP servers (ADR 0098): their grant prompts need the runtime.
pub fn ready(status: &str, tracing: &Tracing, start: &Start, mcp: &McpServers) -> bool {
    println!("{status}");
    start.ready();
    if is_ready_line(status) {
        tracing.instant(desk_trace::READY_LINE);
        tracing.write();
        mcp.attach_once();
        // A crash on purpose, so a live check can see the report on any build (#322).
        if crate::crash::forced_panic(std::env::var("DESK_E2E_PANIC").ok().as_deref()) {
            panic!("DESK_E2E_PANIC=1: a crash on purpose after the ready line");
        }
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
    fn recognizes_the_current_and_previous_ready_lines() {
        assert!(is_ready_line("endue ready · bridge: cef"));
        assert!(is_ready_line("desk ready · bridge: tauri"));
        assert!(!is_ready_line("endue cannot reach the core · bridge: cef"));
        assert!(!is_ready_line("desk cannot reach the core · bridge: tauri"));
        assert!(!is_ready_line("QA {\"id\":0}"));
    }

    #[test]
    fn a_connection_error_keeps_the_saved_start_in_progress() {
        use std::fs;
        use std::sync::Arc;
        use std::time::{SystemTime, UNIX_EPOCH};

        use desk_core::{Core, LastStart, Roots};
        use serde_json::Value;

        use super::{McpServers, Start, Tracing, ready};

        let now = SystemTime::now();
        let stamp = now.duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("endue-ready-{}-{stamp}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        let file = dir.join("last-start.json");
        let core = Arc::new(Core::new(Roots { home: dir.clone() }));
        let (last, _) = LastStart::begin(&file, now, std::process::id());
        let start = Start::new(&core, &dir, last);
        let mcp = McpServers::new(&core, dir.clone());
        let trace = Tracing::default();
        let phase =
            || serde_json::from_slice::<Value>(&fs::read(&file).unwrap()).unwrap()["phase"].clone();

        ready(
            "endue cannot reach the core · bridge: cef",
            &trace,
            &start,
            &mcp,
        );
        let after_error = phase();
        ready("endue ready · bridge: cef", &trace, &start, &mcp);
        let after_ready = phase();
        drop(mcp);
        fs::remove_dir_all(dir).unwrap();
        assert_eq!(after_error, "starting");
        assert_eq!(after_ready, "ready");
    }
}
