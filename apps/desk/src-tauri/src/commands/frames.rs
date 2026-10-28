use tauri::{AppHandle, Window};

use crate::frames;

/// Open a new frame. Returns its label.
#[tauri::command]
pub fn frame_open(app: AppHandle) -> Result<String, String> {
    frames::open(&app, None)
        .map(|window| window.label().to_owned())
        .map_err(|e| e.to_string())
}

/// Close the frame that asks. Closing the last one leaves the core running (ADR 0019).
#[tauri::command]
pub fn frame_close(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// The open frames, `main` first.
#[tauri::command]
pub fn frame_list(app: AppHandle) -> Vec<String> {
    frames::labels(&app)
}
