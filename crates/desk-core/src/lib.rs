//! Kernel of endue Desk: permission engine, event bus, plugin registry, session store, settings and
//! the log, the session lease client, init.yaml with its sync, the bridge handler with the file URLs
//! it hands frames (ADR 0041), links handed to the system (ADR 0047), and the integration layer (the
//! item index, connectors and views; ADR 0036), the desk's own updates (ADR 0054), the person's
//! own themes (ADR 0058), the theme markets (ADR 0060), the agent programs on this computer
//! (ADR 0110), the person's endue AI agents through endue AI's platform API (ADR 0122) and computer
//! use through desk-computer (ADR 0123).
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub mod account;
mod account_client;
mod account_settings;
mod agent_registry;
mod agent_runs;
mod agent_tools;
mod agents;
mod approval_action;
mod approval_preview;
mod approvals;
mod brain_choice;
mod brain_options;
mod calendar_items;
mod computer;
mod conversation;
mod conversation_sink;
mod conversation_tools;
mod core_account;
mod core_account_settings;
mod core_agents;
mod desk_context;
pub mod lock;

mod core_ask;
mod core_brain;
mod core_builtins;
mod core_catalog;
mod core_cmd;
mod core_computer;
mod core_connectors;
mod core_data;
mod core_directory;
mod core_events;
mod core_fs;
mod core_fs_url;
mod core_history;
mod core_host;
mod core_http;
mod core_http_sync;
mod core_init;
mod core_lock;
mod core_log;
mod core_market;
mod core_marketplace;
mod core_memory;
mod core_net;
mod core_packs;
mod core_perm;
mod core_plugin_views;
mod core_plugins;
mod core_proc;
mod core_prompts;
mod core_recent;
mod core_search;
mod core_settings;
mod core_shell;
mod core_snapshots;
mod core_sockets;
mod core_state;
mod core_store;
mod core_studio;
mod core_themes;
mod core_tools;
mod core_ui;
mod core_undo;
mod core_update;
mod core_views;
mod core_views_check;
mod core_wasm;
mod desk_files;
mod dispatch;
mod eris_context;
mod eris_lines;
mod events;
mod grants;
mod handler;
mod history;
mod history_index;
mod http_binding;
mod init;
mod last_start;
mod lease;
mod local_agents;
mod log;
mod manifest;
mod marketplace;
mod media_types;
pub mod native;
mod paths;
mod perm;
mod perm_log;
mod plugins;
mod prompt_policy;
mod secrets;
mod sessions;
mod settings_check;
mod settings_report;
mod state_file;
mod store;
mod studio;
mod sync;
mod sync_mock;
mod theme;
mod time;
mod views_watch;
mod watch;

pub use agents::agent_caller;
pub use brain_choice::{Brains, DEFAULT_LOCAL_MODEL, LocalBrains};
pub use brain_options::{BrainMode, BrainOptions};
pub use core_fs_url::FileUrl;
pub use core_perm::{Prompter, RefuseAll};
pub use core_snapshots::{ShotError, SurfaceShot, SurfaceSnapshots};
pub use core_state::{QUARANTINED_KEY, SafeMode, SafeReason};
pub use core_themes::{ThemeFetch, ThemeWatcher};
pub use core_tools::mcp_caller;
pub use desk_files::{
    DATA_FILES, DESK_FILES, DESK_FOLDERS, DeskFile, FileState, Owner, check_desk_file, desk_files,
    desk_folder_files,
};
pub use eris_lines::{
    FAILED_LINE, FALLBACK_LINE, MAX_STEPS, OFFLINE_LINE, READ_ONLY_LINE, SIGN_IN_LINE,
    TOO_MANY_LINE,
};
pub use events::{Delivery, EventBus};
pub use handler::{Core, Roots};
pub use init::{INIT_TEMPLATE, INIT_VERSION, Init, PluginSetup, SyncSetup};
pub use last_start::{Begun, CRASH_LOOP, LastStart, READY_WITHIN, Unclean};
pub use lease::{LeaseClient, LeaseError};
pub use local_agents::{LocalAgents, LocalAgentsOptions};
pub use lock::folder_sha256;
pub use manifest::validate_dir;
pub use marketplace::ENDUE_MARKET;
pub use media_types::media_type;
pub use perm::{Denied, PermissionEngine, Target};
pub use plugins::PluginRegistry;
pub use sessions::{Said, SessionStore, Speaker};
pub use settings_report::{Layer, ProblemKind, SettingProblem};
pub use state_file::{BrokenFile, broken_in, keep_broken};
pub use studio::studio_tokens;
pub use sync::{Keep, RemoteFailure, Snapshot, SyncError, SyncOutcome, SyncRemote};
pub use sync_mock::MockRemote;
pub use theme::TokenTable;
pub use time::rfc3339_now;
pub use views_watch::ViewWatcher;
pub use watch::PluginWatcher;
