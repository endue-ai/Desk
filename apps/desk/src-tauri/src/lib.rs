//! The Tauri shell: windows, the webview and the plugin URL scheme. Everything else lives in desk-core.

mod commands;
mod computer;
mod crash;
mod eris_window;
mod file_urls;
mod open_files;
mod palette;
mod palette_assets;
mod protocol;
mod run_event;
mod trace;
mod tray;
mod update;

use std::{sync::Arc, time::Instant};

use desk_boot::{BootInput, Booted};
use tauri::{Emitter, Manager};

/// The caller id of the web runtime itself. Plugins call under their own ids.
pub use desk_boot::RUNTIME_CALLER;

pub fn run() {
    // Process start for the start-up trace (DESK_TRACE=1): its clock reads 0 here.
    let origin = desk_trace::Origin::now();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(open_files::OpenFiles::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            open_files::deliver(app, open_files::argument_paths(args));
            open_files::focus(app);
        }))
        .plugin(tauri_plugin_dialog::init());
    // The Tauri updater, only when this build updates itself (ADR 0054).
    update::register(builder)
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, |ctx, request, responder| {
            // A file URL reads from disk: answer from the blocking pool, never the main thread.
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::serve(&app, &request));
            });
        })
        .setup(move |app| {
            app.state::<open_files::OpenFiles>()
                .push(open_files::argument_paths(
                    std::env::args_os().map(|arg| arg.into_string().unwrap_or_default()),
                ));
            let data = app.path().app_data_dir()?;
            let version = app.package_info().version.to_string();
            // The desk's own updates (ADR 0054), when this build carries an updater key.
            let updater = update::updater(app.handle(), &data);
            let handle = app.handle().clone();
            let computer_data = data.clone();
            // Everything that is not Tauri's: the core, its files, grants, plugins and services.
            let Booted {
                core,
                start,
                crash,
                tracing,
                mcp,
                events,
                keep,
            } = desk_boot::boot(BootInput {
                data,
                home: desk_boot::boot::home_dir(),
                version,
                origin,
                updater: updater.clone(),
                // Computer use (ADR 0120, ADR 0123) drives this shell's windows.
                attach: Some(Box::new(move |core: &Arc<desk_core::Core>| {
                    computer::attach(core, &handle, &computer_data)
                })),
                plugin_dirs: desk_boot::boot::env_paths("DESK_PLUGIN_DIRS"),
                dev_plugins: desk_boot::boot::env_paths("DESK_DEV_PLUGINS"),
            });
            let started = Instant::now();
            // Core events reach the runtime as Tauri events, each with the callers it is for, so the
            // runtime can hand an addressed event (a perm.prompt, a subscribed event) to the plugin it
            // names.
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("desk-events".to_owned())
                .spawn(move || {
                    for delivery in events {
                        let _ = handle.emit("bridge://event", desk_boot::events::payload(delivery));
                    }
                })?;
            app.manage(start);
            app.manage(crash);
            app.manage(keep);
            app.manage(Arc::clone(&core));
            app.manage(mcp);
            palette::setup(app, &core)?;
            eris_window::setup(app)?;
            core.start_updates();
            if let Some(updater) = updater {
                tray::follow(app.handle(), &updater);
                app.manage(update::Updates(updater));
            }
            tracing.phase("app services", started);
            tracing.write();
            app.manage(tracing);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bridge::bridge_call,
            commands::ready::desk_ready,
            commands::start::desk_start,
            commands::start::desk_relaunch,
            trace::desk_trace,
            palette::palette_hide,
            palette::palette_reveal_main,
            palette::palette_prepare_main,
            palette::palette_present,
            commands::files::take_open_files,
            crash::desk_crash,
            crash::take_last_crash
        ])
        .build(tauri::generate_context!())
        .expect("endue Desk failed to start")
        .run(run_event::handle);
}
