//! A server's tools as desk commands (ADR 0088, 0098). The command id is `mcp.<server>.<tool>`, the
//! tool name lowercased with every other character a dash, so it fits the command id pattern; two
//! tools that come out the same get `-2`, `-3`. Every command is offered to agents, with the tool's
//! description and its input schema as the args schema when the schema compiles (else the server
//! checks the args itself). Read-only is the server's `readOnlyHint`; the core makes everything else
//! irreversible. A call answers `{ content, structuredContent? }`, and `isError` fails the command.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value, json};

use crate::session::{Tool, ToolResult};

/// The longest title and description a command takes (`CmdRegisterParams`).
const TITLE_MAX: usize = 128;
const DESCRIPTION_MAX: usize = 1000;
/// The longest command id.
const ID_MAX: usize = 128;

/// One tool as a command: its id, the tool's own name and the cmd.register params.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCommand {
    pub id: String,
    pub tool: String,
    pub register: Value,
}

/// The commands for `tools` of the server `server`, in the server's order.
pub fn commands(server: &str, tools: &[Tool]) -> Vec<ToolCommand> {
    let mut taken = BTreeSet::new();
    tools
        .iter()
        .filter_map(|tool| {
            let id = unique(&format!("mcp.{server}.{}", segment(&tool.name)), &mut taken)?;
            Some(ToolCommand {
                register: register(&id, server, tool),
                tool: tool.name.clone(),
                id,
            })
        })
        .collect()
}

/// The tool each command id runs, for routing invocations.
pub fn by_id(commands: &[ToolCommand]) -> BTreeMap<String, String> {
    let pairs = commands.iter().map(|c| (c.id.clone(), c.tool.clone()));
    pairs.collect()
}

/// cmd.answer's params for a tool's result: the result, or a failure when the tool failed.
pub fn answer(invocation: &str, result: Result<ToolResult, String>) -> Value {
    match result {
        Ok(result) if !result.is_error => {
            let mut answered = json!({ "content": result.content });
            if let Some(structured) = result.structured {
                answered["structuredContent"] = structured;
            }
            json!({ "invocationId": invocation, "result": answered })
        }
        Ok(failed) => {
            let text = failed.text();
            let message = if text.is_empty() {
                "the tool failed".to_owned()
            } else {
                text
            };
            failure(invocation, &message)
        }
        Err(why) => failure(invocation, &why),
    }
}

fn failure(invocation: &str, message: &str) -> Value {
    let message = clip(message, 4000);
    json!({ "invocationId": invocation, "error": { "code": "failed", "message": message } })
}

fn register(id: &str, server: &str, tool: &Tool) -> Value {
    let title = tool.title.clone().unwrap_or_else(|| tool.name.clone());
    let description = tool
        .description
        .clone()
        .unwrap_or_else(|| format!("{title}, a tool of the MCP server {server}."));
    let mut params = json!({
        "id": id,
        "title": clip(&format!("{server}: {title}"), TITLE_MAX),
        "description": clip(&description, DESCRIPTION_MAX),
        "keywords": ["mcp", server],
        "agent": true,
    });
    if compiles(&tool.input_schema) {
        params["argsSchema"] = Value::Object(object_schema(&tool.input_schema));
    }
    if let Some(output) = &tool.output_schema {
        params["resultSchema"] = Value::Object(output.clone());
    }
    if tool.read_only {
        params["readOnly"] = json!(true);
    }
    params
}

/// The schema with `type: object` when it says no type: args are always an object.
fn object_schema(schema: &Map<String, Value>) -> Map<String, Value> {
    let mut schema = schema.clone();
    schema.entry("type").or_insert_with(|| json!("object"));
    schema
}

/// Whether the core can check args against `schema`: it compiles, and it takes an object.
fn compiles(schema: &Map<String, Value>) -> bool {
    let object = matches!(schema.get("type"), None | Some(Value::String(_)))
        && schema.get("type").is_none_or(|kind| kind == "object");
    object && jsonschema::validator_for(&Value::Object(schema.clone())).is_ok()
}

/// A tool name as one command id segment: lowercase letters, digits and single dashes, starting
/// with a letter.
fn segment(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_owned();
    match out.chars().next() {
        Some(c) if c.is_ascii_lowercase() => out,
        Some(_) => format!("t-{out}"),
        None => "tool".to_owned(),
    }
}

/// `id`, or `id-2`, `id-3` … when taken. Ids are ASCII, so cutting at a byte is safe.
fn unique(id: &str, taken: &mut BTreeSet<String>) -> Option<String> {
    let base = id[..id.len().min(ID_MAX - 4)].trim_end_matches('-');
    let numbered = (1..1000).map(|n| match n {
        1 => base.to_owned(),
        n => format!("{base}-{n}"),
    });
    let found = numbered
        .into_iter()
        .find(|candidate| !taken.contains(candidate))?;
    taken.insert(found.clone());
    Some(found)
}

/// `text` cut to `max` characters, with an ellipsis when cut.
fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max - 1).collect();
    format!("{kept}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str) -> Tool {
        Tool {
            name: name.to_owned(),
            title: None,
            description: None,
            input_schema: json!({ "type": "object" }).as_object().cloned().unwrap(),
            output_schema: None,
            read_only: false,
        }
    }

    #[test]
    fn a_tool_name_becomes_one_id_segment() {
        assert_eq!(segment("search_issues"), "search-issues");
        assert_eq!(segment("getWeather"), "getweather");
        assert_eq!(segment("Add Note!"), "add-note");
        assert_eq!(segment("__x__"), "x");
        assert_eq!(segment("2fa"), "t-2fa");
        assert_eq!(segment("??"), "tool");
    }

    #[test]
    fn tools_that_come_out_the_same_get_numbers() {
        let ids: Vec<String> = commands("gh", &[tool("a_b"), tool("a-b"), tool("A.B")])
            .into_iter()
            .map(|c| c.id)
            .collect();
        assert_eq!(ids, ["mcp.gh.a-b", "mcp.gh.a-b-2", "mcp.gh.a-b-3"]);
    }

    #[test]
    fn a_schema_that_does_not_compile_is_left_to_the_server() {
        let mut broken = tool("x");
        broken.input_schema = json!({ "type": "object", "properties": { "a": { "type": 5 } } })
            .as_object()
            .cloned()
            .unwrap();
        let registered = &commands("s", &[broken])[0].register;
        assert_eq!(registered.get("argsSchema"), None);
        assert_eq!(registered["agent"], true);
        assert_eq!(registered["description"], "x, a tool of the MCP server s.");
    }

    #[test]
    fn an_error_result_fails_the_command() {
        let failed = ToolResult {
            content: vec![json!({ "type": "text", "text": "no such repo" })],
            structured: None,
            is_error: true,
        };
        let answered = answer("i-1", Ok(failed));
        assert_eq!(answered["error"]["message"], "no such repo");
        assert_eq!(answered["error"]["code"], "failed");
    }
}
