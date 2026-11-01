//! The Tauri shell: windows, the webview and the plugin URL scheme. Everything else lives in desk-core.

mod commands;
mod events;
mod file_urls;
mod open_files;
mod palette;
mod palette_assets;
mod protocol;
mod socket;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use desk_brain_endue::HttpBrain;
use desk_bridge::{
    BrainConversePermission, CmdInvokePermission, ConnectorManagePermission, Permission,
    PluginManagePermission, ViewManagePermission,
};
use desk_core::{
    BrainMode, BrainOptions, Core, MockRemote, PluginWatcher, Roots, SyncError, SyncOutcome,
    ViewWatcher,
};
use desk_index::Index;
use tauri::{Emitter, Manager};

/// The caller id of the web runtime itself. Plugins call under their own ids.
pub const RUNTIME_CALLER: &str = "desk";

/// Where the brain lives unless `DESK_BRAIN_URL` says otherwise: examples/brain-echo (`just brain-echo`).
pub const DEFAULT_BRAIN_URL: &str = "http://127.0.0.1:8787/v0";

/// Where init.yaml lives under home unless `DESK_INIT` names another file, like `~/.emacs.d/init.el`.
pub const INIT_FILE: &str = ".desk/init.yaml";

/// How often the connector scheduler looks for due syncs.
const CONNECTOR_TICK: std::time::Duration = std::time::Duration::from_secs(1);

/// Keeps the hot-reload and views watchers alive for the life of the app.
struct Watching(#[allow(dead_code)] Mutex<(Option<PluginWatcher>, Option<ViewWatcher>)>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(open_files::OpenFiles::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            open_files::deliver(app, open_files::argument_paths(args));
            open_files::focus(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, |ctx, request, responder| {
            // A file URL reads from disk: answer from the blocking pool, never the main thread.
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(protocol::serve(&app, &request));
            });
        })
        .setup(|app| {
            app.state::<open_files::OpenFiles>()
                .push(open_files::argument_paths(
                    std::env::args_os().map(|arg| arg.into_string().unwrap_or_default()),
                ));
            let data = app.path().app_data_dir()?;
            let home = home_dir();
            let init = std::env::var_os("DESK_INIT")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(INIT_FILE));
            // endue does not serve sync yet: until it does, a stand-in keeps endue's copy of
            // init.yaml in the data folder.
            let remote = MockRemote::with_file(data.join("sync-mock.json"));
            let mut core = Core::new(Roots { home })
                .with_init_file(init)
                .with_sync(Arc::new(remote), Some(data.join("sync.json")))
                .with_plugin_store(data.join("plugins.json"))
                .with_store_file(data.join("store.json"))
                .with_secrets_file(data.join("secrets.json"));
            if let Some(problem) = core.init_problem() {
                eprintln!("endue Desk: init.yaml is not in force ({problem}); using the defaults");
            }
            // The item index (ADR 0033): without it data.* answers io_error and syncs fail.
            match Index::open(data.join("index.sqlite")) {
                Ok(index) => core = core.with_index(Arc::new(index)),
                Err(why) => eprintln!("endue Desk: no item index ({why}); data.* is unavailable"),
            }
            // The OS calendar makes the built-in connectors desk.calendar and desk.reminders. It is
            // macOS only for now; elsewhere there is none, and nothing asks the OS until connect.
            if let Ok(calendar) = desk_sys::calendar::os() {
                core = core.with_calendar(Arc::from(calendar));
            }
            // Before plugins install, so a setup pulled from another desk applies from this start.
            sync_init(&core);
            let url =
                std::env::var("DESK_BRAIN_URL").unwrap_or_else(|_| DEFAULT_BRAIN_URL.to_owned());
            match HttpBrain::new(&url) {
                Ok(brain) => {
                    // An HTTP brain is endue AI or brain-echo: brain.status names it cloud.
                    let options = BrainOptions {
                        state_file: Some(data.join("brain.json")),
                        mode: BrainMode::Cloud,
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
            // Keys run commands for the person, whoever provides them (ADR 0017).
            core.grant(
                RUNTIME_CALLER,
                Permission::CmdInvoke(CmdInvokePermission {
                    permission: Default::default(),
                    ids: vec!["*".to_owned()],
                }),
            );
            // The shell talks to the brain and reads its agent directory as the runtime.
            core.grant(
                RUNTIME_CALLER,
                Permission::BrainConverse(BrainConversePermission {
                    permission: Default::default(),
                }),
            );
            // The runtime connects the person's connectors and keeps their views (ADR 0036).
            core.grant(
                RUNTIME_CALLER,
                Permission::ConnectorManage(ConnectorManagePermission {
                    permission: Default::default(),
                }),
            );
            core.grant(
                RUNTIME_CALLER,
                Permission::ViewManage(ViewManagePermission {
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
            core.start_connectors();
            core.start_connector_scheduler(CONNECTOR_TICK);
            let views = core.watch_views().ok();
            for problem in core.view_problems() {
                eprintln!("endue Desk: a view is left out ({problem})");
            }
            app.manage(Watching(Mutex::new((watcher, views))));

            // Core events reach the runtime as Tauri events, each with the callers it is for, so the
            // runtime can hand an addressed event (a perm.prompt, a subscribed event) to the plugin it
            // names. Subscribing this way also tells the core a router listens: without one it never
            // sends a prompt and the Prompter decides alone.
            let events = core.events().subscribe_addressed();
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("desk-events".to_owned())
                .spawn(move || {
                    for delivery in events {
                        let _ = handle.emit("bridge://event", events::payload(delivery));
                    }
                })?;
            // The desk CLI reaches the core over a same-user socket as `cli`, and hears every core
            // event too (ADR 0030).
            app.manage(socket::serve(&core));
            app.manage(Arc::clone(&core));
            palette::setup(app, &core)?;
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
            palette::palette_hide,
            palette::palette_reveal_main,
            palette::palette_prepare_main,
            palette::palette_present,
            commands::files::take_open_files
        ])
        .build(tauri::generate_context!())
        .expect("endue Desk failed to start")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                open_files::deliver(_app, urls.iter().filter_map(open_files::file_url));
            }
        });
}

fn sync_init(core: &Core) {
    match core.sync_init() {
        Ok(SyncOutcome::Conflict { revision }) => {
            let copy = core.init_remote_copy().unwrap_or_default();
            eprintln!(
                "endue Desk: init.yaml changed here and on endue (revision {revision}); \
                 endue's copy is in {}",
                copy.display()
            );
        }
        Ok(outcome) => eprintln!("endue Desk: init.yaml sync: {outcome:?}"),
        Err(SyncError::Off) => {}
        Err(why) => eprintln!("endue Desk: init.yaml not synced ({why})"),
    }
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
