//! The brain's tool calls, run by the core (CORE-14, ADR 0072). A call that names its agent
//! (`ToolCall.agentId`) runs as the caller `agent:<id>`: `echo`, or any bridge method by its name with
//! the call's arguments as its params, so the permission engine, the agent's allowlist, the prompt
//! and the `perm` log apply as to any caller. `cmd.invoke` waits for the command's answer. A call
//! that names no agent runs `echo` only. Failures come back as `{ error, reason? }`.

use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use desk_brain::ToolCall;
use desk_bridge::{BridgeError, BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode};
use serde_json::{Value, json};

use crate::agents::agent_caller;
use crate::conversation::{Tools, echo};
use crate::handler::{Core, error};

/// How long a command run from a tool call may take to answer.
const COMMAND_WAIT: Duration = Duration::from_secs(300);

impl Core {
    /// Run the brain's tool calls through this core from now on, each as the agent that asks for
    /// it. Without it the brain gets `echo` only. Call it once the core is shared.
    pub fn route_tools(self: &Arc<Self>) {
        if let Some(conversation) = &self.conversation {
            let tools: Weak<dyn Tools> = Arc::downgrade(self) as Weak<Core>;
            conversation.route(tools);
        }
    }

    /// The tool's output from a bridge failure, with why the agent was refused when it was.
    fn tool_error(&self, caller: &str, failed: BridgeError) -> (Value, bool) {
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
    fn invoke_for(&self, caller: &str, request: BridgeRequest) -> (Value, bool) {
        let events = self.events().subscribe();
        let started = match self.handle(caller, request) {
            BridgeResponse::BridgeSuccess(ok) => ok.result,
            BridgeResponse::BridgeFailure(failure) => {
                return self.tool_error(caller, failure.error);
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
}

impl Tools for Core {
    fn run(&self, call: &ToolCall) -> (Value, bool) {
        if call.name == "echo" {
            return echo(call);
        }
        let Some(caller) = call.agent_id.as_deref().and_then(agent_caller) else {
            let anonymous = format!(
                "{} runs only for a tool call that names its agent; this one names none Desk can use",
                call.name
            );
            let failed = error(ErrorCode::PermissionDenied, anonymous);
            return (json!({ "error": failed }), true);
        };
        let request = json!({ "id": 0, "method": call.name, "params": call.arguments });
        let request = match serde_json::from_value::<BridgeRequest>(request) {
            Ok(request) => request,
            Err(_) => {
                let unknown = format!(
                    "Desk has no tool named {} that takes these arguments",
                    call.name
                );
                return (
                    json!({ "error": error(ErrorCode::InvalidParams, unknown) }),
                    true,
                );
            }
        };
        if matches!(request, BridgeRequest::CmdInvoke(_)) {
            return self.invoke_for(&caller, request);
        }
        match self.handle(&caller, request) {
            BridgeResponse::BridgeSuccess(ok) => (ok.result, false),
            BridgeResponse::BridgeFailure(failure) => self.tool_error(&caller, failure.error),
        }
    }
}
