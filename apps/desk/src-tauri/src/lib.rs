//! The Tauri shell: windows, the webview and the plugin URL scheme. Everything else lives in desk-core.

mod brains;
mod commands;
mod core_files;
mod events;
mod file_urls;
mod mcp;
mod open_files;
mod palette;
mod palette_assets;
mod protocol;
mod socket;
mod trace;
mod tray;
mod update;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use desk_bridge::{
    AccountManagePermission, BrainConversePermission, CmdInvokePermission,
    ConnectorManagePermission, FsReadPermission, FsWritePermission, PermManagePermission,
    Permission, PluginManagePermission, ShellOpenPermission, ThemeManagePermission,
    UpdateManagePermission, ViewManagePermission,
};
use desk_core::account::{Account, AccountOptions, DEFAULT_ID_URL, NetIdClient};
use desk_core::{
    Core, MockRemote, PluginWatcher, Roots, SyncError, SyncOutcome, ThemeWatcher, ViewWatcher,
};
use tauri::{Emitter, Manager};

/// The caller id of the web runtime itself. Plugins call under their own ids.
pub const RUNTIME_CALLER: &str = "desk";

/// Where init.yaml lives under home unless `DESK_INIT` names another file, like `~/.emacs.d/init.el`.
pub const INIT_FILE: &str = ".desk/init.yaml";

/// How often the connector scheduler looks for due syncs.
const CONNECTOR_TICK: std::time::Duration = std::time::Duration::from_secs(1);

/// Keeps the hot-reload, views and user themes watchers alive for the life of the app.
struct Watching(#[allow(dead_code)] Mutex<Watchers>);

type Watchers = (
    Option<PluginWatcher>,
    Option<ViewWatcher>,
    Option<ThemeWatcher>,
);

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
            let tracing = trace::Tracing::from_env(origin, &data);
            tracing.phase("tauri start", origin.instant());
            let started = Instant::now();
            let home = home_dir();
            let init = std::env::var_os("DESK_INIT")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(INIT_FILE));
            // endue does not serve sync yet: until it does, a stand-in keeps endue's copy of
            // init.yaml in the data folder.
            let remote = MockRemote::with_file(data.join("sync-mock.json"));
            // plugins.lock: the plugin set, rewritten on every install and turn on or off (ADR 0079).
            let lock = home.join(".desk").join("plugins.lock");
            let core = Core::new(Roots { home })
                .with_init_file(init)
                .with_lock_file(lock)
                .with_sync(Arc::new(remote), Some(data.join("sync.json")));
            // Everything that outlives a quit: grants, settings, the log and the rest (#351).
            let core = core_files::open(core, &data);
            // Safe mode, asked for or after two starts that never got ready, holds plugins off as
            // they install (ADR 0061).
            let (mut core, last) = commands::start::begin(&data, core);
            if let Some(problem) = core.init_problem() {
                eprintln!("endue Desk: init.yaml is not in force ({problem}); using the defaults");
            }
            // The item index (ADR 0033): without it data.* answers io_error and syncs fail.
            // An index that cannot be opened is kept as index.sqlite.broken and opened fresh.
            core = core.with_index_file(data.join("index.sqlite"));
            if let Some(why) = core.index_problem() {
                eprintln!("endue Desk: no item index ({why}); data.* is unavailable");
            }
            // The OS calendar makes the built-in connectors desk.calendar and desk.reminders. It is
            // macOS only for now; elsewhere there is none, and nothing asks the OS until connect.
            if let Ok(calendar) = desk_sys::calendar::os() {
                core = core.with_calendar(Arc::from(calendar));
            }
            // Before plugins install, so a setup pulled from another desk applies from this start.
            sync_init(&core);
            // The person's own themes (ADR 0058): every theme folder in <data>/themes/ is installed
            // now, not built in, and comes back at every start.
            core = core.with_themes_dir(data.join("themes"));
            // The person's endue ID (ADR 0089): signing in hands the brain its bearer token.
            let id_url = std::env::var("DESK_ID_URL").unwrap_or_else(|_| DEFAULT_ID_URL.to_owned());
            let mut account = AccountOptions::new(id_url);
            account.file = Some(data.join("account.json"));
            let account = Account::open(account, NetIdClient);
            core = core.with_account(account.clone());
            // Eris's brain is the one the runtime's setting chooses, endue AI by default, and the
            // local brain stands in while a remote one cannot be reached (ADR 0094).
            core = core.with_brains(brains::brains(&data, account));
            // The desk's own updates (ADR 0054), when this build carries an updater key.
            let updater = update::updater(app.handle(), &data);
            if let Some(updater) = &updater {
                core = core.with_updater(updater.clone());
            }
            let core = Arc::new(core);
            // The brain's tool calls run in the core, each as the agent that asks (ADR 0072), and
            // every turn offers Eris the commands plugins mark as tools (ADR 0089).
            core.route_tools();
            core.start_account();
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
            // desk.describe names who may run a command and describes grants (ADR 0075): it lists
            // them, and shows them only to callers that may list them too.
            core.grant(
                RUNTIME_CALLER,
                Permission::PermManage(PermManagePermission {
                    permission: Default::default(),
                }),
            );
            // The shell talks to the brain and reads its agent directory as the runtime.
            core.grant(
                RUNTIME_CALLER,
                Permission::BrainConverse(BrainConversePermission {
                    permission: Default::default(),
                }),
            );
            // The theme studio asks the brain for themes, each ask in a session of its own (ADR 0059).
            core.grant(
                RUNTIME_CALLER,
                Permission::BrainAsk(desk_bridge::BrainAskPermission {
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
            // The person's files in the desk folder (ADR 0079): the runtime reads and watches the
            // folder, and writes only the saved profiles and keys.yaml.
            core.grant(
                RUNTIME_CALLER,
                Permission::FsRead(FsReadPermission {
                    permission: Default::default(),
                    paths: vec!["~/.desk/**".to_owned()],
                }),
            );
            core.grant(
                RUNTIME_CALLER,
                Permission::FsWrite(FsWritePermission {
                    permission: Default::default(),
                    paths: vec![
                        "~/.desk/profiles/**".to_owned(),
                        "~/.desk/keys.yaml".to_owned(),
                    ],
                }),
            );
            // The runtime shows the update and restarts into it when the person asks (ADR 0054).
            core.grant(
                RUNTIME_CALLER,
                Permission::UpdateManage(UpdateManagePermission {
                    permission: Default::default(),
                }),
            );
            // The runtime signs the desk in to endue ID and out again (ADR 0089).
            core.grant(
                RUNTIME_CALLER,
                Permission::AccountManage(AccountManagePermission {
                    permission: Default::default(),
                }),
            );
            // The person's themes (ADR 0058): the theme studio saves, imports, exports and removes
            // them as the runtime, and `desk theme` does the same as the CLI (whose other grants
            // are desk_ipc::grants()).
            for caller in [RUNTIME_CALLER, desk_ipc::CALLER] {
                core.grant(
                    caller,
                    Permission::ThemeManage(ThemeManagePermission {
                        permission: Default::default(),
                    }),
                );
            }
            // "Show in file manager" on a state file kept broken: the data folder and the views only.
            let views = home_dir().join(".desk").join("views");
            let paths = [&data, &views]
                .map(|dir| format!("{}/**", dir.display().to_string().replace('\\', "/")));
            core.grant(
                RUNTIME_CALLER,
                Permission::ShellOpen(ShellOpenPermission {
                    permission: Default::default(),
                    schemes: None,
                    paths: Some(paths.to_vec()),
                }),
            );
            tracing.phase("core init", started);
            let started = Instant::now();
            for dir in env_paths("DESK_PLUGIN_DIRS") {
                core.install_plugins_in(&dir, true);
            }
            for dir in env_paths("DESK_DEV_PLUGINS") {
                core.install_plugin(&dir, false);
            }
            // Hot reload leaves user themes to the themes watch, so each change is announced once.
            let watcher = core.watch_plugins().ok();
            let themes = core
                .watch_themes()
                .map_err(|why| eprintln!("endue Desk: the themes folder is not watched ({why})"))
                .ok();
            tracing.phase("plugin registry", started);
            let started = Instant::now();
            core.start_connectors();
            core.start_connector_scheduler(CONNECTOR_TICK);
            core.keep_broken_views();
            app.manage(commands::start::Start::new(&core, &data, last));
            let views = core.watch_views().ok();
            for problem in core.view_problems() {
                eprintln!("endue Desk: a view is left out ({problem})");
            }
            // Setting values that fail their declarations (ADR 0080): the core logs each one and sends
            // it to the runtime, which tells the person; the terminal and the e2e log name them too.
            for problem in core.settings_problems() {
                eprintln!("endue Desk: {problem}");
            }
            app.manage(Watching(Mutex::new((watcher, views, themes))));
            tracing.phase("connectors and views", started);
            let started = Instant::now();

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
            // MCP servers from init.yaml attach once the runtime is ready (ADR 0098).
            app.manage(mcp::McpServers::new(&core, home_dir()));
            palette::setup(app, &core)?;
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
