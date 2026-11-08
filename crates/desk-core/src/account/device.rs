//! Signing in: the device authorization grant (RFC 8628) through the platform's
//! `/api/v1/auth/device/{start,token}`, with a PKCE verifier per sign-in. The code's page must be
//! on endue ID's own origin (`auth_url`); Create account asks it for the sign-up screen with
//! `prompt=create`, a hint Keycloak may ignore on its device page, whose sign-in form links to
//! sign-up either way. A thread polls at endue's interval until the session comes, the person turns
//! it down, the code expires or a sign-out stops it.

use std::sync::Arc;
use std::thread;

use super::bff::{Polled, Start, Tokens};
use super::pkce::Pkce;
use super::session::Session;
use super::{Account, Code, Problem, Screen, Signing, Snapshot, now, profile};
use crate::account_client::origin_of;

/// The query that asks endue ID for its sign-up page (OpenID Connect `prompt=create`).
const SIGN_UP_HINT: &str = "prompt=create";

impl Account {
    /// Ask for a code, open nothing yet, and wait for the person in the background. A sign-in under
    /// way answers as it is, on `screen`'s page. One that cannot start answers why in `problem`.
    pub fn sign_in(self: &Arc<Self>, screen: Screen) -> Snapshot {
        if self.again(screen) {
            return self.status();
        }
        let started = Pkce::new()
            .ok_or(Problem::Failed)
            .and_then(|pkce| Ok((self.bff().start(&pkce.challenge)?, pkce)))
            .and_then(|(start, pkce)| self.checked(start).map(|start| (start, pkce)));
        let (start, pkce) = match started {
            Ok(started) => started,
            Err(problem) => {
                self.update(|inner| inner.problem = Some(problem));
                return self.status();
            }
        };
        let expires_at = now() + start.expires_in;
        let code = Code {
            user_code: start.user_code,
            verification_uri: start.verification_uri,
            verification_uri_complete: page_for(&start.verification_uri_complete, screen),
            screen,
            expires_at,
        };
        let page = start.verification_uri_complete;
        let generation = self.update(|inner| {
            inner.generation += 1;
            inner.signing = Some(Signing { code, page });
            inner.problem = None;
            inner.generation
        });
        let this = Arc::clone(self);
        let (device_code, interval) = (start.device_code, start.interval);
        let polled = thread::Builder::new()
            .name("desk-account-sign-in".to_owned())
            .spawn(move || {
                this.poll(
                    generation,
                    &device_code,
                    &pkce.verifier,
                    interval,
                    expires_at,
                )
            });
        if polled.is_err() {
            self.end(generation, None, Some(Problem::Failed));
        }
        self.status()
    }

    /// The page the desk opens for the sign-in under way, if there is one.
    pub fn page(&self) -> Option<String> {
        let inner = self.lock();
        inner
            .signing
            .as_ref()
            .map(|signing| signing.code.verification_uri_complete.clone())
    }

    /// A sign-in under way takes `screen`'s page and keeps its code.
    fn again(&self, screen: Screen) -> bool {
        self.update(|inner| {
            let Some(signing) = inner.signing.as_mut() else {
                return false;
            };
            signing.code.screen = screen;
            signing.code.verification_uri_complete = page_for(&signing.page, screen);
            true
        })
    }

    /// `start`, when both its pages are on endue ID's origin.
    fn checked(&self, start: Start) -> Result<Start, Problem> {
        let realm = origin_of(&self.options.auth_url);
        let ours = |page: &str| realm.is_some() && origin_of(page) == realm;
        if ours(&start.verification_uri) && ours(&start.verification_uri_complete) {
            Ok(start)
        } else {
            Err(Problem::Failed)
        }
    }

    fn poll(&self, generation: u64, device_code: &str, verifier: &str, interval: u64, until: u64) {
        let unit = self.options.interval_unit;
        let mut interval = interval.clamp(1, 600);
        let mut wait = unit * interval as u32;
        let mut failures = 0;
        loop {
            thread::sleep(wait);
            if self.lock().generation != generation {
                return;
            }
            if now() >= until {
                return self.end(generation, None, Some(Problem::Expired));
            }
            match self.bff().poll(device_code, verifier, interval) {
                Polled::Pending(next) => {
                    let slower = next > interval;
                    (interval, failures) = (next, 0);
                    wait = unit * interval as u32;
                    self.notice(generation, slower.then_some(Problem::SlowDown));
                }
                Polled::Tokens(tokens) => return self.approved(generation, tokens),
                Polled::Ended(problem) => return self.end(generation, None, Some(problem)),
                Polled::Transient(problem) => {
                    failures += 1;
                    // Retried after each wait first; then the person hears it, and the code holds.
                    wait = match self.options.retry.get(failures - 1) {
                        Some(retry) => *retry,
                        None => {
                            self.notice(generation, Some(problem));
                            unit * interval as u32
                        }
                    };
                }
            }
        }
    }

    /// What the person reads while the sign-in of `generation` still waits.
    fn notice(&self, generation: u64, problem: Option<Problem>) {
        self.update(|inner| {
            if inner.generation == generation && inner.signing.is_some() {
                inner.problem = problem;
            }
        });
    }

    fn approved(&self, generation: u64, tokens: Tokens) {
        let Some(cookie) = tokens.cookie else {
            // No refresh cookie: the session would end with its first token.
            return self.end(generation, None, Some(Problem::Failed));
        };
        let mut session = Session::new(tokens.access_token, cookie, tokens.expires_in);
        session.profile = profile::fetch(&self.bff(), &session.access_token);
        self.end(generation, Some(session), None);
    }

    /// The sign-in of `generation` ended with `session`, or with `problem`.
    pub(super) fn end(&self, generation: u64, session: Option<Session>, problem: Option<Problem>) {
        let (stale, replaced) = {
            let mut inner = self.lock();
            if inner.generation != generation {
                // A sign-out or another sign-in came first: this session is nobody's.
                (session, None)
            } else {
                inner.signing = None;
                inner.problem = problem;
                // Saved while the generation still holds: a sign-out waits for the file, then
                // removes it, instead of removing nothing and leaving this write behind (#494).
                let replaced = session.and_then(|session| {
                    self.save(&session);
                    inner.session.replace(session)
                });
                (None, replaced)
            }
        };
        if let Some(stale) = stale {
            return self.bff().logout(&stale.refresh_cookie);
        }
        self.wake.ring();
        self.changed();
        // Signing in again replaced a session: revoke the one it replaced.
        if let Some(old) = replaced {
            self.bff().logout(&old.refresh_cookie);
        }
    }
}

/// `page` with the sign-up hint when `screen` asks for it.
fn page_for(page: &str, screen: Screen) -> String {
    match screen {
        Screen::SignIn => page.to_owned(),
        Screen::SignUp => {
            let join = if page.contains('?') { '&' } else { '?' };
            format!("{page}{join}{SIGN_UP_HINT}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_account_adds_the_sign_up_hint() {
        let page = "https://auth.endue.ai/realms/endue/device?user_code=AB-CD";
        assert_eq!(page_for(page, Screen::SignIn), page);
        assert_eq!(
            page_for(page, Screen::SignUp),
            format!("{page}&prompt=create")
        );
        let bare = "https://auth.endue.ai/realms/endue/device";
        assert_eq!(
            page_for(bare, Screen::SignUp),
            format!("{bare}?prompt=create")
        );
    }
}
