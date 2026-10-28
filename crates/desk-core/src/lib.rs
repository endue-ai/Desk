//! Kernel of endue Desk: permission engine, event bus, plugin registry, session store, the session
//! lease client and the bridge handler.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod conversation;
mod core_brain;
mod core_plugins;
mod core_store;
mod events;
mod handler;
mod lease;
mod manifest;
mod paths;
mod perm;
mod plugins;
mod sessions;
mod store;
mod time;
mod watch;

pub use conversation::{BrainOptions, FAILED_LINE, OFFLINE_LINE, READ_ONLY_LINE};
pub use events::EventBus;
pub use handler::{Core, Prompter, RefuseAll, Roots};
pub use lease::{LeaseClient, LeaseError};
pub use manifest::validate_dir;
pub use perm::{Denied, PermissionEngine, Target};
pub use plugins::PluginRegistry;
pub use sessions::{Said, SessionStore, Speaker};
pub use watch::PluginWatcher;
