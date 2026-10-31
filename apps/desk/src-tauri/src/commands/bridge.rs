use std::sync::Arc;

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::Core;
use tauri::{AppHandle, Manager};

use crate::RUNTIME_CALLER;

/// Every bridge call from the web runtime, for itself or for a plugin it hosts. Plugin frames are
/// sandboxed and cannot reach this command; the runtime names the plugin it calls for. The core
/// checks permissions; this only forwards. It runs off the main thread, since a call may wait (a
/// perm.request, the OS calendar prompt on connector.connect) and the window must not freeze. A
/// call that stops without an answer (the core panicked) rejects the invoke.
#[tauri::command]
pub async fn bridge_call(
    app: AppHandle,
    request: BridgeRequest,
    caller: Option<String>,
) -> Result<BridgeResponse, String> {
    let caller = caller.unwrap_or_else(|| RUNTIME_CALLER.to_owned());
    #[cfg(debug_assertions)]
    if caller != RUNTIME_CALLER {
        let value = serde_json::to_value(&request).unwrap_or_default();
        eprintln!(
            "bridge: {caller} {}",
            value["method"].as_str().unwrap_or("?")
        );
    }
    let core = Arc::clone(&app.state::<Arc<Core>>());
    tauri::async_runtime::spawn_blocking(move || core.handle(&caller, request))
        .await
        .map_err(|why| format!("the bridge call stopped: {why}"))
}
