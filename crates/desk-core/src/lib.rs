//! Kernel of endue Desk: permission engine, event bus, plugin registry, session store, the session
//! lease client, init.yaml with its sync, and the bridge handler.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod conversation;
mod core_brain;
mod core_init;
mod core_plugins;
mod core_store;
mod events;
mod handler;
mod init;
mod lease;
mod manifest;
mod paths;
mod perm;
mod plugins;
mod sessions;
mod store;
mod sync;
mod sync_mock;
mod time;
mod watch;

pub use conversation::{BrainOptions, FAILED_LINE, OFFLINE_LINE, READ_ONLY_LINE};
pub use events::EventBus;
pub use handler::{Core, Prompter, RefuseAll, Roots};
pub use init::{INIT_TEMPLATE, INIT_VERSION, Init, PluginSetup, SyncSetup};
pub use lease::{LeaseClient, LeaseError};
pub use manifest::validate_dir;
pub use perm::{Denied, PermissionEngine, Target};
pub use plugins::PluginRegistry;
pub use sessions::{Said, SessionStore, Speaker};
pub use sync::{Keep, RemoteFailure, Snapshot, SyncError, SyncOutcome, SyncRemote};
pub use sync_mock::MockRemote;
pub use watch::PluginWatcher;
