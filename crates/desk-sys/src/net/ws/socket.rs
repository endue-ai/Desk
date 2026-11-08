//! An open WebSocket. Its thread reads with a short timeout and lets go of the socket between reads,
//! so `send` and `close` from other threads get it within one poll.

use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant};

use tungstenite::protocol::CloseFrame;
use tungstenite::protocol::frame::coding::CloseCode;

use super::{Event, Message};
use crate::net::MAX_BODY_BYTES;
use crate::net::tunnel::{self, Conn};
use crate::{Error, ErrorCode};

/// How long the reading thread holds the socket waiting for a frame.
const POLL: Duration = Duration::from_millis(20);
/// How long a close waits for the other side's answer before the socket is shut.
const CLOSE_WAIT: Duration = Duration::from_secs(1);
/// How long one write may block on a server that stopped reading; then the socket fails.
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

/// An open socket. Dropping it closes it with 1001 (going away).
pub struct Socket {
    protocol: Option<String>,
    shared: Arc<Shared>,
}

struct Shared {
    socket: Mutex<tungstenite::WebSocket<Conn>>,
    /// The socket under the connection, to shut it down whatever holds the lock.
    tcp: TcpStream,
    /// Threads waiting for the socket: the reading thread lets them in first.
    waiting: AtomicUsize,
    /// When a close frame was sent or received.
    closing: Mutex<Option<Instant>>,
    ended: AtomicBool,
    done: (Mutex<bool>, Condvar),
    /// The reading thread, which `close` must not wait for from inside `on_event`.
    reader: OnceLock<ThreadId>,
}

impl Socket {
    /// Start the reading thread on a socket that has finished its handshake.
    pub(super) fn start(
        socket: tungstenite::WebSocket<Conn>,
        protocol: Option<String>,
        on_event: impl FnMut(Event) + Send + 'static,
    ) -> Result<Self, Error> {
        let tcp = socket.get_ref().tcp();
        let set = tcp
            .set_read_timeout(Some(POLL))
            .and_then(|()| tcp.set_write_timeout(Some(WRITE_TIMEOUT)))
            .and_then(|()| tcp.try_clone());
        let tcp = set.map_err(|err| Error::io(&err, "the WebSocket"))?;
        let shared = Arc::new(Shared {
            socket: Mutex::new(socket),
            tcp,
            waiting: AtomicUsize::new(0),
            closing: Mutex::new(None),
            ended: AtomicBool::new(false),
            done: (Mutex::new(false), Condvar::new()),
            reader: OnceLock::new(),
        });
        let reading = shared.clone();
        thread::spawn(move || reading.read(on_event));
        Ok(Self { protocol, shared })
    }

    /// The subprotocol the server chose, if any.
    pub fn protocol(&self) -> Option<&str> {
        self.protocol.as_deref()
    }

    /// Send one message. After the socket has ended it is `io_error`.
    pub fn send(&self, message: Message) -> Result<(), Error> {
        let frame = match message {
            Message::Text(text) => tungstenite::Message::text(text),
            Message::Binary(bytes) => tungstenite::Message::binary(bytes),
        };
        if frame.len() as u64 > MAX_BODY_BYTES {
            return Err(Error::new(
                ErrorCode::InvalidParams,
                format!("a message over {MAX_BODY_BYTES} bytes"),
            ));
        }
        if self.shared.ended.load(Ordering::SeqCst) {
            return Err(closed());
        }
        let mut socket = self.shared.lock();
        socket.send(frame).map_err(|err| match err {
            tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed => closed(),
            err => Error::new(ErrorCode::IoError, format!("the WebSocket: {err}")),
        })
    }

    /// Close with `code` (1000, or 3000 to 4999) and `reason` (at most 123 bytes), and wait at most
    /// a second for the server's answer before the socket is shut. Closing an ended socket does
    /// nothing.
    pub fn close(&self, code: u16, reason: &str) -> Result<(), Error> {
        if !(code == 1000 || (3000..=4999).contains(&code)) || reason.len() > 123 {
            return Err(Error::new(
                ErrorCode::InvalidParams,
                format!("close code {code} or reason {reason:?} is not one a client may send"),
            ));
        }
        self.shared.begin_close(code, reason);
        if self.shared.reader.get() != Some(&thread::current().id()) {
            self.shared.wait(CLOSE_WAIT + POLL * 4);
        }
        Ok(())
    }
}

impl Drop for Socket {
    fn drop(&mut self) {
        self.shared.begin_close(1001, "");
    }
}

impl Shared {
    /// The socket, ahead of the reading thread.
    fn lock(&self) -> MutexGuard<'_, tungstenite::WebSocket<Conn>> {
        self.waiting.fetch_add(1, Ordering::SeqCst);
        let socket = self.socket.lock().unwrap_or_else(PoisonError::into_inner);
        self.waiting.fetch_sub(1, Ordering::SeqCst);
        socket
    }

    fn begin_close(&self, code: u16, reason: &str) {
        if self.ended.load(Ordering::SeqCst) {
            return;
        }
        let frame = CloseFrame {
            code: CloseCode::from(code),
            reason: reason.into(),
        };
        let _ = self.lock().close(Some(frame));
        self.closing_now();
    }

    fn closing_now(&self) {
        let mut closing = self.closing.lock().unwrap_or_else(PoisonError::into_inner);
        closing.get_or_insert_with(Instant::now);
    }

    fn close_overdue(&self) -> bool {
        let closing = self.closing.lock().unwrap_or_else(PoisonError::into_inner);
        closing.is_some_and(|since| since.elapsed() >= CLOSE_WAIT)
    }

    /// The reading thread: messages until the end, then `Closed`.
    fn read(&self, mut on_event: impl FnMut(Event)) {
        let _ = self.reader.set(thread::current().id());
        let mut frame: Option<(u16, String)> = None;
        let (code, reason) = loop {
            while self.waiting.load(Ordering::SeqCst) > 0 {
                thread::sleep(Duration::from_millis(1));
            }
            if self.close_overdue() {
                break frame
                    .take()
                    .unwrap_or((1006, "no answer to the close".to_owned()));
            }
            let result = self
                .socket
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .read();
            match result {
                Ok(tungstenite::Message::Text(text)) => {
                    on_event(Event::Message(Message::Text(text.as_str().to_owned())));
                }
                Ok(tungstenite::Message::Binary(bytes)) => {
                    on_event(Event::Message(Message::Binary(bytes.to_vec())));
                }
                Ok(tungstenite::Message::Close(close)) => {
                    frame = Some(match close {
                        Some(close) => (u16::from(close.code), close.reason.as_str().to_owned()),
                        None => (1005, String::new()),
                    });
                    self.closing_now();
                }
                Ok(_) => {}
                Err(tungstenite::Error::Io(err))
                    if matches!(
                        err.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                    break frame
                        .take()
                        .unwrap_or((1006, "the connection ended".to_owned()));
                }
                Err(err) => break frame.take().unwrap_or((1006, err.to_string())),
            }
        };
        self.ended.store(true, Ordering::SeqCst);
        tunnel::shutdown(&self.tcp);
        on_event(Event::Closed { code, reason });
        drop(on_event);
        let (done, ended) = &self.done;
        *done.lock().unwrap_or_else(PoisonError::into_inner) = true;
        ended.notify_all();
    }

    /// Wait at most `limit` for the reading thread to end.
    fn wait(&self, limit: Duration) {
        let (done, ended) = &self.done;
        let done = done.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = ended
            .wait_timeout_while(done, limit, |done| !*done)
            .unwrap_or_else(PoisonError::into_inner);
    }
}

fn closed() -> Error {
    Error::new(ErrorCode::IoError, "the WebSocket is closed")
}
