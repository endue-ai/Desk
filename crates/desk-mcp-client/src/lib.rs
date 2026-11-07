//! Desk as an MCP client (ADR 0098). The MCP servers a person lists in init.yaml (`mcp.servers`)
//! start over stdio, each as the caller `mcp:<name>` under a `proc:spawn` grant the person gives
//! it, and every tool becomes the command `mcp.<name>.<tool>` with the agent fields of ADR 0088:
//! Eris and agents run them like any command, and the person sees and revokes the grant in the
//! permissions view. In process for now; the VM of ADR 0002 comes later.
//!
//! - [`rpc`]: JSON-RPC over newline-delimited JSON, the stdio transport.
//! - [`session`]: the handshake, `tools/list` and `tools/call`.
//! - [`process`]: starting a server with only the environment it is given.
//! - [`tools`]: tools as commands, results as answers.
//! - [`Host`]: the servers of one desk, attached to its core.

pub mod process;
pub mod rpc;
pub mod session;
pub mod tools;

mod host;

pub use host::{Host, configs};
pub use process::{Server, ServerConfig};
pub use rpc::{Connection, Failure, Notification};
pub use session::{PROTOCOL, PROTOCOLS, Session, Tool, ToolResult};
