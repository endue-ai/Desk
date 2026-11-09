//! Keeping the session alive. Access tokens live 300 s and every `/api/v1/auth/refresh` rotates
//! the `endue_rt` cookie, so one refresh runs at a time (`flight`): a caller that waited for one
//! finds the cookie it saw already rotated and takes the new token. A 400 or 401 means the session
//! is over and the desk is signed out; a 403 means endue refused, and the session is kept with a
//! notice; anything else was retried after 400, 1200 and 3000 ms and keeps the session too. The
//! keeper thread renews `lead` (90 s) before expiry, as the endue.ai web's session keeper does.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

use super::bff::Renewed;
use super::{Account, Problem, Snapshot, State, lock, now, profile};

/// The longest the keeper sleeps while nothing is due.
const IDLE: Duration = Duration::from_secs(600);

/// What a refresh left the caller with.
enum Renewal {
    Fresh(String),
    /// Not renewed; the session stays as it was.
    Kept,
    /// No session any more.
    Gone,
}

/// Wakes the keeper when a sign-in or a sign-out changed what is due.
#[derive(Default)]
pub(super) struct Wake {
    rung: Mutex<bool>,
    bell: Condvar,
}

impl Wake {
    pub fn ring(&self) {
        *lock(&self.rung) = true;
        self.bell.notify_all();
    }

    fn wait(&self, timeout: Duration) {
        let rung = lock(&self.rung);
        let (mut rung, _) = self
            .bell
            .wait_timeout_while(rung, timeout, |rung| !*rung)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *rung = false;
    }
}

impl Account {
    /// The bearer token for the brain, renewed first when it is about to expire; `None` while
    /// signed out.
    pub fn token(&self) -> Option<String> {
        let session = self.lock().session.clone()?;
        if !session.expiring() {
            return Some(session.access_token);
        }
        match self.refresh(&session.refresh_cookie) {
            Renewal::Fresh(token) => Some(token),
            Renewal::Kept => Some(session.access_token),
            Renewal::Gone => None,
        }
    }

    /// Renew the session now, whether or not it is due.
    pub fn renew(&self) -> Snapshot {
        let cookie = self
            .lock()
            .session
            .as_ref()
            .map(|s| s.refresh_cookie.clone());
        if let Some(cookie) = cookie {
            self.refresh(&cookie);
        }
        self.status()
    }

    /// Renew the session ahead of its expiry from now on, on a thread of its own. Calling it again
    /// does nothing; the thread ends some time after the account is dropped.
    pub fn keep_alive(self: &Arc<Self>) {
        if self.keeping.swap(true, Ordering::SeqCst) {
            return;
        }
        let account = Arc::downgrade(self);
        let wake = Arc::clone(&self.wake);
        let kept = thread::Builder::new()
            .name("desk-account-keeper".to_owned())
            .spawn(move || {
                let mut failed = false;
                loop {
                    let Some(this) = account.upgrade() else {
                        return;
                    };
                    let wait = if failed {
                        this.options.backoff
                    } else {
                        this.until_due()
                    };
                    drop(this);
                    wake.wait(wait);
                    let Some(this) = account.upgrade() else {
                        return;
                    };
                    failed = this.until_due().is_zero() && {
                        let after = this.renew();
                        after.state == State::SignedIn && after.problem.is_some()
                    };
                }
            });
        if kept.is_err() {
            self.keeping.store(false, Ordering::SeqCst);
        }
    }

    /// How long until the session is due for renewal: zero when it is, `IDLE` without one.
    fn until_due(&self) -> Duration {
        let inner = self.lock();
        inner.session.as_ref().map_or(IDLE, |session| {
            let due = session.due_at(self.options.lead);
            Duration::from_secs(due.saturating_sub(now())).min(IDLE)
        })
    }

    /// Renew the session whose cookie was `seen`, unless another caller already did.
    fn refresh(&self, seen: &str) -> Renewal {
        let _flight = lock(&self.flight);
        match &self.lock().session {
            None => return Renewal::Gone,
            Some(session) if session.refresh_cookie != seen => {
                return Renewal::Fresh(session.access_token.clone());
            }
            Some(_) => {}
        }
        match self.bff().refresh(seen) {
            Renewed::Tokens(tokens) => {
                let cookie = tokens.cookie.unwrap_or_else(|| seen.to_owned());
                let renewed = self.update(|inner| {
                    let session = inner
                        .session
                        .as_mut()
                        .filter(|session| session.refresh_cookie == seen)?;
                    session.renewed(
                        tokens.access_token.clone(),
                        cookie.clone(),
                        tokens.expires_in,
                    );
                    self.save(session);
                    if inner.signing.is_none() {
                        inner.problem = None;
                    }
                    Some(session.profile.is_none())
                });
                match renewed {
                    Some(no_profile) => {
                        if no_profile {
                            self.fill_profile(&cookie, &tokens.access_token);
                        }
                        Renewal::Fresh(tokens.access_token)
                    }
                    // Signed out meanwhile: the session endue just renewed is nobody's.
                    None => {
                        self.bff().logout(&cookie);
                        Renewal::Gone
                    }
                }
            }
            Renewed::Ended => {
                self.update(|inner| {
                    if inner
                        .session
                        .as_ref()
                        .is_some_and(|s| s.refresh_cookie == seen)
                    {
                        inner.session = None;
                        inner.problem = Some(Problem::SessionExpired);
                        self.forget_file();
                    }
                });
                Renewal::Gone
            }
            Renewed::Rejected => self.kept(seen, Problem::Rejected),
            Renewed::Transient(problem) => self.kept(seen, problem),
        }
    }

    /// The session stays; the person reads `problem`.
    fn kept(&self, seen: &str, problem: Problem) -> Renewal {
        self.update(|inner| {
            let ours = inner
                .session
                .as_ref()
                .is_some_and(|s| s.refresh_cookie == seen);
            if ours && inner.signing.is_none() {
                inner.problem = Some(problem);
            }
        });
        Renewal::Kept
    }

    /// A session without a profile (users/me was down at sign-in) gets one once it renews; one
    /// whose name or picture the person changed gets the new one (`refresh_profile`).
    pub(super) fn fill_profile(&self, cookie: &str, access_token: &str) {
        let Some(found) = profile::fetch(&self.bff(), access_token) else {
            return;
        };
        self.update(|inner| {
            if let Some(session) = inner
                .session
                .as_mut()
                .filter(|s| s.refresh_cookie == cookie)
            {
                session.profile = Some(found);
                self.save(session);
            }
        });
    }
}
