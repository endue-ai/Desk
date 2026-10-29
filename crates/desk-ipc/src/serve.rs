//! Serving connections: a reader and a writer thread per connection, and one fan-out thread that
//! copies every core event to every connection. The desk never waits on a client: each connection
//! has a queue of [`QUEUE`] lines, and a client that lets it fill is dropped.

use std::io::{BufRead, BufReader, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::{io, thread};

use desk_bridge::BridgeEvent;
use desk_core::Core;

use crate::{CALLER, wire};

/// Lines that may wait for one client before it is dropped.
pub(crate) const QUEUE: usize = 1000;

type Line = Arc<str>;

struct Entry {
    id: u64,
    queue: SyncSender<Line>,
    stream: UnixStream,
}

/// The connections the fan-out thread writes to.
#[derive(Clone, Default)]
pub(crate) struct Clients(Arc<Mutex<Vec<Entry>>>);

impl Clients {
    fn add(&self, entry: Entry) {
        self.lock().push(entry);
    }

    fn remove(&self, id: u64) {
        self.lock().retain(|entry| entry.id != id);
    }

    /// Queue `line` for every client; drop the ones whose queue is full or whose writer ended.
    fn broadcast(&self, line: &Line) {
        self.lock()
            .retain(|entry| match entry.queue.try_send(Arc::clone(line)) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                    let _ = entry.stream.shutdown(Shutdown::Both);
                    false
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

/// Copy every core event to every client until `stop` is set (checked at each event).
pub(crate) fn fan_out(
    events: Receiver<BridgeEvent>,
    clients: Clients,
    stop: Arc<AtomicBool>,
) -> io::Result<()> {
    thread::Builder::new()
        .name("desk-ipc-events".to_owned())
        .spawn(move || {
            for event in events {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                if let Some(line) = wire::event_line(&event) {
                    clients.broadcast(&Line::from(line));
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
    clients.add(Entry {
        id,
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
                    read(reader, &core, &queue);
                    clients.remove(id);
                })
        });
    if let Err(why) = spawned {
        clients.remove(id);
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

/// Answer each line through `Core::handle` as [`CALLER`] until the client hangs up.
fn read(stream: UnixStream, core: &Core, queue: &SyncSender<Line>) {
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let answer = match wire::request(&line) {
            None => continue,
            Some(Ok(request)) => core.handle(CALLER, request),
            Some(Err(invalid)) => invalid,
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
