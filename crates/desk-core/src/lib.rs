//! Kernel of endue Desk: permission engine, event bus, plugin registry and the bridge handler.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod core_plugins;
mod core_store;
mod events;
mod handler;
mod manifest;
mod paths;
mod perm;
mod plugins;
mod store;
mod time;
mod watch;

pub use events::EventBus;
pub use handler::{Core, Prompter, RefuseAll, Roots};
pub use manifest::validate_dir;
pub use perm::{Denied, PermissionEngine, Target};
pub use plugins::PluginRegistry;
pub use watch::PluginWatcher;
