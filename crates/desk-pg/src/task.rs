//! One session's task on the runtime thread: it owns the connection, answers the handle's calls
//! one at a time, reads the server while idle (notifications, parameters, a FATAL before the server
//! closes) and stops when told to. Its last act is the `Closed` event, after the state says closed.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use postgres_protocol::message::backend::Message;
use tokio::sync::Notify;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::cancel;
use crate::conn::{Conn, Read};
use crate::error::{Error, ServerError, protocol};
use crate::page::{Limits, Page, Row, Transaction};
use crate::select::{Either, select};
use crate::session::{CloseReason, CopyInput, Event, Sink, Statement};

/// What the handle and the task share: the state `db.list` shows and how the task is stopped.
#[derive(Default)]
pub(crate) struct Shared {
    pub(crate) running: AtomicBool,
    /// A result has pages left, or a COPY FROM STDIN waits for data.
    pub(crate) open: AtomicBool,
    transaction: AtomicU8,
    closed: AtomicBool,
    stopping: AtomicBool,
    why: Mutex<Option<CloseReason>>,
    stop: Notify,
}

impl Shared {
    pub(crate) fn transaction(&self) -> Transaction {
        Transaction::of(self.transaction.load(Ordering::SeqCst))
    }

    pub(crate) fn set_transaction(&self, status: u8) {
        self.transaction.store(status, Ordering::SeqCst);
    }

    pub(crate) fn closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Stop the task; the first reason given is the one its `Closed` event names.
    pub(crate) fn stop(&self, reason: CloseReason) {
        let mut why = self.why.lock().unwrap_or_else(|p| p.into_inner());
        why.get_or_insert(reason);
        self.stopping.store(true, Ordering::SeqCst);
        self.stop.notify_one();
    }
}

pub(crate) type Reply = std::sync::mpsc::SyncSender<Result<Page, Error>>;

pub(crate) enum Command {
    Run(Statement, Limits, Reply),
    Fetch(Limits, bool, Reply),
    Copy(CopyInput, Reply),
}

/// Why the connection is done.
pub(crate) enum End {
    /// Told to stop (`Session::close`), or the handle went away.
    Stopped,
    /// The server closed the connection.
    Server,
    Io(String),
    /// The server's client_encoding is no longer UTF-8.
    Encoding,
}

/// A call's failure: its own (the session goes on), or the connection's.
pub(crate) enum Fail {
    Call(Error),
    End(End),
}

impl From<Error> for Fail {
    fn from(error: Error) -> Fail {
        Fail::End(match error {
            Error::Closed => End::Server,
            other => End::Io(other.to_string()),
        })
    }
}

/// What a statement has open between calls.
pub(crate) enum Open {
    None,
    /// Rows of the unnamed portal: `suspended` when the last Execute ended in PortalSuspended and
    /// was read to its end; `held` the row read past the last page.
    Rows {
        suspended: bool,
        held: Option<(Row, usize)>,
        total: u64,
        described: bool,
    },
    CopyOut {
        held: Option<Vec<u8>>,
    },
    CopyIn,
}

pub(crate) struct Task {
    pub(crate) conn: Conn,
    commands: UnboundedReceiver<Command>,
    pub(crate) shared: Arc<Shared>,
    sink: Sink,
    pub(crate) cancel: cancel::Target,
    pub(crate) open: Open,
    /// A FATAL error the server sent before it closed.
    fatal: Option<ServerError>,
    /// A message over the limit was skipped: the result it belongs to cannot be answered whole.
    pub(crate) too_large: bool,
    encoding: bool,
}

impl Task {
    pub(crate) fn new(
        conn: Conn,
        commands: UnboundedReceiver<Command>,
        shared: Arc<Shared>,
        sink: Sink,
        cancel: cancel::Target,
    ) -> Task {
        Task {
            conn,
            commands,
            shared,
            sink,
            cancel,
            open: Open::None,
            fatal: None,
            too_large: false,
            encoding: false,
        }
    }

    pub(crate) async fn run(mut self) {
        let end = loop {
            match self.idle().await {
                Ok(command) => {
                    if let Err(end) = self.serve(command).await {
                        break end;
                    }
                    if self.encoding {
                        break End::Encoding;
                    }
                }
                Err(end) => break end,
            }
        };
        self.finish(end).await;
    }

    /// Wait for the next call; meanwhile, with no result open, read what the server sends.
    async fn idle(&mut self) -> Result<Command, End> {
        loop {
            if self.shared.stopping.load(Ordering::SeqCst) {
                return Err(End::Stopped);
            }
            let shared = self.shared.clone();
            let reading = matches!(self.open, Open::None);
            let calls = self.commands.recv();
            let waited = if reading {
                match select(select(self.conn.recv(), calls), shared.stop.notified()).await {
                    Either::Left(Either::Left(read)) => Either::Left(read),
                    Either::Left(Either::Right(call)) => Either::Right(Some(call)),
                    Either::Right(()) => Either::Right(None),
                }
            } else {
                match select(calls, shared.stop.notified()).await {
                    Either::Left(call) => Either::Right(Some(call)),
                    Either::Right(()) => Either::Right(None),
                }
            };
            match waited {
                Either::Right(Some(Some(command))) => return Ok(command),
                Either::Right(_) => return Err(End::Stopped),
                Either::Left(Err(Error::Closed)) => return Err(End::Server),
                Either::Left(Err(error)) => return Err(End::Io(error.to_string())),
                Either::Left(Ok(Read::Skipped(..))) => {}
                Either::Left(Ok(Read::Message(message))) => match self.absorb(message) {
                    None => {}
                    Some(Message::ErrorResponse(_)) => {}
                    Some(_) => return Err(End::Io("the server sent a result unasked".to_owned())),
                },
            }
        }
    }

    async fn serve(&mut self, command: Command) -> Result<(), End> {
        let (reply, outcome) = match command {
            Command::Run(statement, limits, reply) => {
                (reply, self.run_statement(statement, limits).await)
            }
            Command::Fetch(limits, close, reply) => (reply, self.fetch(limits, close).await),
            Command::Copy(input, reply) => (reply, self.copy(input).await),
        };
        let open = !matches!(self.open, Open::None);
        self.shared.open.store(open, Ordering::SeqCst);
        match outcome {
            Ok(page) => {
                let _ = reply.send(Ok(page));
                Ok(())
            }
            Err(Fail::Call(error)) => {
                let _ = reply.send(Err(error));
                Ok(())
            }
            Err(Fail::End(end)) => {
                // A statement the server ended the session over answers with the server's error.
                let answer = match (&end, &self.fatal) {
                    (End::Server, Some(fatal)) => Ok(Page {
                        error: Some(fatal.clone()),
                        ..Page::default()
                    }),
                    (End::Io(why), _) => Err(Error::Io(why.clone())),
                    _ => Err(Error::Closed),
                };
                let _ = reply.send(answer);
                Err(end)
            }
        }
    }

    /// The next message that answers what was sent: notices, notifications and parameters go to
    /// the sink as they come; a stop ends the wait.
    pub(crate) async fn next(&mut self) -> Result<Message, Fail> {
        loop {
            if self.shared.stopping.load(Ordering::SeqCst) {
                return Err(Fail::End(End::Stopped));
            }
            let shared = self.shared.clone();
            let read = match select(self.conn.recv(), shared.stop.notified()).await {
                Either::Left(read) => read?,
                Either::Right(()) => return Err(Fail::End(End::Stopped)),
            };
            match read {
                Read::Skipped(..) => self.too_large = true,
                Read::Message(message) => {
                    if let Some(message) = self.absorb(message) {
                        return Ok(message);
                    }
                }
            }
        }
    }

    /// Send what the connection's buffer holds, unless the session is told to stop first.
    pub(crate) async fn send(&mut self) -> Result<(), Fail> {
        let shared = self.shared.clone();
        match select(self.conn.send(), shared.stop.notified()).await {
            Either::Left(sent) => Ok(sent?),
            Either::Right(()) => Err(Fail::End(End::Stopped)),
        }
    }

    /// Hand what arrives unasked to the sink; answer everything else. A FATAL error is kept for
    /// the `Closed` event and still answered.
    fn absorb(&mut self, message: Message) -> Option<Message> {
        let text = |r: std::io::Result<&str>| r.map(str::to_owned).unwrap_or_default();
        match message {
            Message::NoticeResponse(body) => {
                (self.sink)(Event::Notice(ServerError::read(body.fields())))
            }
            Message::NotificationResponse(body) => (self.sink)(Event::Notification {
                pid: body.process_id(),
                channel: text(body.channel()),
                payload: text(body.message()),
            }),
            Message::ParameterStatus(body) => {
                let (name, value) = (text(body.name()), text(body.value()));
                if name == "client_encoding" && !value.eq_ignore_ascii_case("UTF8") {
                    self.encoding = true;
                }
                (self.sink)(Event::Parameter { name, value });
            }
            Message::ErrorResponse(body) => {
                let error = ServerError::read(body.fields());
                if error.is_fatal() {
                    self.fatal = Some(error);
                }
                return Some(Message::ErrorResponse(body));
            }
            other => return Some(other),
        }
        None
    }

    /// Sync, then everything up to ReadyForQuery: the transaction state it reports.
    pub(crate) async fn sync(&mut self) -> Result<Transaction, Fail> {
        postgres_protocol::message::frontend::sync(&mut self.conn.out);
        self.send().await?;
        loop {
            if let Message::ReadyForQuery(body) = self.next().await? {
                self.shared.set_transaction(body.status());
                return Ok(Transaction::of(body.status()));
            }
        }
    }

    /// A cancel request for what this session runs (closing a COPY out early).
    pub(crate) async fn cancel_self(&mut self) {
        let _ = tokio::time::timeout(Duration::from_secs(10), cancel::send(&self.cancel)).await;
    }

    async fn finish(mut self, end: End) {
        let why = *self.shared.why.lock().unwrap_or_else(|p| p.into_inner());
        let (reason, error, message) = match end {
            End::Stopped => (why.unwrap_or(CloseReason::Desk), None, None),
            End::Server => (why.unwrap_or(CloseReason::Server), self.fatal.take(), None),
            End::Io(message) => (why.unwrap_or(CloseReason::Io), None, Some(message)),
            End::Encoding => {
                let message = "the server's client_encoding is no longer UTF8".to_owned();
                (CloseReason::Encoding, None, Some(message))
            }
        };
        if matches!(reason, CloseReason::Server | CloseReason::Io) {
            drop(self.conn);
        } else {
            let _ = tokio::time::timeout(Duration::from_secs(2), self.conn.terminate()).await;
        }
        self.shared.open.store(false, Ordering::SeqCst);
        self.shared.closed.store(true, Ordering::SeqCst);
        let error = error.filter(|_| reason == CloseReason::Server);
        (self.sink)(Event::Closed {
            reason,
            message,
            error,
        });
    }
}

/// What an unexpected message is, for a protocol failure.
pub(crate) fn unexpected(message: &Message, during: &str) -> Fail {
    let name = match message {
        Message::DataRow(_) => "a row",
        Message::CopyData(_) => "COPY data",
        Message::ReadyForQuery(_) => "ReadyForQuery",
        _ => "a message",
    };
    Fail::from(protocol(format!("{name} during {during}")))
}
