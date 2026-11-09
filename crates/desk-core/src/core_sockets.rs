//! The socket side of `Core`: net.connect, net.send and net.close, with `net.data` and `net.closed`
//! events for the caller that opened the socket (ADR 0133). A socket belongs to its caller: another
//! caller's id is `not_found`, and the socket closes when the caller unloads or its grants no longer
//! cover the host and port, as a process ends. One reader thread per socket sends what arrives, up
//! to 64 KiB an event, then `net.closed` once the entry has left the table.

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::thread;
use std::time::Duration;

use base64::Engine as _;
use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, NetCloseParams, NetCloseResult, NetClosedData,
    NetClosedEvent, NetConnectParams, NetConnectResult, NetDataData, NetDataEvent, NetSendParams,
    NetSendResult, Permission,
};

use crate::events::EventBus;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// How many sockets one caller holds at once.
pub(crate) const MAX_SOCKETS: usize = 8;
/// How long net.connect waits by default.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// The most bytes one `net.data` event carries.
const CHUNK: usize = 64 * 1024;

struct SocketEntry {
    caller: String,
    scope: Permission,
    host: String,
    port: u16,
    stream: Arc<TcpStream>,
    /// Why the desk closed it, for `net.closed`; empty while it is open or the other end closed it.
    why: Arc<Mutex<Option<String>>>,
}

impl SocketEntry {
    /// End the connection: the reader wakes, reports `net.closed` with `why` and stops.
    fn close(&self, why: &str) {
        lock_why(&self.why).get_or_insert_with(|| why.to_owned());
        let _ = self.stream.shutdown(Shutdown::Both);
    }
}

impl Drop for SocketEntry {
    /// A socket the table lets go of (the core stops) ends too, so no reader waits forever.
    fn drop(&mut self) {
        self.close("the desk stopped");
    }
}

/// The sockets callers opened, by id. Shared with each socket's reader, which removes the entry
/// once the connection has ended.
#[derive(Default)]
pub(crate) struct Sockets {
    next: u64,
    entries: BTreeMap<String, SocketEntry>,
}

impl Core {
    pub(crate) fn net_connect(&self, caller: &str, params: NetConnectParams) -> Answer {
        let port = u16::try_from(params.port)
            .map_err(|_| error(ErrorCode::InvalidParams, "a port is 1 to 65535".to_owned()))?;
        let scope = Permission::NetConnect(params.scope);
        let target = Target::Endpoint {
            host: &params.host,
            port,
        };
        self.check(caller, &scope, &target)?;
        let held = lock(&self.sockets)
            .entries
            .values()
            .filter(|entry| entry.caller == caller)
            .count();
        if held >= MAX_SOCKETS {
            return Err(error(
                ErrorCode::InvalidValue,
                format!("{caller} already holds {MAX_SOCKETS} sockets"),
            ));
        }
        let timeout = params
            .timeout_ms
            .map_or(CONNECT_TIMEOUT, Duration::from_millis);
        let stream = connect(&params.host, port, timeout)?;
        let _ = stream.set_nodelay(true);
        let reading = stream
            .try_clone()
            .map_err(|e| error(ErrorCode::IoError, e.to_string()))?;
        let why = Arc::new(Mutex::new(None));
        // The table stays locked until the entry is stored, so a reader that ends at once still finds
        // the entry it removes.
        let mut sockets = lock(&self.sockets);
        sockets.next += 1;
        let socket_id = format!("s-{}", sockets.next);
        let reader = Reader {
            socket_id: socket_id.clone(),
            to: vec![caller.to_owned()],
            events: self.events().clone(),
            sockets: Arc::downgrade(&self.sockets),
            why: why.clone(),
        };
        thread::Builder::new()
            .name(format!("desk-socket-{socket_id}"))
            .spawn(move || reader.run(reading))
            .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
        sockets.entries.insert(
            socket_id.clone(),
            SocketEntry {
                caller: caller.to_owned(),
                scope,
                host: params.host,
                port,
                stream: Arc::new(stream),
                why,
            },
        );
        drop(sockets);
        json(NetConnectResult { socket_id })
    }

    pub(crate) fn net_send(&self, caller: &str, params: NetSendParams) -> Answer {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(params.data)
            .map_err(|e| error(ErrorCode::InvalidParams, format!("not base64: {e}")))?;
        // Written outside the table's lock: a slow peer holds up only this socket.
        let stream = self.socket(caller, &params.socket_id)?;
        (&*stream)
            .write_all(&bytes)
            .map_err(|e| error(ErrorCode::IoError, e.to_string()))?;
        json(NetSendResult {})
    }

    pub(crate) fn net_close(&self, caller: &str, params: NetCloseParams) -> Answer {
        let mut sockets = lock(&self.sockets);
        let owned = sockets
            .entries
            .get(&params.socket_id)
            .is_some_and(|entry| entry.caller == caller);
        if let Some(entry) = owned
            .then(|| sockets.entries.remove(&params.socket_id))
            .flatten()
        {
            entry.close("closed by the caller");
        }
        json(NetCloseResult {})
    }

    fn socket(&self, caller: &str, id: &str) -> Result<Arc<TcpStream>, BridgeError> {
        lock(&self.sockets)
            .entries
            .get(id)
            .filter(|entry| entry.caller == caller)
            .map(|entry| entry.stream.clone())
            .ok_or_else(|| error(ErrorCode::NotFound, format!("{caller} has no socket {id}")))
    }

    /// The caller unloaded: its sockets close.
    pub(crate) fn drop_sockets(&self, caller: &str) {
        let ended = take(&mut lock(&self.sockets), |entry| entry.caller == caller);
        for entry in &ended {
            entry.close("the plugin stopped");
        }
    }

    /// Close the caller's sockets that its grants no longer cover.
    pub(crate) fn prune_sockets(&self, caller: &str) {
        let ended = {
            let mut sockets = lock(&self.sockets);
            let permissions = self.permissions();
            take(&mut sockets, |entry| {
                let target = Target::Endpoint {
                    host: &entry.host,
                    port: entry.port,
                };
                entry.caller == caller
                    && permissions
                        .authorize(caller, &entry.scope, &target)
                        .is_err()
            })
        };
        for entry in &ended {
            entry.close("the permission was revoked");
        }
    }

    /// How many sockets are open, for tests and diagnostics.
    pub fn socket_count(&self) -> usize {
        lock(&self.sockets).entries.len()
    }
}

/// Every address `host` resolves to, tried in turn within `timeout` each.
fn connect(host: &str, port: u16, timeout: Duration) -> Result<TcpStream, BridgeError> {
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| error(ErrorCode::IoError, format!("cannot resolve {host}: {e}")))?
        .collect();
    let mut last = io::Error::new(io::ErrorKind::NotFound, format!("{host} has no address"));
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => return Ok(stream),
            Err(e) => last = e,
        }
    }
    let code = match last.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => ErrorCode::Timeout,
        _ => ErrorCode::IoError,
    };
    Err(error(
        code,
        format!("cannot connect to {host}:{port}: {last}"),
    ))
}

/// Remove the entries `ends` picks and hand them back, to be closed once the table is unlocked.
fn take(sockets: &mut Sockets, ends: impl Fn(&SocketEntry) -> bool) -> Vec<SocketEntry> {
    let ids: Vec<String> = sockets
        .entries
        .iter()
        .filter(|(_, entry)| ends(entry))
        .map(|(id, _)| id.clone())
        .collect();
    ids.iter()
        .filter_map(|id| sockets.entries.remove(id))
        .collect()
}

/// One socket's reader: its bytes as `net.data` for the caller, then `net.closed`.
struct Reader {
    socket_id: String,
    to: Vec<String>,
    events: EventBus,
    sockets: Weak<Mutex<Sockets>>,
    why: Arc<Mutex<Option<String>>>,
}

impl Reader {
    fn run(self, mut stream: TcpStream) {
        let mut buffer = vec![0u8; CHUNK];
        let failed = loop {
            match stream.read(&mut buffer) {
                Ok(0) => break None,
                Ok(n) => self.send(&buffer[..n]),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => break Some(e.to_string()),
            }
        };
        // Why the desk closed it, read before the entry goes: dropping the entry closes it again.
        let reason = lock_why(&self.why).take().or(failed);
        if let Some(sockets) = self.sockets.upgrade() {
            let entry = lock(&sockets).entries.remove(&self.socket_id);
            // Dropped outside the table's lock; its close only shuts what has already ended.
            drop(entry);
        }
        self.events.publish_to(
            self.to.clone(),
            BridgeEvent::NetClosed(NetClosedEvent {
                event: Default::default(),
                data: NetClosedData {
                    socket_id: self.socket_id.clone(),
                    reason,
                },
            }),
        );
    }

    fn send(&self, bytes: &[u8]) {
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        self.events.publish_to(
            self.to.clone(),
            BridgeEvent::NetData(NetDataEvent {
                event: Default::default(),
                data: NetDataData {
                    socket_id: self.socket_id.clone(),
                    data,
                },
            }),
        );
    }
}

pub(crate) fn lock(sockets: &Mutex<Sockets>) -> MutexGuard<'_, Sockets> {
    sockets
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_why(why: &Mutex<Option<String>>) -> MutexGuard<'_, Option<String>> {
    why.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
