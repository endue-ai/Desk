//! The MCP client session: the handshake, the tool list and tool calls. The client offers the newest
//! protocol version it speaks and takes any version it knows that the server answers with; it
//! declares no capabilities of its own, so a server never asks it to sample, list roots or elicit.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Map, Value, json};

use crate::rpc::{Connection, Failure};

/// The version the client asks for.
pub const PROTOCOL: &str = "2025-11-25";

/// Every version the client speaks, newest first.
pub const PROTOCOLS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// The most pages of `tools/list` the client follows, so a server cannot keep it listing forever.
const PAGES: usize = 50;

/// A tool as the server lists it.
#[derive(Debug, Clone, PartialEq)]
pub struct Tool {
    pub name: String,
    /// `annotations.title`, else `title`.
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Map<String, Value>,
    pub output_schema: Option<Map<String, Value>>,
    /// `annotations.readOnlyHint`: the tool changes nothing. The server's word.
    pub read_only: bool,
}

/// What a tool call answered.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolResult {
    pub content: Vec<Value>,
    pub structured: Option<Value>,
    /// The tool itself failed (`isError`); `content` says why.
    pub is_error: bool,
}

impl ToolResult {
    /// The text blocks of the content, one per line.
    pub fn text(&self) -> String {
        let texts = self.content.iter().filter_map(|block| {
            (block.get("type") == Some(&json!("text")))
                .then(|| block.get("text").and_then(Value::as_str))
                .flatten()
        });
        texts.collect::<Vec<_>>().join("\n")
    }
}

/// An initialized session with one server.
pub struct Session {
    connection: Arc<Connection>,
    protocol: String,
    server: String,
}

impl Session {
    /// Shake hands over `connection`: `initialize`, then `notifications/initialized`.
    pub fn open(connection: Arc<Connection>, wait: Duration) -> Result<Self, Failure> {
        let params = json!({
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": { "name": "endue-desk", "title": "endue Desk",
                "version": env!("CARGO_PKG_VERSION") }
        });
        let answer = connection.request("initialize", params, wait)?;
        let protocol = answer
            .get("protocolVersion")
            .and_then(Value::as_str)
            .filter(|version| PROTOCOLS.contains(version))
            .ok_or_else(|| {
                let asked = answer
                    .get("protocolVersion")
                    .cloned()
                    .unwrap_or(Value::Null);
                Failure::Protocol(format!("protocol version {asked} is not one Desk speaks"))
            })?
            .to_owned();
        let server = answer
            .pointer("/serverInfo/name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        connection
            .notify("notifications/initialized", Value::Null)
            .map_err(|why| Failure::Io(why.to_string()))?;
        Ok(Self {
            connection,
            protocol,
            server,
        })
    }

    /// The protocol version both sides speak.
    pub fn protocol(&self) -> &str {
        &self.protocol
    }

    /// The name the server gives itself (`serverInfo.name`).
    pub fn server(&self) -> &str {
        &self.server
    }

    /// Every tool, following `nextCursor` page by page.
    pub fn tools(&self, wait: Duration) -> Result<Vec<Tool>, Failure> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..PAGES {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            let page = self.connection.request("tools/list", params, wait)?;
            let listed = page.get("tools").and_then(Value::as_array);
            let listed =
                listed.ok_or_else(|| Failure::Protocol("tools/list without tools".into()))?;
            tools.extend(listed.iter().filter_map(tool));
            cursor = page
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if cursor.is_none() {
                return Ok(tools);
            }
        }
        Err(Failure::Protocol(format!(
            "tools/list went past {PAGES} pages"
        )))
    }

    /// Call the tool `name` with `arguments`.
    pub fn call(
        &self,
        name: &str,
        arguments: Map<String, Value>,
        wait: Duration,
    ) -> Result<ToolResult, Failure> {
        let params = json!({ "name": name, "arguments": arguments });
        let answer = self.connection.request("tools/call", params, wait)?;
        let content = match answer.get("content") {
            Some(Value::Array(content)) => content.clone(),
            None => Vec::new(),
            Some(_) => return Err(Failure::Protocol("content is not a list".to_owned())),
        };
        Ok(ToolResult {
            content,
            structured: answer.get("structuredContent").cloned(),
            is_error: answer.get("isError") == Some(&json!(true)),
        })
    }
}

/// A listed tool, when it has a name and an object schema.
fn tool(value: &Value) -> Option<Tool> {
    let text = |pointer: &str| {
        value
            .pointer(pointer)
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned)
    };
    let schema = |key: &str| value.get(key).and_then(Value::as_object).cloned();
    Some(Tool {
        name: text("/name")?,
        title: text("/annotations/title").or_else(|| text("/title")),
        description: text("/description"),
        input_schema: schema("inputSchema")?,
        output_schema: schema("outputSchema"),
        read_only: value.pointer("/annotations/readOnlyHint") == Some(&json!(true)),
    })
}
