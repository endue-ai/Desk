//! What a session's handle and its task share (`session.rs`, `task.rs`): the state `db.list`
//! shows, a cancel the call that runs has had, and how the task is told to stop.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use tokio::sync::Notify;

use crate::page::Transaction;
use crate::session::CloseReason;

/// What the handle and the task share: the state `db.list` shows and how the task is stopped.
#[derive(Default)]
pub(crate) struct Shared {
    pub(crate) running: AtomicBool,
    /// A cancel came for the call that runs (a script stops before its next statement).
    pub(crate) cancelled: AtomicBool,
    /// A result has pages left, or a COPY FROM STDIN waits for data.
    pub(crate) open: AtomicBool,
    pub(crate) transaction: AtomicU8,
    pub(crate) closed: AtomicBool,
    pub(crate) stopping: AtomicBool,
    pub(crate) why: Mutex<Option<CloseReason>>,
    pub(crate) stop: Notify,
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
