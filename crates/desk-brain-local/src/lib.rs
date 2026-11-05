//! Local brain adapter: `LocalBrain` implements `desk_brain::Brain` on Ollama's `/api/chat`, so a
//! desk works without endue AI. Sessions and leases live here, kept in one JSON file in a folder
//! the caller chooses; every turn streams the events of `specs/brain/v0`.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod events;
mod http;
mod ollama;
mod options;
mod store;
mod time;
mod tools;

pub use options::{DEFAULT_BASE_URL, LocalBrainOptions};
pub use store::STATE_FILE;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use desk_brain::{
    Brain, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest,
    Session, SpaceList, StopReason, ToolCall, ToolResultRequest, TurnEvent, TurnRequest,
};
use serde_json::Value;

use crate::events::{completed, delta, started, tool_call};
use crate::http::Endpoint;
use crate::ollama::{Answer, Piece};
use crate::store::{State, Waiting, invalid, not_found};
use crate::time::rfc3339;

/// A brain on this machine: Ollama for the answers, a JSON file for everything else.
pub struct LocalBrain {
    endpoint: Endpoint,
    model: String,
    tools: Vec<Value>,
    /// The agent the model speaks for, when the desk runs its tool calls (`with_agent`).
    agent: Option<String>,
    folder: PathBuf,
    state: Mutex<State>,
    clock: Box<dyn Fn() -> u64 + Send + Sync>,
}

/// What a tool result leads to.
enum Step {
    /// Another call of the same answer goes out.
    Next(ToolCall),
    /// Every result is in: these messages go to the model with the turn's tools (`None`: the
    /// brain's own), and `prefix` joins the conversation.
    Ask {
        prefix: Vec<Value>,
        messages: Vec<Value>,
        tools: Option<Vec<Value>>,
    },
}

impl LocalBrain {
    /// The brain whose state lives in `folder` (created when missing), in `STATE_FILE`.
    pub fn open(folder: impl AsRef<Path>, options: LocalBrainOptions) -> Result<Self, String> {
        if options.model.trim().is_empty() {
            return Err("LocalBrainOptions names no model".to_owned());
        }
        let endpoint = Endpoint::parse(&options.base_url)?;
        options.check_agent()?;
        let folder = folder.as_ref().to_path_buf();
        fs::create_dir_all(&folder)
            .map_err(|e| format!("{} cannot be created: {e}", folder.display()))?;
        let state = State::load(&folder)?;
        Ok(Self {
            endpoint,
            model: options.model,
            tools: options.tools,
            agent: options.agent,
            folder,
            state: Mutex::new(state),
            clock: Box::new(time::now_ms),
        })
    }

    /// Read the time from `clock` (milliseconds since the Unix epoch) instead of the system clock.
    pub fn with_clock(mut self, clock: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        self.clock = Box::new(clock);
        self
    }

    pub fn base_url(&self) -> String {
        self.endpoint.url()
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn read<T>(
        &self,
        read: impl FnOnce(&State, u64) -> Result<T, BrainFailure>,
    ) -> Result<T, BrainFailure> {
        read(&self.lock(), (self.clock)())
    }

    /// Apply `change` to a copy of the state, and keep the copy only once it is written to disk.
    fn change<T>(
        &self,
        change: impl FnOnce(&mut State, u64) -> Result<T, BrainFailure>,
    ) -> Result<T, BrainFailure> {
        let now = (self.clock)();
        let mut state = self.lock();
        let mut next = state.clone();
        let out = change(&mut next, now)?;
        next.save(&self.folder)?;
        *state = next;
        Ok(out)
    }

    /// Ask the model, without holding the state, streaming its text as `text.delta`.
    fn ask(
        &self,
        messages: &[Value],
        tools: &[Value],
        turn_id: &str,
        start: bool,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<Answer, BrainFailure> {
        ollama::chat(
            &self.endpoint,
            &self.model,
            tools,
            messages,
            &mut |piece| match piece {
                Piece::Opened if start => on_event(started(turn_id)),
                Piece::Opened => {}
                Piece::Text(text) => on_event(delta(turn_id, text)),
            },
        )
    }

    /// Keep what the model answered and end this part of the turn: with the first tool call when
    /// it asked for tools, otherwise with its stop reason. `tools` are the turn's, for its rest.
    fn finish(
        &self,
        (session_id, turn_id): (&str, &str),
        prefix: Vec<Value>,
        answer: Answer,
        tools: Option<Vec<Value>>,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let first = self.change(|state, now| {
            let calls: Vec<ToolCall> = answer
                .calls
                .iter()
                .map(|call| ToolCall {
                    call_id: state.id("call"),
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                    // The agent the person named for the model; with none, Desk runs only echo.
                    agent_id: self.agent.clone(),
                })
                .collect();
            let stored = state.session_mut(session_id)?;
            stored.messages.extend(prefix);
            stored.updated_at = rfc3339(now);
            let Some(first) = calls.first().cloned() else {
                stored.messages.push(ollama::assistant(&answer.text, &[]));
                stored.waiting = None;
                return Ok(None);
            };
            stored.waiting = Some(Waiting {
                turn_id: turn_id.to_owned(),
                assistant: ollama::assistant(&answer.text, &answer.calls),
                calls,
                results: Vec::new(),
                tools,
            });
            Ok(Some(first))
        })?;
        if let Some(call) = first {
            on_event(tool_call(turn_id, call));
        }
        on_event(completed(turn_id, answer.stop));
        Ok(())
    }
}

impl Brain for LocalBrain {
    fn create_session(&self, request: &CreateSessionRequest) -> Result<Session, BrainFailure> {
        if request.client.name.is_empty() || request.client.version.is_empty() {
            return Err(invalid("The client needs a name and a version."));
        }
        self.change(|state, now| Ok(state.create_session(request.title.clone(), now)))
    }

    fn get_session(&self, session_id: &str) -> Result<Session, BrainFailure> {
        self.read(|state, now| Ok(state.session(session_id)?.session(now)))
    }

    fn create_turn(
        &self,
        session_id: &str,
        request: &TurnRequest,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        if request.lease_id.is_empty() || request.message.content.is_empty() {
            return Err(invalid(
                "A turn needs a lease and at least one message part.",
            ));
        }
        let text: String = request
            .message
            .content
            .iter()
            .map(|part| part.text.as_str())
            .collect();
        let user = ollama::user(&text);
        let offer = tools::for_turn(&self.tools, request)?;
        let (turn_id, mut messages) = self.change(|state, now| {
            state.session(session_id)?.writer(&request.lease_id, now)?;
            let turn_id = state.id("turn");
            let stored = state.session_mut(session_id)?;
            // A new turn leaves behind a tool call that was still waiting.
            stored.waiting = None;
            stored.updated_at = rfc3339(now);
            let mut messages = stored.messages.clone();
            messages.push(user.clone());
            Ok((turn_id, messages))
        })?;
        // The system line that asks for a tool goes with this request only.
        messages.splice(0..0, offer.system);
        let answer = self.ask(&messages, &offer.tools, &turn_id, true, on_event)?;
        let tools = request.tools.is_some().then_some(offer.tools);
        self.finish((session_id, &turn_id), vec![user], answer, tools, on_event)
    }

    fn submit_tool_result(
        &self,
        session_id: &str,
        turn_id: &str,
        request: &ToolResultRequest,
        on_event: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        if request.lease_id.is_empty() || request.call_id.is_empty() {
            return Err(invalid("A tool result needs a lease and a call id."));
        }
        let step = self.change(|state, now| {
            let stored = state.session_mut(session_id)?;
            stored.writer(&request.lease_id, now)?;
            let waiting = stored
                .waiting
                .as_mut()
                .filter(|waiting| waiting.turn_id == turn_id)
                .ok_or_else(|| {
                    not_found(format!("Turn {turn_id} is not waiting for a tool result."))
                })?;
            let expected = &waiting.calls[waiting.results.len()];
            if expected.call_id != request.call_id {
                return Err(not_found(format!(
                    "Turn {turn_id} waits for {}, not {}.",
                    expected.call_id, request.call_id
                )));
            }
            let result = ollama::tool(
                &expected.name,
                &request.output,
                request.is_error == Some(true),
            );
            if waiting.results.len() + 1 < waiting.calls.len() {
                waiting.results.push(result);
                let next = waiting.calls[waiting.results.len()].clone();
                stored.updated_at = rfc3339(now);
                return Ok(Step::Next(next));
            }
            // The last result stays out of the state until the model has answered, so a failed
            // request can be retried with the same result.
            let mut prefix = vec![waiting.assistant.clone()];
            prefix.extend(waiting.results.iter().cloned());
            prefix.push(result);
            let mut messages = stored.messages.clone();
            messages.extend(prefix.iter().cloned());
            let tools = waiting.tools.clone();
            Ok(Step::Ask {
                prefix,
                messages,
                tools,
            })
        })?;
        match step {
            Step::Next(call) => {
                on_event(tool_call(turn_id, call));
                on_event(completed(turn_id, StopReason::ToolCall));
                Ok(())
            }
            Step::Ask {
                prefix,
                messages,
                tools,
            } => {
                let offered = tools.as_deref().unwrap_or(&self.tools);
                let answer = self.ask(&messages, offered, turn_id, false, on_event)?;
                self.finish((session_id, turn_id), prefix, answer, tools, on_event)
            }
        }
    }

    fn get_lease(&self, session_id: &str) -> Result<Lease, BrainFailure> {
        self.read(|state, now| {
            state
                .session(session_id)?
                .current(now)
                .cloned()
                .ok_or_else(|| not_found(format!("Session {session_id} has no lease in force.")))
        })
    }

    fn acquire_lease(
        &self,
        session_id: &str,
        request: &LeaseAcquireRequest,
    ) -> Result<Lease, BrainFailure> {
        if request.holder.desk_id.is_empty() {
            return Err(invalid("A lease holder needs a deskId."));
        }
        check_ttl(request.ttl_seconds)?;
        let takeover = request.takeover == Some(true);
        self.change(|state, now| {
            state.acquire(
                session_id,
                &request.holder,
                request.ttl_seconds,
                takeover,
                now,
            )
        })
    }

    fn renew_lease(
        &self,
        session_id: &str,
        lease_id: &str,
        request: &LeaseRenewRequest,
    ) -> Result<Lease, BrainFailure> {
        if let Some(ttl) = request.ttl_seconds {
            check_ttl(ttl)?;
        }
        self.change(|state, now| {
            state
                .session_mut(session_id)?
                .renew(lease_id, request.ttl_seconds, now)
        })
    }

    fn release_lease(&self, session_id: &str, lease_id: &str) -> Result<(), BrainFailure> {
        self.change(|state, now| state.session_mut(session_id)?.release(lease_id, now))
    }

    /// No spaces on this machine, but asking reaches Ollama: `Unreachable` while it does not
    /// answer, which is how the desk knows whether the local brain can stand in (ADR 0094).
    fn list_spaces(&self) -> Result<SpaceList, BrainFailure> {
        ollama::version(&self.endpoint)?;
        Ok(SpaceList { items: Vec::new() })
    }
}

fn check_ttl(seconds: u64) -> Result<(), BrainFailure> {
    if (5..=3600).contains(&seconds) {
        Ok(())
    } else {
        Err(invalid(format!(
            "ttlSeconds must be between 5 and 3600, not {seconds}."
        )))
    }
}
