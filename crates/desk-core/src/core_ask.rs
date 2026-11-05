//! brain.ask (ADR 0059): one question, answered through a tool. Each ask opens a session of its own,
//! acquires its own lease, offers the caller's tool with toolChoice naming it, and takes the tool
//! call's arguments as the answer: they reach the caller as `structured` on the completed brain.turn
//! when they match the tool's schema. The core never runs the tool, releases the lease once the turn
//! ends, and never touches the desk's conversation (conversation.rs). Every event of an ask is
//! addressed to its caller only. An unreachable brain gives the offline turn brain.say gives; the ask
//! waits and resumes on reconnection.

use std::mem;
use std::sync::Arc;
use std::thread;

use desk_brain::{
    BrainFailure, ClientInfo, CreateSessionRequest, LeaseAcquireRequest, NamedToolChoice, TextPart,
    ToolChoice, ToolDefinition, TurnEvent, TurnRequest, UserMessage,
};
use desk_bridge::{
    BrainAskParams, BrainAskResult, BrainAskTool, BrainTurnData, BrainTurnEvent, BrainTurnKind,
    BridgeError, BridgeEvent, ErrorCode, Permission,
};
use serde_json::{Map, Value};

use crate::conversation::{Conversation, FAILED_LINE, OFFLINE_LINE};
use crate::handler::{Answer, Core, error, json};
use crate::manifest::schema_registry;
use crate::perm::Target;

impl Core {
    pub(crate) fn brain_ask(&self, caller: &str, params: BrainAskParams) -> Answer {
        self.check(caller, &Permission::BrainAsk(params.scope), &Target::None)?;
        let conversation = self.conversation.as_ref().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "no brain is configured for this desk".to_owned(),
            )
        })?;
        let prompt = params.prompt.trim();
        if prompt.is_empty() {
            return Err(error(
                ErrorCode::InvalidParams,
                "brain.ask needs a prompt".to_owned(),
            ));
        }
        let schema = compile(&params.tool.schema)?;
        let ask = Ask {
            conversation: Arc::clone(conversation),
            caller: caller.to_owned(),
            turn: conversation.next_ask(),
            prompt: prompt.to_owned(),
            tool: params.tool,
            schema,
        };
        let turn = ask.turn.clone();
        let (events, to) = (conversation.events().clone(), vec![caller.to_owned()]);
        let spawned = thread::Builder::new()
            .name("desk-brain-ask".to_owned())
            .spawn(move || ask.run());
        if spawned.is_err() {
            let data = turn_data(&turn, BrainTurnKind::Error, Some(FAILED_LINE), None);
            events.publish_to(to, brain_turn(data));
        }
        json(BrainAskResult { turn_id: turn })
    }
}

/// The tool's schema, compiled against the desk's own specs: a JSON Schema whose type is object.
/// Nothing is fetched: a `$ref` outside the specs does not compile.
fn compile(schema: &Map<String, Value>) -> Result<jsonschema::Validator, BridgeError> {
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err(error(
            ErrorCode::InvalidParams,
            "tool.schema must describe an object (\"type\": \"object\")".to_owned(),
        ));
    }
    jsonschema::options()
        .with_registry(schema_registry())
        .should_validate_formats(false)
        .build(&Value::Object(schema.clone()))
        .map_err(|e| error(ErrorCode::InvalidParams, format!("tool.schema: {e}")))
}

struct Ask {
    conversation: Arc<Conversation>,
    caller: String,
    turn: String,
    prompt: String,
    tool: BrainAskTool,
    schema: jsonschema::Validator,
}

/// Why an attempt at an ask stopped.
enum Stop {
    Unreachable,
    Failed,
}

impl Ask {
    fn run(self) {
        let options = self.conversation.options();
        let mut sink = Sink::new(&self);
        let mut wait = options.retry;
        loop {
            match self.attempt(&mut sink) {
                Ok(()) => return,
                Err(Stop::Unreachable) => {
                    if !mem::replace(&mut sink.offline, true) {
                        sink.publish(BrainTurnKind::Offline, Some(OFFLINE_LINE), None);
                    }
                    thread::sleep(wait);
                    wait = (wait * 2).min(options.max_retry);
                }
                Err(Stop::Failed) => {
                    sink.publish(BrainTurnKind::Error, Some(FAILED_LINE), None);
                    return;
                }
            }
        }
    }

    /// One try: a new session and lease, the turn, then the lease back whatever the turn did.
    fn attempt(&self, sink: &mut Sink<'_>) -> Result<(), Stop> {
        let brain = self.conversation.brain();
        let request = CreateSessionRequest {
            title: Some(format!("brain.ask: {}", self.tool.name)),
            client: ClientInfo {
                name: "endue Desk".to_owned(),
                version: env!("CARGO_PKG_VERSION").to_owned(),
            },
        };
        let session = brain.create_session(&request).map_err(stop)?;
        sink.reached();
        let acquire = LeaseAcquireRequest {
            holder: self.conversation.holder().clone(),
            ttl_seconds: self.conversation.options().ttl_seconds,
            takeover: None,
        };
        let lease = brain.acquire_lease(&session.id, &acquire).map_err(stop)?;
        let request = self.request(lease.lease_id.clone());
        let turn = brain.create_turn(&session.id, &request, &mut |event| sink.on(event));
        // A brain that cannot be reached now lets the lease run out instead.
        let _ = brain.release_lease(&session.id, &lease.lease_id);
        turn.map_err(stop)?;
        sink.finish(&self.schema)
    }

    /// The prompt as the person's message, with the caller's tool offered and named.
    fn request(&self, lease_id: String) -> TurnRequest {
        let tool = ToolDefinition {
            name: self.tool.name.clone(),
            description: self.tool.description.clone(),
            schema: self.tool.schema.clone(),
        };
        let choice = NamedToolChoice {
            r#type: Default::default(),
            name: self.tool.name.clone(),
        };
        TurnRequest {
            lease_id,
            message: UserMessage {
                role: Default::default(),
                content: vec![TextPart {
                    r#type: Default::default(),
                    text: self.prompt.clone(),
                }],
            },
            tools: Some(vec![tool]),
            tool_choice: Some(ToolChoice::NamedTool(choice)),
        }
    }
}

fn stop(failure: BrainFailure) -> Stop {
    match failure {
        BrainFailure::Unreachable(_) => Stop::Unreachable,
        _ => Stop::Failed,
    }
}

fn turn_data(
    turn: &str,
    kind: BrainTurnKind,
    text: Option<&str>,
    structured: Option<Map<String, Value>>,
) -> BrainTurnData {
    BrainTurnData {
        turn_id: turn.to_owned(),
        kind,
        text: text.map(str::to_owned),
        structured,
        tool: None,
    }
}

fn brain_turn(data: BrainTurnData) -> BridgeEvent {
    BridgeEvent::BrainTurn(BrainTurnEvent {
        event: Default::default(),
        data,
    })
}

/// Turns one ask's stream into brain.turn events for its caller, keeping the tool's arguments.
struct Sink<'a> {
    ask: &'a Ask,
    offline: bool,
    arguments: Option<Map<String, Value>>,
    completed: bool,
    failed: bool,
}

impl<'a> Sink<'a> {
    fn new(ask: &'a Ask) -> Self {
        Self {
            ask,
            offline: false,
            arguments: None,
            completed: false,
            failed: false,
        }
    }

    fn publish(
        &self,
        kind: BrainTurnKind,
        text: Option<&str>,
        structured: Option<Map<String, Value>>,
    ) {
        let data = turn_data(&self.ask.turn, kind, text, structured);
        let to = vec![self.ask.caller.clone()];
        self.ask
            .conversation
            .events()
            .publish_to(to, brain_turn(data));
    }

    /// The brain answered: an ask that was waiting offline is back online.
    fn reached(&mut self) {
        if mem::take(&mut self.offline) {
            self.publish(BrainTurnKind::Online, None, None);
        }
    }

    fn on(&mut self, event: TurnEvent) {
        self.reached();
        match event {
            TurnEvent::TurnStarted(_) => {
                (self.arguments, self.completed, self.failed) = (None, false, false);
                self.publish(BrainTurnKind::Started, None, None);
            }
            TurnEvent::TextDelta(delta) => {
                self.publish(BrainTurnKind::Delta, Some(&delta.text), None);
            }
            // The first call of the caller's tool is the answer; the core runs nothing.
            TurnEvent::ToolCall(call) if call.call.name == self.ask.tool.name => {
                self.arguments.get_or_insert(call.call.arguments);
            }
            TurnEvent::ToolCall(_) => {}
            // Whatever the stop reason, tool_call included: an ask's turn ends here.
            TurnEvent::TurnCompleted(_) => self.completed = true,
            TurnEvent::TurnError(_) => self.failed = true,
        }
    }

    /// completed, with the arguments when they match the tool's schema.
    fn finish(&mut self, schema: &jsonschema::Validator) -> Result<(), Stop> {
        if self.failed || !self.completed {
            return Err(Stop::Failed);
        }
        let structured = self
            .arguments
            .take()
            .filter(|arguments| schema.is_valid(&Value::Object(arguments.clone())));
        self.publish(BrainTurnKind::Completed, None, structured);
        Ok(())
    }
}
