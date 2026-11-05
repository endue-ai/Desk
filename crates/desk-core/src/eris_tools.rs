//! Eris's tools (ADR 0084): the registered commands whose provider's manifest marks them `tool`.
//! Every brain.say turn offers them to the brain under a name the brain contract allows: a command
//! id with its dots as underscores (`endue.mail.latest` is `endue_mail_latest`), which maps back
//! because command ids hold no underscore. A call of one runs as cmd.invoke by `agent:eris`, or by
//! the agent the call names, so grants, the agent's allowlist, approvals of irreversible commands
//! and the perm log apply as to any agent (ADR 0072, 0078). The command's answer is the tool's output.

use desk_brain::{ToolCall, ToolDefinition};
use desk_bridge::{BrainTurnTool, BridgeRequest, CommandInfo};
use serde_json::{Map, Value, json};

use crate::agents::agent_caller;
use crate::handler::Core;

/// The agent Eris calls as.
pub(crate) const ERIS: &str = "eris";
/// The most tools one turn offers (examples/brain-echo takes 32).
const MAX_TOOLS: usize = 32;
/// The longest tool name the brain contract allows.
const MAX_NAME: usize = 64;

/// One of Eris's tools: the command behind it and how the brain sees it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ErisTool {
    pub(crate) command: String,
    pub(crate) provider: String,
    pub(crate) title: String,
    pub(crate) definition: ToolDefinition,
}

/// The tool name of a command id, when it fits the brain contract's pattern.
pub(crate) fn tool_name(command: &str) -> Option<String> {
    let name = command.replace('.', "_");
    (name.len() <= MAX_NAME).then_some(name)
}

impl Core {
    /// Every registered command, in registration order.
    fn registered_commands(&self) -> Vec<CommandInfo> {
        let commands = self.commands();
        commands
            .order
            .iter()
            .filter_map(|id| commands.by_id.get(id).cloned())
            .collect()
    }

    /// Eris's tools now, in registration order: what the plugins that are on provide.
    pub(crate) fn eris_tools(&self) -> Vec<ErisTool> {
        self.registered_commands()
            .into_iter()
            .filter_map(|info| {
                let tool = self.declared(&info.provider, &info.id)?.tool?;
                let name = tool_name(&info.id)?;
                let schema = tool
                    .args
                    .filter(|schema| schema.get("type") == Some(&json!("object")))
                    .unwrap_or_else(no_args);
                let description =
                    format!("{} ({}). {}", info.title, info.provider, tool.description);
                Some(ErisTool {
                    command: info.id,
                    provider: info.provider,
                    title: info.title,
                    definition: ToolDefinition {
                        name,
                        description,
                        schema,
                    },
                })
            })
            .take(MAX_TOOLS)
            .collect()
    }

    /// The Eris tool a call names, if it names one.
    pub(crate) fn eris_tool(&self, call: &ToolCall) -> Option<ErisTool> {
        self.eris_tools()
            .into_iter()
            .find(|tool| tool.definition.name == call.name)
    }

    /// Run `call` of `tool` as cmd.invoke by the agent the call names, else Eris.
    pub(crate) fn run_eris_tool(
        &self,
        turn: &str,
        call: &ToolCall,
        tool: &ErisTool,
    ) -> (Value, bool) {
        let agent = call.agent_id.as_deref().unwrap_or(ERIS);
        let Some(caller) = agent_caller(agent) else {
            let why = format!("{agent} is not an agent id Desk can name");
            return (json!({ "error": why }), true);
        };
        let request = json!({
            "id": 0,
            "method": "cmd.invoke",
            "params": {
                "id": tool.command,
                "args": call.arguments,
                "scope": { "permission": "cmd:invoke", "ids": [tool.command] },
            },
        });
        match serde_json::from_value::<BridgeRequest>(request) {
            Ok(request) => self.invoke_for(turn, &caller, request),
            Err(e) => (json!({ "error": e.to_string() }), true),
        }
    }
}

impl ErisTool {
    /// The tool step the desk shows for a call of this tool.
    pub(crate) fn step(&self, call_id: &str, ok: Option<bool>) -> BrainTurnTool {
        BrainTurnTool {
            call_id: call_id.to_owned(),
            command: self.command.clone(),
            provider: self.provider.clone(),
            title: Some(self.title.clone()),
            ok,
        }
    }
}

/// The schema of a command that takes no args.
fn no_args() -> Map<String, Value> {
    let schema = json!({ "type": "object", "properties": {}, "additionalProperties": false });
    schema.as_object().cloned().unwrap_or_default()
}
