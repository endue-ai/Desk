//! The Tauri shell: windows, the webview and the plugin URL scheme. Everything else lives in desk-core.

mod commands;
mod frames;
mod lifecycle;
mod prompt;
mod protocol;
mod updates;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use desk_brain_endue::HttpBrain;
use desk_bridge::{Permission, PluginManagePermission};
use desk_core::{BrainOptions, Core, LaunchGuard, PluginWatcher, RUNTIME_CALLER, Roots};
use desk_sys::audio::{NoWakeWord, SystemMicrophone, WakeDetector};
use tauri::Manager;

use crate::commands::boot::Boot;
use crate::frames::Routing;
use crate::prompt::NativePrompter;

/// Where the brain lives unless `DESK_BRAIN_URL` says otherwise: examples/brain-echo (`just brain-echo`).
pub const DEFAULT_BRAIN_URL: &str = "http://127.0.0.1:8787/v0";

/// Keeps the hot-reload watcher alive for the life of the app.
struct Watching(#[allow(dead_code)] Mutex<Option<PluginWatcher>>);

pub fn run() {
    updates::plugin(tauri::Builder::default())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(protocol::SCHEME, |ctx, request| {
            protocol::serve(ctx.app_handle(), &request)
        })
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let guard = LaunchGuard::new(data.join("launch.json"));
            let safe = guard.begin(safe_mode_asked());
            if let Some(reason) = safe {
                eprintln!("endue Desk: {}", reason.describe());
            }
            app.manage(Boot { guard, safe });
            let mut core = Core::new(Roots { home: home_dir() })
                .with_safe_mode(safe.is_some())
                .with_prompter(NativePrompter::new(app.handle().clone()))
                .with_plugin_store(data.join("plugins.json"))
                .with_store_file(data.join("store.json"))
                // No wake-word engine yet (ADR 0020): captures open the microphone, audio.wake waits.
                .with_audio(
                    Arc::new(SystemMicrophone),
                    Arc::new(|| Box::new(NoWakeWord) as Box<dyn WakeDetector>),
                );
            let url =
                std::env::var("DESK_BRAIN_URL").unwrap_or_else(|_| DEFAULT_BRAIN_URL.to_owned());
            match HttpBrain::new(&url) {
                Ok(brain) => {
                    let options = BrainOptions {
                        state_file: Some(data.join("brain.json")),
                        ..BrainOptions::default()
                    };
                    core = core.with_brain(Arc::new(brain), options);
                }
                Err(why) => eprintln!("endue Desk: no brain ({why}); brain.say is unavailable"),
            }
            let core = Arc::new(core);
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

            // Core events reach each frame's runtime as Tauri events (per frame, ADR 0018); the
            // runtime routes them on to its plugins.
            app.manage(Routing::new());
            let events = core.events().subscribe();
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("desk-events".to_owned())
                .spawn(move || {
                    for event in events {
                        handle.state::<Routing>().deliver(&handle, &event);
                    }
                })?;
            app.manage(core);
            lifecycle::install(app);
            updates::check_later(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bridge::bridge_call,
            commands::boot::desk_boot,
            commands::ready::desk_ready,
            commands::frames::frame_open,
            commands::frames::frame_close,
            commands::frames::frame_list
        ])
        .build(tauri::generate_context!())
        .expect("endue Desk failed to start")
        .run(lifecycle::on_run_event);
}

/// `--safe-mode` on the command line, or `DESK_SAFE_MODE=1`.
fn safe_mode_asked() -> bool {
    std::env::args().any(|arg| arg == "--safe-mode")
        || std::env::var("DESK_SAFE_MODE").is_ok_and(|value| value == "1")
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
