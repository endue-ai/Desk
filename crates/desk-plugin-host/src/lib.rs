//! Wasmtime host for logic plugins and supervisor for MCP tool plugins (MCP runs inside desk-vm).
//!
//! Logic plugins are Wasm components of the `desk:host` world (specs/wit). [`LogicHost`] installs,
//! starts and reloads them and delivers commands and events to them, each in its own store with
//! memory and time limits; every import goes through [`Imports`] to a [`Host`], which desk-core
//! implements.

mod bindings;
mod host;
mod imports;
mod limits;
mod logic;
mod manifest;
mod state;

pub use bindings::Setting;
pub use bindings::{
    Command, CommandInfo, Decision, DirEntry, Duration, EntryKind, Error, ErrorCode,
};
pub use bindings::{
    Failure, FailureCode, Grant, LogEntry, LogLevel, NotifyLevel, Request, Response,
};
pub use host::Host;
pub use imports::Imports;
pub use limits::{Limits, TICK};
pub use logic::{LogicHost, PluginError};

pub const NAME: &str = env!("CARGO_PKG_NAME");
