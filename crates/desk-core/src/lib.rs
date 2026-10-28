//! Kernel of endue Desk: permission engine, event bus, plugin registry, session store, the session
//! lease client and the bridge handler.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod conversation;
mod core_audio;
mod core_brain;
mod core_fs;
mod core_net;
mod core_perm;
mod core_plugins;
mod core_proc;
mod core_store;
mod events;
mod fs_watch;
mod handler;
mod launch;
mod lease;
mod manifest;
mod paths;
mod perm;
mod plugins;
mod prompt;
mod resources;
mod route;
mod sessions;
mod store;
mod time;
mod watch;

pub use conversation::{BrainOptions, FAILED_LINE, OFFLINE_LINE, READ_ONLY_LINE};
pub use core_audio::DetectorFactory;
pub use events::EventBus;
pub use handler::{Core, Roots};
pub use launch::{LaunchGuard, SafeReason, UNREADY_LIMIT};
pub use lease::{LeaseClient, LeaseError};
pub use manifest::validate_dir;
pub use perm::{Denied, PermissionEngine, Target};
pub use plugins::PluginRegistry;
pub use prompt::{Prompt, Prompter, RUNTIME_CALLER, RefuseAll, describe};
pub use route::{Delivery, FrameRouter, request_head};
pub use sessions::{Said, SessionStore, Speaker};
pub use watch::PluginWatcher;
