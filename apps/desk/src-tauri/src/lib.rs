//! The Tauri shell: windows, the webview and the plugin URL scheme. Everything else lives in desk-core.

mod commands;
mod protocol;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use desk_bridge::{Permission, PluginManagePermission};
use desk_core::{Core, PluginWatcher, Roots};
use tauri::{Emitter, Manager};

/// The caller id of the web runtime itself. Plugins call under their own ids.
pub const RUNTIME_CALLER: &str = "desk";

/// Keeps the hot-reload watcher alive for the life of the app.
struct Watching(#[allow(dead_code)] Mutex<Option<PluginWatcher>>);

pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol(protocol::SCHEME, |ctx, request| {
            protocol::serve(ctx.app_handle(), &request)
        })
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let core = Arc::new(
                Core::new(Roots { home: home_dir() })
                    .with_plugin_store(data.join("plugins.json"))
                    .with_store_file(data.join("store.json")),
            );
            // The runtime mounts plugins, so it may list and toggle them.
            core.grant(
                RUNTIME_CALLER,
                Permission::PluginManage(PluginManagePermission {
                    permission: Default::default(),
                }),
            );
            for dir in env_paths("DESK_PLUGIN_DIRS") {
                core.install_plugins_in(&dir, true);
            }
            for dir in env_paths("DESK_DEV_PLUGINS") {
                core.install_plugin(&dir, false);
            }
            let watcher = core.watch_plugins().ok();
            app.manage(Watching(Mutex::new(watcher)));

            // Core events reach the runtime as Tauri events; the runtime routes them to plugins.
            let events = core.events().subscribe();
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("desk-events".to_owned())
                .spawn(move || {
                    for event in events {
                        let _ = handle.emit("bridge://event", event);
                    }
                })?;
            app.manage(core);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bridge::bridge_call,
            commands::ready::desk_ready
        ])
        .run(tauri::generate_context!())
        .expect("endue Desk failed to start");
}

/// Folders from a PATH-style environment variable (`:` on Unix, `;` on Windows).
fn env_paths(name: &str) -> Vec<PathBuf> {
    std::env::var_os(name)
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default()
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}
