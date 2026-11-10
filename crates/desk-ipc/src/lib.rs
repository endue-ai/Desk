//! The desk socket (ADR 0030): the desk CLI and scripts reach a running desk over a local socket that
//! only the same OS user can open. Each line is one `specs/bridge/v0` document: a `BridgeRequest` in,
//! its `BridgeResponse` and every core `BridgeEvent` out, on the same connection. Every request goes
//! through `Core::handle` as the caller [`CALLER`], so the permission engine applies, or as the agent
//! a connection asked to call as with [`AGENT_METHOD`] (ADR 0086): an MCP server for another app
//! does, so that app's calls are an agent's.
//!
//! Unix sockets only for now: on Windows `Listener::bind` and `Client::connect` answer
//! `io::ErrorKind::Unsupported` with [`UNSUPPORTED`].
pub const NAME: &str = env!("CARGO_PKG_NAME");

use std::path::PathBuf;

use desk_bridge::{
    CmdInvokePermission, FsReadPermission, FsWritePermission, LogReadPermission,
    PermManagePermission, Permission, PluginManagePermission, ThemeManagePermission,
    UpdateManagePermission,
};

#[cfg(unix)]
mod client;
#[cfg(unix)]
mod listener;
#[cfg(unix)]
mod serve;
#[cfg(not(unix))]
mod unsupported;
#[cfg(unix)]
mod wire;

#[cfg(unix)]
pub use client::Client;
/// The socket's own request that makes a connection call as an agent (ADR 0086).
pub const AGENT_METHOD: &str = "socket.agent";
#[cfg(unix)]
pub use listener::Listener;
#[cfg(not(unix))]
pub use unsupported::{Client, Listener};

/// The caller id of every connection: the person's own scripts and AI agents, through the CLI.
pub const CALLER: &str = "cli";

/// The app's identifier: the shell names the data folder after it (`apps/desk/shell/src/paths.rs`).
pub const APP_ID: &str = "ai.endue.desk";

/// The socket's file name in the data folder.
pub const SOCKET_FILE: &str = "desk.sock";

/// Names another socket path, for the desk and the CLI alike.
pub const SOCKET_ENV: &str = "DESK_SOCKET";

/// Why there is no socket on this platform yet.
pub const UNSUPPORTED: &str = "the desk socket is not available on Windows yet";

/// Where the desk socket lives: `DESK_SOCKET`, or `desk.sock` in the desk's data folder (macOS
/// `~/Library/Application Support/ai.endue.desk`, Linux `$XDG_DATA_HOME/ai.endue.desk` or
/// `~/.local/share/ai.endue.desk`). `None` when there is no data folder (no home).
pub fn socket_path() -> Option<PathBuf> {
    match std::env::var_os(SOCKET_ENV) {
        Some(path) if !path.is_empty() => Some(PathBuf::from(path)),
        _ => data_dir().map(|data| data.join(SOCKET_FILE)),
    }
}

/// The desk's data folder, where the app keeps its state files (macOS
/// `~/Library/Application Support/ai.endue.desk`, Linux `$XDG_DATA_HOME/ai.endue.desk` or
/// `~/.local/share/ai.endue.desk`). `None` when there is no home.
pub fn data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|data| data.join(APP_ID))
}

/// What the app grants [`CALLER`] at start, session-long: run any command, list and toggle plugins,
/// see and revoke every grant, read the log (ADR 0030), drive the desk's updates (ADR 0054), manage
/// the person's themes for `desk theme` (ADR 0058), and read and write files, for `desk fs history`
/// and `desk fs restore` (ADR 0076). Only the same OS user can open the socket, and that user can
/// already do all of this through the desk itself, or read and write those files directly.
pub fn grants() -> Vec<Permission> {
    vec![
        Permission::CmdInvoke(CmdInvokePermission {
            permission: Default::default(),
            ids: vec!["*".to_owned()],
        }),
        Permission::PluginManage(PluginManagePermission {
            permission: Default::default(),
        }),
        Permission::PermManage(PermManagePermission {
            permission: Default::default(),
        }),
        Permission::LogRead(LogReadPermission {
            permission: Default::default(),
        }),
        Permission::UpdateManage(UpdateManagePermission {
            permission: Default::default(),
        }),
        Permission::ThemeManage(ThemeManagePermission {
            permission: Default::default(),
        }),
        Permission::FsRead(FsReadPermission {
            permission: Default::default(),
            paths: everywhere(),
        }),
        Permission::FsWrite(FsWritePermission {
            permission: Default::default(),
            paths: everywhere(),
        }),
    ]
}

/// Every path the person's own files can have: absolute ones and those under `~`.
fn everywhere() -> Vec<String> {
    vec!["/**".to_owned(), "~/**".to_owned()]
}
