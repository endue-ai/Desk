use desk_core::{LaunchGuard, SafeReason};
use serde_json::{Value, json};

/// How this launch started, kept for the life of the app.
pub struct Boot {
    pub guard: LaunchGuard,
    pub safe: Option<SafeReason>,
}

/// What the runtime needs before it mounts: whether the desk is in safe mode (and the words for it).
#[tauri::command]
pub fn desk_boot(boot: tauri::State<'_, Boot>) -> Value {
    json!({ "safeMode": boot.safe.map(SafeReason::describe) })
}
