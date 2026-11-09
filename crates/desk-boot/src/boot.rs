//! The desk's start, apart from any shell: the core with its files, the start record, the brains,
//! the runtime's grants, the plugins, watchers, connectors and views, the desk socket and the MCP
//! servers. A shell calls [`boot`] once, then forwards [`Booted::events`] to its runtime and answers
//! the runtime's own commands with the rest of [`Booted`].

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desk_core::account::{Account, AccountOptions, NetIdClient};
use desk_core::{
    Core, Delivery, LocalAgents, LocalAgentsOptions, MockRemote, PluginWatcher, Roots, SyncError,
    SyncOutcome, ThemeWatcher, ViewWatcher,
};
use desk_trace::Origin;

use crate::crash::{self, Crash};
use crate::mcp::McpServers;
use crate::socket::{self, Serving};
use crate::start::{self, Start};
use crate::trace::Tracing;
use crate::{brains, core_files, grants};

/// Where init.yaml lives under home unless `DESK_INIT` names another file, like `~/.emacs.d/init.el`.
pub const INIT_FILE: &str = ".desk/init.yaml";

/// How often the connector scheduler looks for due syncs.
const CONNECTOR_TICK: Duration = Duration::from_secs(1);

/// What a shell attaches to the core once tools are routed (computer use drives its windows).
pub type Attach = Box<dyn FnOnce(&Arc<Core>)>;

/// What a shell hands the boot.
pub struct BootInput {
    /// The app's data folder (`ai.endue.desk` under the OS's per-user data folder).
    pub data: PathBuf,
    /// The person's home folder.
    pub home: PathBuf,
    /// This build's version, for crash reports.
    pub version: String,
    /// Process start, for the start-up trace (`DESK_TRACE=1`).
    pub origin: Origin,
    /// The updater this build installs with, when it updates itself (ADR 0054).
    pub updater: Option<desk_update::Updater>,
    /// What the shell attaches once tools are routed and before the account starts (computer use).
    pub attach: Option<Attach>,
    /// Folders whose plugins install as built in (`DESK_PLUGIN_DIRS`).
    pub plugin_dirs: Vec<PathBuf>,
    /// Plugin folders to install for development (`DESK_DEV_PLUGINS`).
    pub dev_plugins: Vec<PathBuf>,
}

/// The started desk, for the shell to keep and answer from.
pub struct Booted {
    pub core: Arc<Core>,
    pub start: Start,
    pub crash: Crash,
    pub tracing: Tracing,
    pub mcp: McpServers,
    /// Core events with the callers they are for: the shell forwards each to its runtime.
    pub events: std::sync::mpsc::Receiver<Delivery>,
    /// The watchers and the socket, alive while this is.
    pub keep: Keep,
}

/// What must live as long as the desk runs.
pub struct Keep {
    _watchers: Mutex<(
        Option<PluginWatcher>,
        Option<ViewWatcher>,
        Option<ThemeWatcher>,
    )>,
    _socket: Serving,
}

/// Start the desk.
pub fn boot(input: BootInput) -> Booted {
    let BootInput {
        data,
        home,
        version,
        origin,
        updater,
        attach,
        plugin_dirs,
        dev_plugins,
    } = input;
    // A panic from here on leaves a redacted report in <data>/crashes (#322).
    let crash = crash::install(&version, &data, Some(&home));
    let tracing = Tracing::from_env(origin, &data);
    tracing.phase("shell start", origin.instant());
    let started = Instant::now();
    let init = std::env::var_os("DESK_INIT")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(INIT_FILE));
    // endue does not serve sync yet: until it does, a stand-in keeps endue's copy of init.yaml in the
    // data folder.
    let remote = MockRemote::with_file(data.join("sync-mock.json"));
    // plugins.lock: the plugin set, rewritten on every install and turn on or off (ADR 0079).
    let lock = home.join(".desk").join("plugins.lock");
    let core = Core::new(Roots { home: home.clone() })
        .with_init_file(init)
        .with_lock_file(lock)
        .with_sync(Arc::new(remote), Some(data.join("sync.json")));
    // Everything that outlives a quit: grants, settings, the log and the rest (#351).
    let core = core_files::open(core, &data);
    // Safe mode, asked for or after two starts that never got ready, holds plugins off as they
    // install (ADR 0061).
    let (mut core, last) = start::begin(&data, core);
    if let Some(problem) = core.init_problem() {
        eprintln!("endue Desk: init.yaml is not in force ({problem}); using the defaults");
    }
    // The item index (ADR 0033): without it data.* answers io_error and syncs fail. An index that
    // cannot be opened is kept as index.sqlite.broken and opened fresh.
    core = core.with_index_file(data.join("index.sqlite"));
    if let Some(why) = core.index_problem() {
        eprintln!("endue Desk: no item index ({why}); data.* is unavailable");
    }
    // The OS calendar makes the built-in connectors desk.calendar and desk.reminders. It is macOS
    // only for now; elsewhere there is none, and nothing asks the OS until connect.
    if let Ok(calendar) = desk_sys::calendar::os() {
        core = core.with_calendar(Arc::from(calendar));
    }
    // Before plugins install, so a setup pulled from another desk applies from this start.
    sync_init(&core);
    // The person's own themes (ADR 0058) and what the market installed (ADR 0107).
    core = core.with_themes_dir(data.join("themes"));
    core = core.with_market_dir(data.join("plugins"));
    // The person's endue ID (ADR 0089, 0111) at auth.endue.ai, through platform.endue.ai unless
    // DESK_ENDUE_PLATFORM_URL / DESK_ENDUE_AUTH_URL say otherwise.
    let mut account = AccountOptions::from_env();
    account.file = Some(data.join("account.json"));
    let account = Account::open(account, NetIdClient);
    core = core.with_account(account.clone());
    // The agent programs on this computer (ADR 0110): Claude Code and Codex, their sessions read
    // from their own folders, imported ones kept in <data>/agents.
    let agents = LocalAgentsOptions::new(&home, Some(data.join("agents")));
    core = core.with_local_agents(LocalAgents::new(agents));
    // Eris's brain is the one the runtime's setting chooses, endue AI by default, and the local brain
    // stands in while a remote one cannot be reached (ADR 0094).
    core = core.with_brains(brains::brains(&data, &home, account));
    if let Some(updater) = updater {
        core = core.with_updater(updater);
    }
    let core = Arc::new(core);
    // Tool calls run as the agent that asks (ADR 0072, 0089).
    core.route_tools();
    if let Some(attach) = attach {
        attach(&core);
    }
    core.start_account();
    grants::grant_runtime(&core, &data, &home);
    tracing.phase("core init", started);

    let started = Instant::now();
    for dir in plugin_dirs {
        core.install_plugins_in(&dir, true);
    }
    for dir in dev_plugins {
        core.install_plugin(&dir, false);
    }
    core.install_market_plugins();
    // Hot reload leaves user themes to the themes watch, so each change is announced once.
    let plugins = core.watch_plugins().ok();
    let themes = core
        .watch_themes()
        .map_err(|why| eprintln!("endue Desk: the themes folder is not watched ({why})"))
        .ok();
    tracing.phase("plugin registry", started);

    let started = Instant::now();
    core.start_connectors();
    core.start_connector_scheduler(CONNECTOR_TICK);
    core.keep_broken_views();
    let start = Start::new(&core, &data, last);
    // A report names the plugins that are on: now, and again whenever one turns on or off.
    crash::note_plugins(&core, &crash.context);
    crash::follow_plugins(&core, Arc::clone(&crash.context));
    let views = core.watch_views().ok();
    for problem in core.view_problems() {
        eprintln!("endue Desk: a view is left out ({problem})");
    }
    // Setting values that fail their declarations (ADR 0080): the core logs each one and sends it to
    // the runtime, which tells the person; the terminal and the e2e log name them too.
    for problem in core.settings_problems() {
        eprintln!("endue Desk: {problem}");
    }
    tracing.phase("connectors and views", started);
    // Subscribing also tells the core a router listens: without one it never sends a prompt and the
    // Prompter decides alone.
    let events = core.events().subscribe_addressed();
    // The desk CLI reaches the core over a same-user socket as `cli`, and hears every core event too
    // (ADR 0030).
    let socket = socket::serve(&core);
    // MCP servers from init.yaml attach once the runtime is ready (ADR 0098).
    let mcp = McpServers::new(&core, home);
    Booted {
        core,
        start,
        crash,
        tracing,
        mcp,
        events,
        keep: Keep {
            _watchers: Mutex::new((plugins, views, themes)),
            _socket: socket,
        },
    }
}

fn sync_init(core: &Core) {
    match core.sync_init() {
        Ok(SyncOutcome::Conflict { revision }) => {
            let copy = core.init_remote_copy().unwrap_or_default();
            eprintln!(
                "endue Desk: init.yaml changed here and on endue (revision {revision}); endue's copy is in {}",
                copy.display()
            );
        }
        Ok(outcome) => eprintln!("endue Desk: init.yaml sync: {outcome:?}"),
        Err(SyncError::Off) => {}
        Err(why) => eprintln!("endue Desk: init.yaml not synced ({why})"),
    }
}

/// Folders from a PATH-style environment variable (`:` on Unix, `;` on Windows).
pub fn env_paths(name: &str) -> Vec<PathBuf> {
    std::env::var_os(name)
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default()
}

/// The person's home folder.
pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}
