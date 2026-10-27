use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::Core;

use crate::RUNTIME_CALLER;

/// Every bridge call from the web runtime. The core checks permissions; this only forwards.
#[tauri::command]
pub fn bridge_call(core: tauri::State<'_, Core>, request: BridgeRequest) -> BridgeResponse {
    core.handle(RUNTIME_CALLER, request)
}
