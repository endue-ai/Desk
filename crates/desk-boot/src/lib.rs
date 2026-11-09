//! The desk's composition root apart from any shell (ADR 0143): what the Tauri shell's `setup` did,
//! so the CEF shell starts the same desk. A shell calls [`boot::boot`], forwards the core's events
//! to its runtime ([`events::payload`]) and answers the runtime's own commands with the rest.

pub mod boot;
pub mod brains;
pub mod core_files;
pub mod crash;
pub mod events;
pub mod grants;
pub mod mcp;
pub mod ready;
pub mod socket;
pub mod start;
pub mod trace;

pub use boot::{BootInput, Booted, boot};
pub use grants::RUNTIME_CALLER;
