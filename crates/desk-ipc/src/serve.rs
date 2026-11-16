//! Serving connections: a reader and a writer thread per connection, and one fan-out thread that
//! copies every core event to every connection, except the microphone's: `audio.frame` and
//! `audio.ended` reach only the connection whose caller they name, and `audio.capturing` (the
//! runtime's) none (ADR 0245). The desk never waits on a client: each connection has a queue of
//! [`QUEUE`] lines, and a client that lets it fill is dropped. When a connection ends and no other
//! one calls as its caller, the core ends what that caller started there (`Core::caller_left`).

use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::{io, thread};

use desk_bridge::{BridgeEvent, BridgeResponse, BridgeSuccess, RequestId, True};
use desk_core::{Core, Delivery};
use serde_json::json;

use crate::CALLER;
use crate::wire::{self, Asked};

/// Lines that may wait for one client before it is dropped.
pub(crate) const QUEUE: usize = 1000;

type Line = Arc<str>;

struct Entry {
    id: u64,
    /// Who the connection calls as: `cli`, or the agent it became.
    caller: Caller,
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

/// Who may hear `delivery` over the socket: everyone, the callers it names, or nobody.
enum Hears {
    Everyone,
    Named(Vec<String>),
    Nobody,
}

fn hears(delivery: &Delivery) -> Hears {
    match (&delivery.event, &delivery.to) {
        // The runtime's alone: no socket connection calls as `desk`.
        (BridgeEvent::AudioCapturing(_), _) => Hears::Nobody,
        // The microphone's audio is its caller's alone, whoever else listens on the socket.
        (BridgeEvent::AudioFrame(_) | BridgeEvent::AudioEnded(_), Some(to)) => {
            Hears::Named(to.clone())
        }
        (BridgeEvent::AudioFrame(_) | BridgeEvent::AudioEnded(_), None) => Hears::Nobody,
        _ => Hears::Everyone,
    }
}

/// The connections the fan-out thread writes to.
#[derive(Clone, Default)]
pub(crate) struct Clients(Arc<Mutex<Vec<Entry>>>);

impl Clients {
    fn add(&self, entry: Entry) {
        self.lock().push(entry);
    }

    /// Forget connection `id`; whether another connection still calls as `caller`.
    fn remove(&self, id: u64, caller: &str) -> bool {
        let mut entries = self.lock();
        entries.retain(|entry| entry.id != id);
        entries.iter().any(|entry| name(&entry.caller) == caller)
    }

    /// Queue `line` for every client that `who` lets hear it; drop the ones whose queue is full or
    /// whose writer ended.
    fn broadcast(&self, line: &Line, who: &Hears) {
        self.lock().retain(|entry| {
            let heard = match who {
                Hears::Everyone => true,
                Hears::Named(to) => to.contains(&name(&entry.caller)),
                Hears::Nobody => false,
            };
            if !heard {
                return true;
            }
            match entry.queue.try_send(Arc::clone(line)) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                    let _ = entry.stream.shutdown(Shutdown::Both);
                    false
                }
            }
        });
    }

    /// End every connection (the listener is going away).
    pub(crate) fn close_all(&self) {
        for entry in self.lock().drain(..) {
            let _ = entry.stream.shutdown(Shutdown::Both);
        }
    }

    fn lock(&self) -> MutexGuard<'_, Vec<Entry>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Copy every core event to the clients that may hear it until `stop` is set (checked at each event).
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
                let who = hears(&delivery);
                if matches!(who, Hears::Nobody) {
                    continue;
                }
                if let Some(line) = wire::event_line(&delivery.event) {
                    clients.broadcast(&Line::from(line), &who);
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
                    read(reader, &core, &queue, &caller);
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
fn read(stream: UnixStream, core: &Core, queue: &SyncSender<Line>, shared: &Caller) {
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
            Some(Asked::Bridge(request)) => core.handle(&caller, *request),
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
