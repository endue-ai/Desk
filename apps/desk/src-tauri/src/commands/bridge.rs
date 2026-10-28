use std::sync::Arc;

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::Core;

use crate::RUNTIME_CALLER;

/// Every bridge call from the web runtime, for itself or for a plugin it hosts. Plugin frames are
/// sandboxed and cannot reach this command; the runtime names the plugin it calls for. The core
/// checks permissions; this only forwards.
#[tauri::command]
pub fn bridge_call(
    core: tauri::State<'_, Arc<Core>>,
    request: BridgeRequest,
    caller: Option<String>,
) -> BridgeResponse {
    let caller = caller.as_deref().unwrap_or(RUNTIME_CALLER);
    #[cfg(debug_assertions)]
    if caller != RUNTIME_CALLER {
        let value = serde_json::to_value(&request).unwrap_or_default();
        eprintln!(
            "bridge: {caller} {}",
            value["method"].as_str().unwrap_or("?")
        );
    }
    core.handle(caller, request)
}
