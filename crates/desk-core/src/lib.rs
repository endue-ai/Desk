//! Kernel of endue Desk: permission engine, event bus and the bridge request handler.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod events;
mod handler;
mod paths;
mod perm;
mod time;

pub use events::EventBus;
pub use handler::{Core, Prompter, RefuseAll, Roots};
pub use perm::{Denied, PermissionEngine, Target};
