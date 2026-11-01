//! Wasmtime host for logic plugins and Wasm connectors, and later the supervisor for MCP tool
//! plugins (MCP runs inside desk-vm).
//!
//! Logic plugins are Wasm components of the `desk:host` world (specs/wit). [`LogicHost`] installs,
//! starts and reloads them and delivers commands and events to them, each in its own store with
//! memory and time limits; every import goes through [`Imports`] to a [`Host`], which desk-core
//! implements. Wasm connectors are components of the `desk:connector` world: [`ConnectorHost`]
//! keeps their instances, syncs them on a [`Clock`] and hands what they bring to an [`IndexSink`].

mod bindings;
mod clock;
mod connector;
mod connector_bindings;
mod host;
mod imports;
mod limits;
mod logic;
mod manifest;
mod sink;
mod state;

pub use bindings::Setting;
pub use bindings::{
    Command, CommandInfo, Decision, DirEntry, Duration, EntryKind, Error, ErrorCode,
};
pub use bindings::{
    Failure, FailureCode, Grant, LogEntry, LogLevel, NotifyLevel, Request, Response,
};
pub use clock::{Clock, SystemClock, rfc3339};
pub use connector::ConnectorHost;
pub use host::Host;
pub use imports::Imports;
pub use limits::{Limits, TICK};
pub use logic::{LogicHost, PluginError};
pub use sink::IndexSink;

pub const NAME: &str = env!("CARGO_PKG_NAME");
