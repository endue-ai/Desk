//! How the desk ends db.* sessions it did not get a db.close for (ADR 0339): a caller that unloads
//! (`unloaded`), grants that no longer cover a session (`revoked`), and the desk's quit (`desk`),
//! which waits a bounded time for every session to be gone. Each end, as db.close's, cancels a
//! statement still running on the server before Terminate (`desk-pg`); a session still signing in
//! is marked and ended by its sign-in.

use std::sync::Arc;
use std::time::{Duration, Instant};

use desk_pg::{CloseReason, Session};

use crate::core_db::{Databases, DbEntry, lock};
use crate::handler::Core;
use crate::perm::Target;

impl Core {
    /// The caller unloaded: its sessions end (`unloaded`).
    pub(crate) fn drop_databases(&self, caller: &str) {
        let ended = take(&mut lock(&self.databases), CloseReason::Unloaded, |entry| {
            entry.caller == caller
        });
        close_all(ended, CloseReason::Unloaded);
    }

    /// End the caller's sessions that its grants no longer cover (`revoked`).
    pub(crate) fn prune_databases(&self, caller: &str) {
        let permissions = self.permissions();
        let lost = |entry: &DbEntry| {
            let target = Target::Endpoint {
                host: &entry.host,
                port: entry.port,
            };
            entry.caller == caller
                && permissions
                    .authorize(caller, &entry.scope, &target)
                    .is_err()
        };
        let ended = take(&mut lock(&self.databases), CloseReason::Revoked, lost);
        drop(permissions);
        close_all(ended, CloseReason::Revoked);
    }

    /// The desk quits: every caller's sessions end (`desk`), a running statement cancelled first.
    /// Waits until they are gone or `wait` runs out, and answers how many were still open then.
    pub fn quit_databases(&self, wait: Duration) -> usize {
        let deadline = Instant::now() + wait;
        let ended = take(&mut lock(&self.databases), CloseReason::Desk, |_| true);
        for session in &ended {
            session.close(CloseReason::Desk);
        }
        loop {
            let open = ended.iter().filter(|session| !session.closed()).count();
            if open == 0 || Instant::now() >= deadline {
                return open;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

/// Take the signed-in sessions `ends` picks out of the table; mark those still signing in.
fn take(
    databases: &mut Databases,
    reason: CloseReason,
    ends: impl Fn(&DbEntry) -> bool,
) -> Vec<Arc<Session>> {
    let mut ended = Vec::new();
    databases.entries.retain(|_, entry| {
        if !ends(entry) {
            return true;
        }
        match entry.session.take() {
            Some(session) => {
                ended.push(session);
                false
            }
            None => {
                entry.ended.get_or_insert(reason);
                true
            }
        }
    });
    ended
}

fn close_all(sessions: Vec<Arc<Session>>, reason: CloseReason) {
    for session in sessions {
        session.close(reason);
    }
}
