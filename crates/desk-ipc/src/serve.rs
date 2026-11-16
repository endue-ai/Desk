//! Serving connections: a reader and a writer thread per connection, and one fan-out thread that
//! copies each core event to the connections that may hear it (`owned.rs`, ADR 0262): an addressed
//! event to the callers it names, an owned one (a turn, a watch, a process...) to the connection
//! whose call started it, a command's answer to its caller, and the rest to everyone. An owned
//! event that comes before the answer that claims it waits, a few per key and for a few keys. The
//! desk never waits on a client: each connection has a queue of [`QUEUE`] lines, and a client that
//! lets it fill is dropped. When a connection ends and no other one calls as its caller, the core
//! ends what that caller started there (`Core::caller_left`).

use std::collections::{HashSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::{io, thread};

use desk_bridge::{BridgeResponse, BridgeSuccess, RequestId, True};
use desk_core::{Core, Delivery};
use serde_json::json;

use crate::CALLER;
use crate::owned::{self, Hears};
use crate::wire::{self, Asked};

/// Lines that may wait for one client before it is dropped.
pub(crate) const QUEUE: usize = 1000;
/// Keys whose events may wait for the answer that claims them, and lines each may hold.
const EARLY_KEYS: usize = 64;
const EARLY_LINES: usize = 64;

type Line = Arc<str>;

struct Entry {
    id: u64,
    /// Who the connection calls as: `cli`, or the agent it became.
    caller: Caller,
    /// The keys its calls' answers claimed (`owned::claimed`), until their last event.
    owns: HashSet<String>,
    queue: SyncSender<Line>,
    stream: UnixStream,
}

/// A connection's caller, shared by its reader (which may change it once) and the fan-out.
type Caller = Arc<Mutex<String>>;

fn name(caller: &Caller) -> String {
    caller
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[derive(Default)]
struct State {
    entries: Vec<Entry>,
    /// Owned events nobody has claimed yet, oldest key first.
    early: VecDeque<(String, Vec<Line>)>,
}

/// The connections the fan-out thread writes to.
#[derive(Clone, Default)]
pub(crate) struct Clients(Arc<Mutex<State>>);

/// Queue `line` for `entry`; false when it is to be dropped (its queue is full or its writer ended).
fn send(entry: &Entry, line: &Line) -> bool {
    match entry.queue.try_send(Arc::clone(line)) {
        Ok(()) => true,
        Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
            let _ = entry.stream.shutdown(Shutdown::Both);
            false
        }
    }
}

impl Clients {
    fn add(&self, entry: Entry) {
        self.lock().entries.push(entry);
    }

    /// Forget connection `id`; whether another connection still calls as `caller`.
    fn remove(&self, id: u64, caller: &str) -> bool {
        let mut state = self.lock();
        state.entries.retain(|entry| entry.id != id);
        state
            .entries
            .iter()
            .any(|entry| name(&entry.caller) == caller)
    }

    /// Connection `id` claimed `key`: it hears the key's events from now on, those that came early
    /// first. Called before the answer that claims it is queued.
    fn claim(&self, id: u64, key: String) {
        let mut state = self.lock();
        let early = match state.early.iter().position(|(k, _)| *k == key) {
            Some(at) => state
                .early
                .remove(at)
                .map(|(_, lines)| lines)
                .unwrap_or_default(),
            None => Vec::new(),
        };
        let Some(at) = state.entries.iter().position(|entry| entry.id == id) else {
            return;
        };
        if early.iter().all(|line| send(&state.entries[at], line)) {
            state.entries[at].owns.insert(key);
        } else {
            state.entries.remove(at);
        }
    }

    /// Queue `line` for the clients `who` lets hear; drop the ones whose queue is full or whose
    /// writer ended.
    fn deliver(&self, line: &Line, who: Hears) {
        let mut state = self.lock();
        match who {
            Hears::Everyone => state.entries.retain(|entry| send(entry, line)),
            Hears::Named(to) => state
                .entries
                .retain(|entry| !to.contains(&name(&entry.caller)) || send(entry, line)),
            Hears::Owner { key, to, last } => {
                let owner = state
                    .entries
                    .iter()
                    .position(|entry| entry.owns.contains(&key));
                match owner {
                    Some(at) => {
                        let entry = &mut state.entries[at];
                        let may = to
                            .as_ref()
                            .is_none_or(|to| to.contains(&name(&entry.caller)));
                        if last {
                            entry.owns.remove(&key);
                        }
                        if may && !send(entry, line) {
                            state.entries.remove(at);
                        }
                    }
                    None => wait(&mut state.early, key, line),
                }
            }
        }
    }

    /// End every connection (the listener is going away).
    pub(crate) fn close_all(&self) {
        for entry in self.lock().entries.drain(..) {
            let _ = entry.stream.shutdown(Shutdown::Both);
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Keep an owned event nobody claimed yet, for the answer that may claim it: the oldest key goes
/// when too many wait, and a key's oldest line when it holds too many. Most never get claimed
/// (they are the runtime's and its plugins'), so this stays small and bounded.
fn wait(early: &mut VecDeque<(String, Vec<Line>)>, key: String, line: &Line) {
    match early.iter_mut().find(|(k, _)| *k == key) {
        Some((_, lines)) => {
            if lines.len() == EARLY_LINES {
                lines.remove(0);
            }
            lines.push(Arc::clone(line));
        }
        None => {
            if early.len() == EARLY_KEYS {
                early.pop_front();
            }
            early.push_back((key, vec![Arc::clone(line)]));
        }
    }
}

/// Copy each core event to the clients that may hear it until `stop` is set (checked at each event).
pub(crate) fn fan_out(
    events: Receiver<Delivery>,
    clients: Clients,
    stop: Arc<AtomicBool>,
) -> io::Result<()> {
    thread::Builder::new()
        .name("desk-ipc-events".to_owned())
        .spawn(move || {
            for delivery in events {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                if let Some(line) = wire::event_line(&delivery.event) {
                    clients.deliver(&Line::from(line), owned::hears(&delivery));
                }
            }
        })
        .map(drop)
}

/// Serve one connection: it hears events from now on, and its requests are answered in order.
pub(crate) fn connection(
    stream: UnixStream,
    id: u64,
    core: Arc<Core>,
    clients: &Clients,
) -> io::Result<()> {
    let (queue, lines) = mpsc::sync_channel::<Line>(QUEUE);
    let writer = stream.try_clone()?;
    let reader = stream.try_clone()?;
    let caller: Caller = Arc::new(Mutex::new(CALLER.to_owned()));
    clients.add(Entry {
        id,
        caller: Arc::clone(&caller),
        owns: HashSet::new(),
        queue: queue.clone(),
        stream,
    });
    let spawned = thread::Builder::new()
        .name("desk-ipc-write".to_owned())
        .spawn(move || write(writer, lines))
        .and_then(|_| {
            let clients = clients.clone();
            thread::Builder::new()
                .name("desk-ipc-read".to_owned())
                .spawn(move || {
                    read(reader, &core, &queue, &caller, &|key| {
                        clients.claim(id, key)
                    });
                    let gone = name(&caller);
                    if !clients.remove(id, &gone) {
                        core.caller_left(&gone);
                    }
                })
        });
    if let Err(why) = spawned {
        clients.remove(id, CALLER);
        return Err(why);
    }
    Ok(())
}

fn write(mut stream: UnixStream, lines: Receiver<Line>) {
    for line in lines {
        if stream.write_all(line.as_bytes()).is_err() {
            break;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}

/// Answer each line through `Core::handle` until the client hangs up: as [`CALLER`], or as the agent
/// the connection asked to call as (ADR 0086).
fn read(
    stream: UnixStream,
    core: &Core,
    queue: &SyncSender<Line>,
    shared: &Caller,
    claim: &dyn Fn(String),
) {
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    let mut caller = CALLER.to_owned();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let answer = match wire::request(&line) {
            None => continue,
            Some(Asked::Bridge(request)) => {
                // What the answer starts is this connection's: claimed before the answer goes out.
                let claims = owned::claims(&request);
                let answer = core.handle(&caller, *request);
                if let Some(key) = owned::claimed(claims, &answer) {
                    claim(key);
                }
                answer
            }
            Some(Asked::Agent { id, agent }) => {
                let answer = become_agent(&mut caller, id, &agent);
                *shared.lock().unwrap_or_else(|p| p.into_inner()) = caller.clone();
                answer
            }
            Some(Asked::Invalid(invalid)) => invalid,
        };
        let Some(answer) = wire::answer_line(&answer) else {
            continue;
        };
        if queue.try_send(Line::from(answer)).is_err() {
            // The client stopped reading (or its writer ended): drop it.
            let _ = reader.get_ref().shutdown(Shutdown::Both);
            break;
        }
    }
}

/// `socket.agent`: from now on the connection calls as `agent:<agent>`, with that agent's grants,
/// allowlist, prompts and approvals (ADR 0072, 0078). Only a `cli` connection may: an agent stays the
/// agent it became, so a connection can narrow what it may do but never widen it.
fn become_agent(caller: &mut String, id: RequestId, agent: &str) -> BridgeResponse {
    if caller != CALLER {
        return wire::invalid(id, format!("this connection already calls as {caller}"));
    }
    let Some(named) = desk_core::agent_caller(agent) else {
        let why = format!(
            "{agent:?} is not an agent id: a letter or digit, then letters, digits, _ . or -, \
             122 characters at most"
        );
        return wire::invalid(id, why);
    };
    *caller = named;
    BridgeResponse::BridgeSuccess(BridgeSuccess {
        id,
        ok: True,
        result: json!({ "caller": caller }),
    })
}
