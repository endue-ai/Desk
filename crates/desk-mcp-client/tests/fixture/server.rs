//! A small MCP server over stdio for desk-mcp-client's tests, written apart from the client so the
//! tests check the protocol, not the client against itself. It lists its tools two to a page and
//! serves them:
//!
//! - `echo` `{ text }` (read-only): answers the text.
//! - `add_note` `{ title }`: answers "saved <title>" with structured content; no annotations, so
//!   the desk makes it irreversible.
//! - `fail` (read-only): an error result, "it failed on purpose".
//! - `env` `{ name }` (read-only): the variable's value in this process, or "(unset)".
//! - `grow`: adds the tool `extra` and sends `notifications/tools/list_changed`.
//!
//! `--protocol <version>` answers that version to `initialize`. It writes one line that is not JSON
//! to stdout first (servers should not; clients should cope) and one line to stderr, and exits when
//! its stdin ends.

use std::io::{BufRead, Write};

use serde_json::{Value, json};

const KNOWN: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let forced = args
        .iter()
        .position(|a| a == "--protocol")
        .and_then(|i| args.get(i + 1).cloned());
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let _ = writeln!(out, "desk-mcp-fixture: noise that is not JSON");
    let _ = out.flush();
    eprintln!("desk-mcp-fixture: started");
    let mut grown = false;
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let (Some(id), Some(method)) = (message.get("id"), message["method"].as_str()) else {
            continue;
        };
        let params = message.get("params").cloned().unwrap_or(json!({}));
        let answer = match method {
            "initialize" => Ok(initialize(&params, forced.as_deref())),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(list(&params, grown)),
            "tools/call" => call(&params, &mut grown),
            other => Err((-32601, format!("no method {other}"))),
        };
        let reply = match answer {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => {
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
            }
        };
        let _ = writeln!(out, "{reply}");
        if method == "tools/call" && params["name"] == "grow" {
            let note = json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" });
            let _ = writeln!(out, "{note}");
        }
        let _ = out.flush();
    }
}

fn initialize(params: &Value, forced: Option<&str>) -> Value {
    let asked = params["protocolVersion"].as_str().unwrap_or("");
    let version = forced.unwrap_or(if KNOWN.contains(&asked) {
        asked
    } else {
        KNOWN[1]
    });
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": true } },
        "serverInfo": { "name": "desk-mcp-fixture", "version": "0.1.0" }
    })
}

fn tools(grown: bool) -> Vec<Value> {
    let text = |name: &str| {
        json!({ "type": "object",
        "properties": { name: { "type": "string" } }, "required": [name] })
    };
    let mut tools = vec![
        json!({ "name": "echo", "description": "Answers the text it is given.",
            "inputSchema": text("text"), "annotations": { "readOnlyHint": true } }),
        json!({ "name": "add_note", "title": "Add a note", "description": "Saves a note.",
            "inputSchema": text("title"),
            "outputSchema": { "type": "object", "properties": { "saved": { "type": "string" } } } }),
        json!({ "name": "fail", "description": "Always fails.",
            "inputSchema": { "type": "object" }, "annotations": { "readOnlyHint": true } }),
        json!({ "name": "env", "description": "Answers an environment variable.",
            "inputSchema": text("name"), "annotations": { "readOnlyHint": true } }),
        json!({ "name": "grow", "description": "Adds a tool.", "inputSchema": { "type": "object" } }),
    ];
    if grown {
        tools.push(json!({ "name": "extra", "description": "Added by grow.",
            "inputSchema": { "type": "object" }, "annotations": { "readOnlyHint": true } }));
    }
    tools
}

fn list(params: &Value, grown: bool) -> Value {
    let all = tools(grown);
    let start: usize = params["cursor"]
        .as_str()
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let end = (start + 2).min(all.len());
    let mut page = json!({ "tools": all[start.min(end)..end] });
    if end < all.len() {
        page["nextCursor"] = json!(end.to_string());
    }
    page
}

fn call(params: &Value, grown: &mut bool) -> Result<Value, (i64, String)> {
    let args = &params["arguments"];
    let text = |t: String| json!({ "content": [{ "type": "text", "text": t }] });
    match params["name"].as_str().unwrap_or("") {
        "echo" => Ok(text(args["text"].as_str().unwrap_or("").to_owned())),
        "add_note" => {
            let title = args["title"].as_str().unwrap_or("").to_owned();
            let mut answer = text(format!("saved {title}"));
            answer["structuredContent"] = json!({ "saved": title });
            Ok(answer)
        }
        "fail" => {
            let mut answer = text("it failed on purpose".to_owned());
            answer["isError"] = json!(true);
            Ok(answer)
        }
        "env" => {
            let name = args["name"].as_str().unwrap_or("");
            Ok(text(
                std::env::var(name).unwrap_or_else(|_| "(unset)".to_owned()),
            ))
        }
        "grow" => {
            *grown = true;
            Ok(text("grew".to_owned()))
        }
        "extra" if *grown => Ok(text("extra".to_owned())),
        other => Err((-32602, format!("no tool {other}"))),
    }
}
