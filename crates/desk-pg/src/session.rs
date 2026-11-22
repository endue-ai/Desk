//! The session as its owner holds it: `open` signs in and hands back a `Session` whose calls block
//! the calling thread until the server answers, while every session's task runs on one runtime
//! thread (`desk-pg`). What arrives unasked goes to the session's `Sink`, `Closed` last.

use std::sync::atomic::Ordering;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;

use tokio::runtime::Handle;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use crate::cancel;
use crate::config::Config;
use crate::conn::{Conn, TlsInfo};
use crate::error::{Error, ServerError};
use crate::page::{Limits, Page, Transaction};
use crate::script::Script;
use crate::shared::Shared;
use crate::signin::{Auth, sign_in};
use crate::task::{Command, Task};

/// What a session reports without being asked.
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// A notice outside any call: with the sign-in, or while the session is idle.
    Notice(ServerError),
    /// A notice a call heard, sent as it arrives; that call's page (its `call`) carries it too.
    CallNotice {
        call: u64,
        notice: ServerError,
    },
    Notification {
        pid: i32,
        channel: String,
        payload: String,
    },
    Parameter {
        name: String,
        value: String,
    },
    /// The session's last event.
    Closed {
        reason: CloseReason,
        message: Option<String>,
        /// The server's FATAL error, when it sent one before it closed.
        error: Option<ServerError>,
    },
}

/// Why a session ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    /// Its owner closed it.
    Closed,
    /// The server ended it.
    Server,
    /// The network failed.
    Io,
    /// The server's client_encoding stopped being UTF-8.
    Encoding,
    /// Its owner stopped.
    Unloaded,
    /// Its owner's grant went.
    Revoked,
    /// The desk let it go (it stops).
    Desk,
}

/// Where a session's events go: called on the runtime thread, so it must not wait on a session.
pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;

/// One statement and its text parameters; `types` are their type OIDs (0 or absent: the server's
/// inference).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Statement {
    pub sql: String,
    pub params: Vec<Option<String>>,
    pub types: Vec<u32>,
}

/// One `COPY ... FROM STDIN` call: a chunk, and the end.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CopyInput {
    pub data: Option<Vec<u8>>,
    pub done: bool,
    pub fail: Option<String>,
}

/// A session signed in, with what the sign-in learnt.
pub struct Opened {
    pub session: Session,
    pub pid: i32,
    pub auth: Auth,
    pub tls: Option<TlsInfo>,
    pub parameters: Vec<(String, String)>,
}

/// Sign in with `config`; the session's events go to `sink`. Blocks until the server answers or
/// the config's timeout runs out.
pub fn open(config: Config, sink: Sink) -> Result<Opened, Error> {
    config.check()?;
    let (reply, answer) = sync_channel(1);
    runtime()?.spawn(async move {
        let connected = tokio::time::timeout(config.timeout, async {
            let mut conn = Conn::open(&config).await?;
            let signed = sign_in(&mut conn, &config).await?;
            Ok::<_, Error>((conn, signed))
        })
        .await;
        let (conn, signed) = match connected {
            Ok(Ok(done)) => done,
            Ok(Err(error)) => {
                let _ = reply.send(Err(error));
                return;
            }
            Err(_) => {
                let _ = reply.send(Err(Error::Timeout));
                return;
            }
        };
        let target = cancel::Target::new(&config, signed.pid, signed.key);
        drop(config);
        let (commands, receiver) = unbounded_channel();
        let shared = Arc::new(Shared::default());
        let session = Session {
            commands,
            shared: shared.clone(),
            cancel: target.clone(),
        };
        let opened = Opened {
            session,
            pid: signed.pid,
            auth: signed.auth,
            tls: conn.tls.clone(),
            parameters: signed.parameters,
        };
        if reply.send(Ok(opened)).is_err() {
            return;
        }
        for notice in signed.notices {
            sink(Event::Notice(notice));
        }
        Task::new(conn, receiver, shared, sink, target).run().await;
    });
    answer.recv().unwrap_or_else(|_| Err(gone()))
}

/// A signed-in session. Dropping it ends the session (`CloseReason::Desk`).
pub struct Session {
    commands: UnboundedSender<Command>,
    shared: Arc<Shared>,
    cancel: cancel::Target,
}

impl Session {
    /// Run one statement and answer its first page.
    pub fn run(&self, statement: Statement, limits: Limits) -> Result<Page, Error> {
        self.call(|reply| Command::Run(statement, limits, reply))
    }

    /// Run `statements` in order, each as `run` runs one, and answer each one's first page: it
    /// stops after a page with `more`, at the first error unless `go_on`, and at a cancel (ADR 0344).
    pub fn script(
        &self,
        statements: Vec<Statement>,
        limits: Limits,
        go_on: bool,
    ) -> Result<Script, Error> {
        self.call(|reply| Command::Script(statements, limits, go_on, reply))
    }

    /// What `statement` takes and answers, without running it: Parse and Describe (ADR 0353).
    pub fn describe(&self, statement: Statement) -> Result<crate::describe::Described, Error> {
        self.call(|reply| Command::Describe(statement, reply))
    }

    /// The next page of the open result; with `close`, end it without reading on.
    pub fn fetch(&self, limits: Limits, close: bool) -> Result<Page, Error> {
        self.call(|reply| Command::Fetch(limits, close, reply))
    }

    /// A chunk for the open COPY FROM STDIN, or its end.
    pub fn copy(&self, input: CopyInput) -> Result<Page, Error> {
        self.call(|reply| Command::Copy(input, reply))
    }

    fn call<T>(&self, command: impl FnOnce(crate::task::Reply<T>) -> Command) -> Result<T, Error> {
        if self.shared.closed() {
            return Err(Error::Closed);
        }
        if self.shared.running.swap(true, Ordering::SeqCst) {
            let why = "a statement runs on the session: cancel it or wait for its answer";
            return Err(Error::Invalid(why.to_owned()));
        }
        self.shared.cancelled.store(false, Ordering::SeqCst);
        let (reply, answer) = sync_channel(1);
        let answered = match self.commands.send(command(reply)) {
            Ok(()) => answer.recv().unwrap_or(Err(Error::Closed)),
            Err(_) => Err(Error::Closed),
        };
        self.shared.running.store(false, Ordering::SeqCst);
        answered
    }

    /// Ask the server to cancel what runs; nothing when nothing runs. Waits until the request
    /// is sent; the statement's answer then carries 57014.
    pub fn cancel(&self) -> Result<(), Error> {
        if !self.running() || self.closed() {
            return Ok(());
        }
        // A script stops before its next statement, which the server's cancel would miss.
        self.shared.cancelled.store(true, Ordering::SeqCst);
        let target = self.cancel.clone();
        let (reply, answer) = sync_channel(1);
        runtime()?.spawn(async move {
            let sent = tokio::time::timeout(Duration::from_secs(10), cancel::send(&target)).await;
            let _ = reply.send(sent.unwrap_or(Err(Error::Timeout)));
        });
        answer.recv().unwrap_or_else(|_| Err(gone()))
    }

    /// End the session; its `Closed` event names `reason` (the first one given).
    pub fn close(&self, reason: CloseReason) {
        self.shared.stop(reason);
    }

    pub fn running(&self) -> bool {
        self.shared.running.load(Ordering::SeqCst)
    }

    /// Whether a result has pages left, or a COPY FROM STDIN waits for data.
    pub fn more(&self) -> bool {
        self.shared.open.load(Ordering::SeqCst)
    }

    pub fn transaction(&self) -> Transaction {
        self.shared.transaction()
    }

    pub fn closed(&self) -> bool {
        self.shared.closed()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.shared.stop(CloseReason::Desk);
    }
}

fn gone() -> Error {
    Error::Io("the sessions' runtime stopped".to_owned())
}

/// The one runtime thread every session runs on, started with the first.
fn runtime() -> Result<&'static Handle, Error> {
    static RUNTIME: OnceLock<Result<Handle, String>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_io()
                .enable_time()
                .build()
                .map_err(|e| e.to_string())?;
            let handle = runtime.handle().clone();
            thread::Builder::new()
                .name("desk-pg".to_owned())
                .spawn(move || runtime.block_on(std::future::pending::<()>()))
                .map_err(|e| e.to_string())?;
            Ok(handle)
        })
        .as_ref()
        .map_err(|why| Error::Io(format!("the sessions' runtime: {why}")))
}
