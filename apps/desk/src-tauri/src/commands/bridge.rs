use std::sync::Arc;

use desk_bridge::{
    BridgeError, BridgeFailure, BridgeRequest, BridgeResponse, ErrorCode, False, RequestId,
};
use desk_core::{Core, RUNTIME_CALLER};
use tauri::{AppHandle, Manager};

/// Every bridge call from the web runtime, for itself or for a plugin it hosts. Plugin frames are
/// sandboxed and cannot reach this command; the runtime names the plugin it calls for. The core
/// checks permissions; this only forwards. Calls run off the main thread: a permission prompt or
/// a slow fetch blocks only its own call.
#[tauri::command]
pub async fn bridge_call(
    app: AppHandle,
    request: BridgeRequest,
    caller: Option<String>,
) -> BridgeResponse {
    let caller = caller.unwrap_or_else(|| RUNTIME_CALLER.to_owned());
    #[cfg(debug_assertions)]
    if caller != RUNTIME_CALLER {
        let value = serde_json::to_value(&request).unwrap_or_default();
        eprintln!(
            "bridge: {caller} {}",
            value["method"].as_str().unwrap_or("?")
        );
    }
    let id = request_id(&request);
    let core = app.state::<Arc<Core>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.handle(&caller, request))
        .await
        .unwrap_or_else(|why| failure(id, why.to_string()))
}

fn request_id(request: &BridgeRequest) -> RequestId {
    serde_json::to_value(request)
        .ok()
        .and_then(|value| value["id"].as_u64())
        .unwrap_or_default()
}

fn failure(id: RequestId, message: String) -> BridgeResponse {
    BridgeResponse::BridgeFailure(BridgeFailure {
        id,
        ok: False,
        error: BridgeError {
            code: ErrorCode::Internal,
            message,
            permission: None,
        },
    })
}
