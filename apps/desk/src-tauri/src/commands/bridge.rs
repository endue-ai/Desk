use std::sync::Arc;

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::Core;

use crate::RUNTIME_CALLER;

/// Every bridge call from the web runtime, for itself or for a plugin it hosts. Plugin frames are
/// sandboxed and cannot reach this command; the runtime names the plugin it calls for. The core
/// checks permissions; this only forwards.
#[tauri::command]
pub async fn bridge_call(
    window: tauri::WebviewWindow,
    core: tauri::State<'_, Arc<Core>>,
    request: BridgeRequest,
    caller: Option<String>,
) -> Result<BridgeResponse, String> {
    let caller = if window.label() == crate::palette::LABEL {
        crate::palette::CALLER.to_owned()
    } else {
        caller.unwrap_or_else(|| RUNTIME_CALLER.to_owned())
    };
    #[cfg(debug_assertions)]
    if caller != RUNTIME_CALLER {
        let value = serde_json::to_value(&request).unwrap_or_default();
        eprintln!(
            "bridge: {caller} {}",
            value["method"].as_str().unwrap_or("?")
        );
    }
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.handle(&caller, request))
        .await
        .map_err(|e| e.to_string())
}
