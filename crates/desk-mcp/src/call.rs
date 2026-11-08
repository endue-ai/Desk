//! `tools/call`: what each tool does, and its answer as MCP's `CallToolResult`. The result is JSON
//! text; a call the desk refused or that failed is `isError` with the desk's error and a hint, so the
//! client's model can read why. An unknown tool or malformed arguments are a JSON-RPC error.

use serde_json::{Map, Value, json};

use crate::catalog::Catalog;
use crate::desk::{Desk, Failure, NO_DESK};
use crate::rpc::INVALID_PARAMS;
use crate::tools::{CALL_BRIDGE, LIST_COMMANDS, LIST_PLUGINS, RUN_COMMAND, Selection, command_of};

/// A JSON-RPC error: code and message.
pub(crate) type RpcError = (i64, String);

/// Run tool `name` with `arguments`.
pub(crate) fn call(
    desk: &Desk,
    selection: &Selection,
    name: &str,
    arguments: &Value,
) -> Result<Value, RpcError> {
    let arguments = match arguments {
        Value::Null => Map::new(),
        Value::Object(arguments) => arguments.clone(),
        _ => return Err(invalid("arguments must be an object")),
    };
    let outcome = match name {
        LIST_PLUGINS => {
            let plugin = text(&arguments, "plugin")?;
            Catalog::read(desk).and_then(|catalog| {
                catalog
                    .plugins_json(plugin.as_deref(), selection)
                    .ok_or_else(|| {
                        let id = plugin.unwrap_or_default();
                        Failure::new("not_found", format!("no plugin {id} is installed"))
                    })
            })
        }
        LIST_COMMANDS => {
            let plugin = text(&arguments, "plugin")?;
            let query = text(&arguments, "query")?;
            Catalog::read(desk).map(|catalog| {
                catalog.commands_json(plugin.as_deref(), query.as_deref(), selection)
            })
        }
        RUN_COMMAND => {
            let Some(command) = text(&arguments, "command")? else {
                return Err(invalid("run-command needs command, a command id"));
            };
            let args = object(&arguments, "args")?;
            run(desk, &command, args)
        }
        CALL_BRIDGE => {
            let Some(method) = text(&arguments, "method")? else {
                return Err(invalid("call-bridge needs method, a bridge method's name"));
            };
            let params = object(&arguments, "params")?.unwrap_or_default();
            desk.as_agent()
                .and_then(|mut conn| conn.call(&method, Value::Object(params)))
                .map(|result| json!({ "method": method, "result": result }))
        }
        tool => {
            let command = command_tool(desk, selection, tool)?;
            run(desk, &command, Some(arguments))
        }
    };
    Ok(match outcome {
        Ok(answer) => tool_result(&answer, false),
        Err(failure) => tool_result(&failed(desk, &failure), true),
    })
}

/// The command a tool of its own stands for: a picked plugin's command the desk has now.
fn command_tool(desk: &Desk, selection: &Selection, tool: &str) -> Result<String, RpcError> {
    let unknown = || invalid(&format!("unknown tool {tool}"));
    let command = command_of(tool).ok_or_else(unknown)?;
    if !selection.any() {
        return Err(unknown());
    }
    // Without a desk the call says so, as every tool's does, rather than that the tool is unknown.
    let Ok(catalog) = Catalog::read(desk) else {
        return Ok(command);
    };
    let picked = catalog.commands().iter().any(|c| {
        c["id"] == command.as_str() && c["provider"].as_str().is_some_and(|p| selection.picks(p))
    });
    picked.then_some(command).ok_or_else(unknown)
}

fn run(desk: &Desk, command: &str, args: Option<Map<String, Value>>) -> Result<Value, Failure> {
    let mut conn = desk.as_agent()?;
    let result = conn.invoke(command, args)?;
    Ok(json!({ "command": command, "result": result }))
}

/// A failure as the tool's output: the desk's error, the caller, and what to do about it.
fn failed(desk: &Desk, failure: &Failure) -> Value {
    let caller = desk.caller();
    let hint = match failure.code.as_str() {
        NO_DESK => Some("Start endue Desk on this computer, then try again.".to_owned()),
        "permission_denied" => Some(format!(
            "The person did not allow {caller} this, or the agent's allowlist in init.yaml \
             leaves it out. Ask the person to allow it in Desk instead of retrying."
        )),
        "invalid_params" => Some(
            "Check the names with list-commands and the args against the command's argsSchema."
                .to_owned(),
        ),
        _ => None,
    };
    let mut out = json!({ "error": failure.json(), "caller": caller });
    if let Some(hint) = hint {
        out["hint"] = json!(hint);
    }
    out
}

fn tool_result(answer: &Value, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": answer.to_string() }],
        "isError": is_error
    })
}

fn text(arguments: &Map<String, Value>, key: &str) -> Result<Option<String>, RpcError> {
    match arguments.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if !text.is_empty() => Ok(Some(text.clone())),
        Some(_) => Err(invalid(&format!(
            "{key} must be a string that is not empty"
        ))),
    }
}

fn object(
    arguments: &Map<String, Value>,
    key: &str,
) -> Result<Option<Map<String, Value>>, RpcError> {
    match arguments.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(object)) => Ok(Some(object.clone())),
        Some(_) => Err(invalid(&format!("{key} must be an object"))),
    }
}

fn invalid(message: &str) -> RpcError {
    (INVALID_PARAMS, message.to_owned())
}
