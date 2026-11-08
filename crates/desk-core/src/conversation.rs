//! Conversations with the brain for brain.say. The core opens the desk's session, holds its lease,
//! streams each turn back as brain.turn events and runs the tools the brain asks for, through the
//! core once it routes them (`Tools`, `agent_tools`), else echo alone. Once routed, each turn offers
//! the desk's tools (ADR 0088). While the brain is unreachable the turn waits with the offline line,
//! and it resumes on reconnection. A turn that ends in words says completed once Eris's episode
//! of it is kept (ADR 0096, `held`).

mod held;

use std::mem;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::thread;

use desk_brain::{
    Brain, BrainErrorCode, BrainFailure, ClientInfo, CreateSessionRequest, LeaseHolder,
    ToolResultRequest, TurnRequest,
};
use desk_bridge::{BrainDesk, BrainTurnKind, BrainTurnTool};

use crate::agent_tools::echo;
use crate::conversation_sink::Sink;
use crate::desk_context::{self, Line};
use crate::events::EventBus;
use crate::lease::{LeaseClient, LeaseError};
use crate::sessions::{SessionStore, Speaker};
use held::Held;

pub use crate::brain_options::{BrainMode, BrainOptions};
pub(crate) use crate::conversation_tools::Tools;
pub use crate::eris_lines::*;

pub(crate) struct Conversation {
    brain: Arc<dyn Brain>,
    events: EventBus,
    options: BrainOptions,
    /// This desk as other desks see it in lease conflicts; brain.ask's leases name it too.
    holder: LeaseHolder,
    state: Mutex<State>,
    /// Turn and ask numbers, shared by every brain a desk chooses from, so ids never repeat.
    turns: Arc<AtomicU64>,
    asks: Arc<AtomicU64>,
    tools: OnceLock<Weak<dyn Tools>>,
}

/// Where a turn goes when its brain cannot be reached (ADR 0094): the local brain, and whether
/// Eris has said so since the chosen brain last answered.
#[derive(Clone)]
pub(crate) struct Fallback {
    pub to: Arc<Conversation>,
    pub said: Arc<AtomicBool>,
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
    /// The brain called tools past `MAX_STEPS` in one turn.
    TooMany,
    /// The brain wants an endue ID token: nobody is signed in, or the token is no longer good.
    SignedOut,
}

impl Conversation {
    pub(crate) fn new(brain: Arc<dyn Brain>, events: EventBus, options: BrainOptions) -> Arc<Self> {
        Self::counted(brain, events, options, Arc::default(), Arc::default())
    }

    /// A conversation numbering its turns and asks with `turns` and `asks`.
    pub(crate) fn counted(
        brain: Arc<dyn Brain>,
        events: EventBus,
        options: BrainOptions,
        turns: Arc<AtomicU64>,
        asks: Arc<AtomicU64>,
    ) -> Arc<Self> {
        let store = SessionStore::open(options.state_file.clone());
        let holder = LeaseHolder {
            desk_id: store.desk_id().to_owned(),
            name: options.desk_name.clone(),
        };
        let lease = LeaseClient::new(brain.clone(), holder.clone(), options.ttl_seconds);
        Arc::new(Self {
            brain,
            events,
            options,
            holder,
            state: Mutex::new(State {
                store,
                lease,
                opened: false,
            }),
            turns,
            asks,
            tools: OnceLock::new(),
        })
    }

    /// Run the brain's tools through `tools` from now on. The first one set stays.
    pub(crate) fn route(&self, tools: Weak<dyn Tools>) {
        let _ = self.tools.set(tools);
    }

    /// Start a turn; its events follow as brain.turn with the returned id. `desk` is what the
    /// person sees (ADR 0109). While the brain cannot be reached, a reachable `fallback` answers.
    pub(crate) fn say(
        self: &Arc<Self>,
        text: &str,
        desk: Option<BrainDesk>,
        fallback: Option<Fallback>,
    ) -> String {
        let turn = format!("t{}", self.turns.fetch_add(1, Ordering::Relaxed) + 1);
        let (this, id, text) = (Arc::clone(self), turn.clone(), text.to_owned());
        let spawned = thread::Builder::new()
            .name("desk-brain-turn".to_owned())
            .spawn(move || {
                let line = Line {
                    text: &text,
                    desk: desk.as_ref(),
                };
                this.run(&id, line, fallback.as_ref(), None);
                if let Some(tools) = this.tools.get().and_then(Weak::upgrade) {
                    tools.ended(&id);
                }
            });
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

    /// Whether the brain answers at all now: anything but `Unreachable` from its spaces.
    pub(crate) fn reachable(&self) -> bool {
        !matches!(self.brain.list_spaces(), Err(BrainFailure::Unreachable(_)))
    }

    pub(crate) fn mode(&self) -> &BrainMode {
        &self.options.mode
    }

    /// What brain.ask (core_ask) shares with the conversation: the bus, the options and the holder,
    /// none of them behind the session's lock.
    pub(crate) fn events(&self) -> &EventBus {
        &self.events
    }

    pub(crate) fn options(&self) -> &BrainOptions {
        &self.options
    }

    pub(crate) fn holder(&self) -> &LeaseHolder {
        &self.holder
    }

    /// The id of the next brain.ask turn: `a1`, `a2` and on, apart from brain.say's `t` turns.
    pub(crate) fn next_ask(&self) -> String {
        format!("a{}", self.asks.fetch_add(1, Ordering::Relaxed) + 1)
    }

    /// Run turn `turn`; `prefix` is said first, before the brain's answer.
    fn run(&self, turn: &str, line: Line<'_>, fallback: Option<&Fallback>, prefix: Option<&str>) {
        let mut state = self.lock();
        state.store.record(Speaker::Person, line.text);
        let mut sink = Sink::new(&self.events, turn);
        sink.prefix = prefix.map(str::to_owned);
        let mut held = Held::default();
        let (mut wait, mut again) = (self.options.retry, 0);
        loop {
            let attempt = self.attempt(&mut state, &mut sink, &mut held, line);
            if attempt.is_err() {
                // A turn the brain completed and the desk still fails says both, as it always has.
                held.release(&sink);
            }
            match attempt {
                Ok(()) => {
                    let answer = mem::take(&mut sink.answer);
                    state.store.record(Speaker::Eris, &answer);
                    if let Some(tools) = self.tools.get().and_then(Weak::upgrade) {
                        tools.finished(line.text, &answer, mem::take(&mut sink.steps));
                    }
                    // Only now, with the episode kept, does the turn say completed (#575).
                    held.release(&sink);
                    if let Some(fallback) = fallback {
                        fallback.said.store(false, Ordering::SeqCst);
                    }
                    return;
                }
                Err(Stop::Again) if again < 3 => again += 1,
                // The chosen brain is out of reach and the local brain is not (ADR 0094).
                Err(Stop::Unreachable) if fallback.is_some_and(|f| f.to.reachable()) => {
                    sink.reached();
                    drop(state);
                    let fallback = fallback.expect("checked above");
                    let first = !fallback.said.swap(true, Ordering::SeqCst);
                    fallback
                        .to
                        .run(turn, line, None, first.then_some(FALLBACK_LINE));
                    return;
                }
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
                Err(Stop::TooMany) => {
                    sink.publish(BrainTurnKind::Error, Some(TOO_MANY_LINE));
                    return;
                }
                Err(Stop::SignedOut) => {
                    sink.publish(BrainTurnKind::Error, Some(SIGN_IN_LINE));
                    return;
                }
                Err(Stop::Again | Stop::Failed) => {
                    sink.publish(BrainTurnKind::Error, Some(FAILED_LINE));
                    return;
                }
            }
        }
    }

    fn attempt(
        &self,
        state: &mut State,
        sink: &mut Sink<'_>,
        held: &mut Held,
        line: Line<'_>,
    ) -> Result<(), Stop> {
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

        let routed = self.tools.get().and_then(Weak::upgrade);
        let said = line.desk.map(|desk| match &routed {
            Some(tools) => tools.describe(desk),
            None => desk_context::render(desk, &|_| Vec::new()),
        });
        let request = TurnRequest {
            lease_id: lease_id.clone(),
            message: desk_context::message(line.text, said),
            tools: routed.as_ref().and_then(|tools| tools.offer(line.desk)),
            tool_choice: None,
            context: routed.as_ref().and_then(|tools| tools.context(line.text)),
        };
        self.brain
            .create_turn(&session, &request, &mut |event| held.on(sink, event))
            .map_err(|f| stop(state, f))?;
        // Eris's agentic loop: each call runs on the desk and its result goes back to the brain,
        // until the brain answers in words or the turn has made MAX_STEPS calls.
        let mut steps = 0;
        while let Some((turn_id, call)) = sink.pending.take() {
            steps += 1;
            if steps > MAX_STEPS {
                return Err(Stop::TooMany);
            }
            let step = routed.as_ref().and_then(|tools| tools.step(&call));
            if let Some(tool) = &step {
                sink.step(BrainTurnKind::Tool, tool.clone());
            }
            let (output, failed) = routed
                .as_ref()
                .map_or_else(|| echo(&call), |tools| tools.run(sink.turn, &call));
            if let Some(tool) = step {
                let ok = Some(!failed);
                sink.step(BrainTurnKind::ToolResult, BrainTurnTool { ok, ..tool });
            }
            let request = |lease_id| ToolResultRequest {
                lease_id,
                call_id: call.call_id.clone(),
                output: output.clone(),
                is_error: failed.then_some(true),
            };
            // A tool may wait for the person (a prompt, an approval) longer than the lease lasts:
            // its result then goes back under the lease acquired again, not by running the turn again.
            for again in [false, true] {
                let lease_id = state.lease.ensure().map_err(|e| lease_stop(state, e))?;
                match self.brain.submit_tool_result(
                    &session,
                    &turn_id,
                    &request(lease_id),
                    &mut |event| held.on(sink, event),
                ) {
                    Ok(_) => break,
                    Err(f) if !again && f.code() == Some(BrainErrorCode::LeaseExpired) => {
                        state.lease.refused(f);
                    }
                    Err(f) => return Err(stop(state, f)),
                }
            }
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
        Some(BrainErrorCode::Unauthorized) => Stop::SignedOut,
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
