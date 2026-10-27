//! The Tauri shell: windows and the webview. Everything else lives in desk-core.

mod commands;

use std::path::PathBuf;

use desk_core::{Core, Roots};

/// The caller id of the web runtime itself. Plugins get their own ids with the plugin loader.
pub const RUNTIME_CALLER: &str = "desk";

pub fn run() {
    let core = Core::new(Roots { home: home_dir() });
    tauri::Builder::default()
        .manage(core)
        .invoke_handler(tauri::generate_handler![
            commands::bridge::bridge_call,
            commands::ready::desk_ready
        ])
        .run(tauri::generate_context!())
        .expect("endue Desk failed to start");
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}
