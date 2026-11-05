//! The brain's tool calls, run by the core (CORE-14, ADR 0072). A call that names its agent
//! (`ToolCall.agentId`) runs as the caller `agent:<id>`: `echo`, any bridge method by its name with
//! the call's arguments as its params, or a command (ADR 0088): `desk-tools` answers cmd.tools,
//! `desk-run` runs `{ command, args }`, and a command's id or tool name runs it with the arguments
//! as its args, under the `cmd:invoke` scope of that one command. So the permission engine, the
//! agent's allowlist, the prompt and the `perm` log apply as to any caller. A command waits for its
//! answer. A call that names no agent runs `echo`, or a desk tool as Eris (`agent:eris`, ADR 0089),
//! never a bridge method. Failures come back as `{ error, reason? }`.
//! Each call runs as part of its desk turn, the task an approval's "Allow for this task" lasts for
//! (ADR 0078); a call the person did not approve says `reason: "not-approved"`.

use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use desk_brain::{ToolCall, ToolDefinition, TurnContext};
use desk_bridge::{
    BrainTurnTool, BridgeError, BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode, MemoryStep,
};
use serde_json::{Map, Value, json};

use crate::agents::agent_caller;
use crate::approvals::in_task;
use crate::conversation::Tools;
use crate::core_tools::{DESK_RUN, DESK_TOOLS};
use crate::eris_context::{DESK_REMEMBER, remember_request};
use crate::handler::{Core, error};

/// How long a command run from a tool call may take to answer.
const COMMAND_WAIT: Duration = Duration::from_secs(300);

impl Core {
    /// Run the brain's tool calls through this core from now on, each as the agent that asks for
    /// it. Without it the brain gets `echo` only. Call it once the core is shared.
    pub fn route_tools(self: &Arc<Self>) {
        let tools: Weak<dyn Tools> = Arc::downgrade(self) as Weak<Core>;
        if let Some(conversation) = &self.conversation {
            conversation.route(tools.clone());
        }
        self.route_choice(tools);
    }

    /// The tool's output from a bridge failure, with why the agent was refused when it was.
    fn tool_error(&self, caller: &str, failed: BridgeError, denied: bool) -> (Value, bool) {
        if denied {
            return (json!({ "error": failed, "reason": "not-approved" }), true);
        }
        let reason = failed
            .permission
            .as_ref()
            .filter(|_| failed.code == ErrorCode::PermissionDenied)
            .and_then(|scope| {
                let earlier = self.refused_earlier(caller, scope);
                let capped = self.capped(caller, scope);
                capped.or(earlier.then_some(desk_bridge::RefusalReason::RefusedEarlier))
            });
        let mut output = json!({ "error": failed });
        if let Some(reason) = reason {
            output["reason"] = json!(reason);
        }
        (output, true)
    }

    /// cmd.invoke as `caller`, then the command's answer (`cmd.answered`) as the tool's output.
    pub(crate) fn invoke_for(
        &self,
        turn: &str,
        caller: &str,
        request: BridgeRequest,
    ) -> (Value, bool) {
        let events = self.events().subscribe();
        let started = match in_task(turn, || self.handle(caller, request)) {
            (BridgeResponse::BridgeSuccess(ok), _) => ok.result,
            (BridgeResponse::BridgeFailure(failure), denied) => {
                return self.tool_error(caller, failure.error, denied);
            }
        };
        let invocation = started["invocationId"].as_str().unwrap_or_default();
        let deadline = Instant::now() + COMMAND_WAIT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match events.recv_timeout(left) {
                Ok(BridgeEvent::CmdAnswered(answered))
                    if answered.data.invocation_id == invocation =>
                {
                    let data = answered.data;
                    return match data.error {
                        Some(failure) if !data.ok => (json!({ "error": failure }), true),
                        _ => (data.result.unwrap_or(Value::Null), false),
                    };
                }
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
                    let late = format!("the command did not answer within {COMMAND_WAIT:?}");
                    return (json!({ "error": error(ErrorCode::Timeout, late) }), true);
                }
            }
        }
    }

    /// The bridge request a tool call makes: the bridge method it names, cmd.tools for desk-tools,
    /// or cmd.invoke of the command desk-run or the call's name names.
    fn tool_request(&self, call: &ToolCall) -> Result<BridgeRequest, String> {
        let arguments = Value::Object(call.arguments.clone());
        if call.name == DESK_TOOLS {
            let request = json!({ "id": 0, "method": "cmd.tools", "params": arguments });
            let bad = "desk-tools takes { query?, limit? }";
            return serde_json::from_value(request).map_err(|_| bad.to_owned());
        }
        if call.name == DESK_REMEMBER {
            return remember_request(&call.arguments);
        }
        if call.name == DESK_RUN {
            let command = call.arguments.get("command").and_then(Value::as_str);
            let args = call.arguments.get("args").cloned().unwrap_or(json!({}));
            let only = call.arguments.keys().all(|k| k == "command" || k == "args");
            return match (command, args) {
                (Some(id), Value::Object(args)) if only => match self.command_named(id) {
                    Some(id) => invoke(&id, args),
                    None => Err(format!("Desk has no command {id}")),
                },
                _ => Err("desk-run takes { command, args? }, args an object".to_owned()),
            };
        }
        let request = json!({ "id": 0, "method": call.name, "params": arguments });
        if let Ok(request) = serde_json::from_value::<BridgeRequest>(request) {
            return Ok(request);
        }
        match self.command_named(&call.name) {
            Some(id) => invoke(&id, call.arguments.clone()),
            None => Err(format!(
                "Desk has no tool named {} that takes these arguments",
                call.name
            )),
        }
    }
}

/// cmd.invoke of `id` with `args`, under the `cmd:invoke` scope of that one command.
fn invoke(id: &str, args: Map<String, Value>) -> Result<BridgeRequest, String> {
    let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
    let request = json!({ "id": 0, "method": "cmd.invoke",
        "params": { "id": id, "args": args, "scope": scope } });
    serde_json::from_value(request).map_err(|e| format!("Desk cannot run {id}: {e}"))
}

impl Tools for Core {
    fn step(&self, call: &ToolCall) -> Option<BrainTurnTool> {
        let named = if call.name == DESK_RUN {
            call.arguments.get("command")?.as_str()?
        } else {
            call.name.as_str()
        };
        // A bridge method of the same name wins (ADR 0088): it is no hand-off to a plugin.
        if call.name != DESK_RUN && self.tool_request(call).is_ok_and(|r| !is_invoke(&r)) {
            return None;
        }
        let info = self.command(&self.command_named(named)?)?;
        Some(BrainTurnTool {
            call_id: call.call_id.clone(),
            command: info.id,
            provider: info.provider,
            title: Some(info.title),
            ok: None,
        })
    }

    fn run(&self, turn: &str, call: &ToolCall) -> (Value, bool) {
        if call.name == "echo" {
            return echo(call);
        }
        // A brain.say call that names no agent is Eris's (ADR 0089): she may use the desk's tools
        // (desk-tools, desk-run and the commands), never a bridge method on her own.
        let agent = call
            .agent_id
            .as_deref()
            .or_else(|| self.for_eris(call).then_some(ERIS));
        let Some(caller) = agent.and_then(agent_caller) else {
            let anonymous = format!(
                "{} runs only for a tool call that names its agent; this one names none Desk can use",
                call.name
            );
            let failed = error(ErrorCode::PermissionDenied, anonymous);
            return (json!({ "error": failed }), true);
        };
        let request = match self.tool_request(call) {
            Ok(request) => request,
            Err(unknown) => {
                return (
                    json!({ "error": error(ErrorCode::InvalidParams, unknown) }),
                    true,
                );
            }
        };
        if is_invoke(&request) {
            return self.invoke_for(turn, &caller, request);
        }
        match in_task(turn, || self.handle(&caller, request)) {
            (BridgeResponse::BridgeSuccess(ok), _) => (ok.result, false),
            (BridgeResponse::BridgeFailure(failure), denied) => {
                self.tool_error(&caller, failure.error, denied)
            }
        }
    }

    fn ended(&self, turn: &str) {
        self.end_task(turn);
    }

    fn offer(&self) -> Option<Vec<ToolDefinition>> {
        Core::offer(self)
    }

    fn context(&self, line: &str) -> Option<TurnContext> {
        self.turn_context(line)
    }

    fn finished(&self, asked: &str, answered: &str, steps: Vec<MemoryStep>) {
        self.keep_turn(asked, answered, steps);
    }
}

/// The agent a brain.say call that names none runs as: Eris (ADR 0089).
pub(crate) const ERIS: &str = "eris";

impl Core {
    /// Whether a call that names no agent is one of the desk's tools, which Eris runs.
    fn for_eris(&self, call: &ToolCall) -> bool {
        call.name == DESK_TOOLS
            || call.name == DESK_RUN
            || call.name == DESK_REMEMBER
            || self
                .tool_request(call)
                .is_ok_and(|r| is_invoke(&r) && call.name != "cmd.invoke")
    }
}

fn is_invoke(request: &BridgeRequest) -> bool {
    matches!(request, BridgeRequest::CmdInvoke(_))
}

/// The tool Desk runs for anyone: echo answers with its arguments. Any other is unknown here.
pub(crate) fn echo(call: &ToolCall) -> (Value, bool) {
    if call.name == "echo" {
        return (Value::Object(call.arguments.clone()), false);
    }
    let unknown = format!("Desk has no tool named {}", call.name);
    (json!({ "error": unknown }), true)
}
