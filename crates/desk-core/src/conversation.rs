//! Conversations with the brain for brain.say. The core opens the desk's session, holds its lease,
//! streams each turn back as brain.turn events and runs the tools the brain asks for. While the brain
//! is unreachable the turn waits with the offline line, and it resumes on reconnection.

use std::mem;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use desk_brain::{
    Brain, BrainErrorCode, BrainFailure, ClientInfo, CreateSessionRequest, LeaseHolder, StopReason,
    TextPart, ToolCall, ToolResultRequest, TurnEvent, TurnRequest, UserMessage,
};
use desk_bridge::{BrainTurnData, BrainTurnEvent, BrainTurnKind, BridgeEvent};
use serde_json::{Value, json};

use crate::events::EventBus;
use crate::lease::{LeaseClient, LeaseError};
use crate::sessions::{SessionStore, Speaker};

/// What Eris says while the brain is unreachable (docs/ko/first-run-scenario.md).
pub const OFFLINE_LINE: &str =
    "I can't reach endue right now. Check your connection, and I'll pick up where we left off.";
/// What Eris says on a desk whose session another desk took over.
pub const READ_ONLY_LINE: &str =
    "This conversation is open on another desk now, so this one is read-only.";
/// What Eris says when a turn failed for any other reason.
pub const FAILED_LINE: &str = "Something went wrong on my side. Try that again in a moment.";

/// Which kind of brain the desk talks to, as brain.status reports it while the brain answers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum BrainMode {
    /// A brain over the network, such as endue AI or examples/brain-echo.
    #[default]
    Cloud,
    /// A brain on this machine, running `model`.
    Local { model: String },
}

/// How the core talks to its brain.
#[derive(Debug, Clone)]
pub struct BrainOptions {
    /// The session store file; `None` keeps it in memory.
    pub state_file: Option<PathBuf>,
    /// The name other desks see in lease conflicts. `None` shows only the random desk id.
    pub desk_name: Option<String>,
    pub ttl_seconds: u64,
    /// The first wait before retrying an unreachable brain. It doubles up to `max_retry`.
    pub retry: Duration,
    pub max_retry: Duration,
    /// What brain.status names while the brain answers.
    pub mode: BrainMode,
}

impl Default for BrainOptions {
    fn default() -> Self {
        Self {
            state_file: None,
            desk_name: None,
            ttl_seconds: 60,
            retry: Duration::from_secs(1),
            max_retry: Duration::from_secs(15),
            mode: BrainMode::Cloud,
        }
    }
}

pub(crate) struct Conversation {
    brain: Arc<dyn Brain>,
    events: EventBus,
    options: BrainOptions,
    state: Mutex<State>,
    turns: AtomicU64,
}

struct State {
    store: SessionStore,
    lease: LeaseClient,
    /// Whether this run has opened its session yet: the first opening takes the lease over.
    opened: bool,
}

/// Why an attempt at a turn stopped.
enum Stop {
    Unreachable,
    ReadOnly,
    /// The session or lease is gone (the brain restarted, the lease expired): try again at once.
    Again,
    Failed,
}

impl Conversation {
    pub(crate) fn new(brain: Arc<dyn Brain>, events: EventBus, options: BrainOptions) -> Arc<Self> {
        let store = SessionStore::open(options.state_file.clone());
        let holder = LeaseHolder {
            desk_id: store.desk_id().to_owned(),
            name: options.desk_name.clone(),
        };
        let lease = LeaseClient::new(brain.clone(), holder, options.ttl_seconds);
        Arc::new(Self {
            brain,
            events,
            options,
            state: Mutex::new(State {
                store,
                lease,
                opened: false,
            }),
            turns: AtomicU64::new(0),
        })
    }

    /// Start a turn; its events follow as brain.turn with the returned id.
    pub(crate) fn say(self: &Arc<Self>, text: &str) -> String {
        let turn = format!("t{}", self.turns.fetch_add(1, Ordering::Relaxed) + 1);
        let (this, id, text) = (Arc::clone(self), turn.clone(), text.to_owned());
        let spawned = thread::Builder::new()
            .name("desk-brain-turn".to_owned())
            .spawn(move || this.run(&id, &text));
        if spawned.is_err() {
            Sink::new(&self.events, &turn).publish(BrainTurnKind::Error, Some(FAILED_LINE));
        }
        turn
    }

    /// Open `session_id` on this desk, taking its lease over from any other desk.
    pub(crate) fn open(&self, session_id: &str) -> Result<(), LeaseError> {
        let mut state = self.lock();
        if state.store.session_id() != Some(session_id) {
            state.store.set_session(Some(session_id.to_owned()));
        }
        state.lease.acquire(session_id, true)?;
        state.opened = true;
        Ok(())
    }

    pub(crate) fn session_id(&self) -> Option<String> {
        self.lock().store.session_id().map(str::to_owned)
    }

    /// The brain itself, for calls outside the session (the agent directory). They need no lock.
    pub(crate) fn brain(&self) -> &Arc<dyn Brain> {
        &self.brain
    }

    pub(crate) fn mode(&self) -> &BrainMode {
        &self.options.mode
    }

    fn run(&self, turn: &str, text: &str) {
        let mut state = self.lock();
        state.store.record(Speaker::Person, text);
        let mut sink = Sink::new(&self.events, turn);
        let (mut wait, mut again) = (self.options.retry, 0);
        loop {
            match self.attempt(&mut state, &mut sink, text) {
                Ok(()) => {
                    let answer = mem::take(&mut sink.answer);
                    state.store.record(Speaker::Eris, &answer);
                    return;
                }
                Err(Stop::Again) if again < 3 => again += 1,
                Err(Stop::Unreachable) => {
                    if !sink.offline {
                        sink.offline = true;
                        sink.publish(BrainTurnKind::Offline, Some(OFFLINE_LINE));
                    }
                    // Wait without the lock, so other calls are not held up by an absent brain.
                    drop(state);
                    thread::sleep(wait);
                    wait = (wait * 2).min(self.options.max_retry);
                    state = self.lock();
                }
                Err(Stop::ReadOnly) => {
                    sink.publish(BrainTurnKind::Error, Some(READ_ONLY_LINE));
                    return;
                }
                Err(Stop::Again | Stop::Failed) => {
                    sink.publish(BrainTurnKind::Error, Some(FAILED_LINE));
                    return;
                }
            }
        }
    }

    fn attempt(&self, state: &mut State, sink: &mut Sink<'_>, text: &str) -> Result<(), Stop> {
        let session = match state.store.session_id() {
            Some(id) => id.to_owned(),
            None => {
                let request = CreateSessionRequest {
                    title: None,
                    client: ClientInfo {
                        name: "endue Desk".to_owned(),
                        version: env!("CARGO_PKG_VERSION").to_owned(),
                    },
                };
                let session = self
                    .brain
                    .create_session(&request)
                    .map_err(|f| stop(state, f))?;
                sink.reached();
                state.store.set_session(Some(session.id.clone()));
                state.opened = false;
                session.id
            }
        };
        let lease = if state.opened {
            state.lease.ensure()
        } else {
            state
                .lease
                .acquire(&session, true)
                .map(|lease| lease.lease_id.clone())
        };
        let lease_id = lease.map_err(|e| lease_stop(state, e))?;
        state.opened = true;
        sink.reached();

        let request = TurnRequest {
            lease_id: lease_id.clone(),
            message: UserMessage {
                role: Default::default(),
                content: vec![TextPart {
                    r#type: Default::default(),
                    text: text.to_owned(),
                }],
            },
        };
        self.brain
            .create_turn(&session, &request, &mut |event| sink.on(event))
            .map_err(|f| stop(state, f))?;
        while let Some((turn_id, call)) = sink.pending.take() {
            let (output, failed) = run_tool(&call);
            let request = ToolResultRequest {
                lease_id: lease_id.clone(),
                call_id: call.call_id,
                output,
                is_error: failed.then_some(true),
            };
            self.brain
                .submit_tool_result(&session, &turn_id, &request, &mut |event| sink.on(event))
                .map_err(|f| stop(state, f))?;
        }
        if sink.completed && !sink.failed {
            Ok(())
        } else {
            Err(Stop::Failed)
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Map a refused call onto what the turn does next.
fn stop(state: &mut State, failure: BrainFailure) -> Stop {
    match failure.code() {
        None if matches!(failure, BrainFailure::Unreachable(_)) => Stop::Unreachable,
        Some(BrainErrorCode::NotFound) => {
            // The brain no longer knows the session: start a new one.
            state.store.set_session(None);
            Stop::Again
        }
        Some(
            BrainErrorCode::LeaseHeld | BrainErrorCode::LeaseLost | BrainErrorCode::LeaseExpired,
        ) => {
            let error = state.lease.refused(failure);
            lease_stop(state, error)
        }
        _ => Stop::Failed,
    }
}

fn lease_stop(state: &mut State, error: LeaseError) -> Stop {
    match error {
        LeaseError::ReadOnly { .. } => Stop::ReadOnly,
        LeaseError::Expired | LeaseError::NoSession => Stop::Again,
        LeaseError::Brain(failure) => stop(state, failure),
    }
}

/// The tools Desk runs for the brain. Only echo so far: it answers with its arguments.
fn run_tool(call: &ToolCall) -> (Value, bool) {
    match call.name.as_str() {
        "echo" => (Value::Object(call.arguments.clone()), false),
        other => (
            json!({ "error": format!("Desk has no tool named {other}") }),
            true,
        ),
    }
}

/// Turns brain stream events into brain.turn events for one turn.
struct Sink<'a> {
    events: &'a EventBus,
    turn: &'a str,
    offline: bool,
    pending: Option<(String, ToolCall)>,
    answer: String,
    completed: bool,
    failed: bool,
}

impl<'a> Sink<'a> {
    fn new(events: &'a EventBus, turn: &'a str) -> Self {
        Self {
            events,
            turn,
            offline: false,
            pending: None,
            answer: String::new(),
            completed: false,
            failed: false,
        }
    }

    fn publish(&self, kind: BrainTurnKind, text: Option<&str>) {
        self.events.publish(BridgeEvent::BrainTurn(BrainTurnEvent {
            event: Default::default(),
            data: BrainTurnData {
                turn_id: self.turn.to_owned(),
                kind,
                text: text.map(str::to_owned),
            },
        }));
    }

    /// The brain answered: a turn that was waiting offline is back online.
    fn reached(&mut self) {
        if mem::take(&mut self.offline) {
            self.publish(BrainTurnKind::Online, None);
        }
    }

    fn on(&mut self, event: TurnEvent) {
        self.reached();
        match event {
            TurnEvent::TurnStarted(_) => {
                self.answer.clear();
                self.publish(BrainTurnKind::Started, None);
            }
            TurnEvent::TextDelta(delta) => {
                self.answer.push_str(&delta.text);
                self.publish(BrainTurnKind::Delta, Some(&delta.text));
            }
            TurnEvent::ToolCall(call) => self.pending = Some((call.turn_id, call.call)),
            TurnEvent::TurnCompleted(done) if done.stop_reason == StopReason::ToolCall => {}
            TurnEvent::TurnCompleted(_) => {
                self.completed = true;
                self.publish(BrainTurnKind::Completed, None);
            }
            TurnEvent::TurnError(_) => self.failed = true,
        }
    }
}
