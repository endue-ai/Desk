//! An MCP server for the running desk (ADR 0086): another app (Claude Code, Claude Desktop, an IDE)
//! starts `desk mcp` and speaks MCP on its stdin and stdout; the server reaches the desk over its
//! socket (ADR 0030). Every plugin is in reach: `list-plugins` and `list-commands` show what the desk
//! has, `run-command` runs any plugin's command, `call-bridge` calls any bridge method, and the
//! commands of the plugins `--plugin` names get tools of their own. The catalog is read as `cli`;
//! every call the client asks for runs as `agent:<id>`, so the agent's grants, allowlist, prompts,
//! approvals and log apply (ADR 0072, 0078).
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod call;
mod catalog;
mod desk;
mod resources;
mod rpc;
mod session;
mod tools;
mod watch;

pub use session::{Options, serve};
pub use tools::{CALL_BRIDGE, LIST_COMMANDS, LIST_PLUGINS, RUN_COMMAND};

/// The server's name in `initialize`.
pub const SERVER_NAME: &str = "endue-desk";

/// The MCP versions this server speaks, newest first.
pub const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// The agent id when `--agent` names none: the caller is `agent:mcp`.
pub const DEFAULT_AGENT: &str = "mcp";
