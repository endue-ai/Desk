//! Rust types and host traits generated from specs/wit/desk-host.wit (the `plugin` world).

wasmtime::component::bindgen!({
    path: "../../specs/wit",
    world: "plugin",
    additional_derives: [PartialEq],
});

pub use desk::host::cmd::{Command, CommandInfo, Failure, FailureCode};
pub use desk::host::fs::{DirEntry, EntryKind};
pub use desk::host::log::{Entry as LogEntry, Level as LogLevel};
pub use desk::host::net::{Request, Response};
pub use desk::host::perm::{Decision, Duration, Grant};
pub use desk::host::settings::Setting;
// `Error` is the world's own `use types.{error}`, already at this level.
pub use desk::host::types::ErrorCode;
pub use desk::host::ui::NotifyLevel;
