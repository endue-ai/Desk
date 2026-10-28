use std::sync::Arc;

use desk_bridge::{
    BridgeError, BridgeFailure, BridgeRequest, BridgeResponse, ErrorCode, False, RequestId,
};
use desk_core::{Core, RUNTIME_CALLER, request_head};
use tauri::{AppHandle, Manager, Window};

use crate::frames::Routing;

/// Every bridge call from the web runtime, for itself or for a plugin it hosts. Plugin frames are
/// sandboxed and cannot reach this command; the runtime names the plugin it calls for. The core
/// checks permissions; this only forwards. Calls run off the main thread: a permission prompt or
/// a slow fetch blocks only its own call. The work a call starts belongs to the calling frame.
#[tauri::command]
pub async fn bridge_call(
    app: AppHandle,
    window: Window,
    request: BridgeRequest,
    caller: Option<String>,
) -> BridgeResponse {
    let caller = caller.unwrap_or_else(|| RUNTIME_CALLER.to_owned());
    let (id, method) = request_head(&request);
    #[cfg(debug_assertions)]
    if caller != RUNTIME_CALLER {
        eprintln!("bridge: {caller} {method}");
    }
    let core = app.state::<Arc<Core>>().inner().clone();
    let response = tauri::async_runtime::spawn_blocking(move || core.handle(&caller, request))
        .await
        .unwrap_or_else(|why| failure(id, why.to_string()));
    app.state::<Routing>()
        .claim(&app, window.label(), method, &response);
    response
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
