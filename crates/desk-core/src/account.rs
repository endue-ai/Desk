//! The person's endue ID on this desk (ADR 0089). Signing in follows the OAuth 2.0 device
//! authorization grant (RFC 8628): endue ID hands out a code, the person enters it in the browser,
//! and a thread polls the token endpoint until the token comes, the person says no, or the code
//! expires. The token is kept in one file readable by this user only until Desk uses the OS keychain
//! (SYS-06), refreshed with its refresh token (RFC 6749, section 6) once it has expired, and given
//! to the brain as its bearer token (`token`). It never crosses the bridge.
//!
//! ```json
//! { "version": 1, "note": "...", "accessToken": "...", "refreshToken": "...", "expiresAt": 1767225600 }
//! ```

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use crate::account_client::{IdClient, NetIdClient};
use crate::secrets::write_private;

/// Where endue ID lives unless the app is told otherwise (`DESK_ID_URL`).
pub const DEFAULT_ID_URL: &str = "https://id.endue.ai";
/// The OAuth client id Desk signs in as.
pub const CLIENT_ID: &str = "endue-desk";
/// What the token lets the desk do: talk to endue AI's brain.
const SCOPE: &str = "brain";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
const VERSION: u32 = 1;
const NOTE: &str =
    "the endue ID token in plain text until Desk uses the OS keychain; readable by this user only";
/// A token this close to its expiry is refreshed before it is used.
const EARLY: u64 = 30;

/// What people read when signing in did not go through.
pub const DECLINED: &str = "The sign-in was turned down in the browser.";
pub const EXPIRED: &str = "The sign-in code expired. Sign in again for a new one.";
pub const RAN_OUT: &str = "Your endue sign-in ran out. Sign in again.";

#[derive(Debug, Clone)]
pub struct AccountOptions {
    /// endue ID's base URL; its endpoints are `/oauth/device/code` and `/oauth/token`.
    pub id_url: String,
    pub client_id: String,
    /// The token file; `None` keeps the token in memory.
    pub file: Option<PathBuf>,
    /// The shortest wait between polls, and the wait when endue ID names none (RFC 8628 says
    /// 5 s); tests shorten it.
    pub interval: Duration,
}

impl AccountOptions {
    pub fn new(id_url: impl Into<String>) -> Self {
        Self {
            id_url: id_url.into().trim_end_matches('/').to_owned(),
            client_id: CLIENT_ID.to_owned(),
            file: None,
            interval: Duration::from_secs(5),
        }
    }
}

/// The code the person enters, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Code {
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    /// Unix seconds.
    pub expires_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    SignedOut,
    SigningIn(Code),
    SignedIn,
}

/// The account as the bridge shows it: no token in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub state: State,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenFile {
    version: u32,
    note: String,
    access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<u64>,
}

#[derive(Default)]
struct Inner {
    token: Option<TokenFile>,
    signing: Option<Code>,
    /// Goes up with every sign-in and sign-out, so a poll that outlived its sign-in stops.
    generation: u64,
    problem: Option<String>,
}

type Listener = Box<dyn Fn(&Snapshot) + Send + Sync>;

pub struct Account {
    options: AccountOptions,
    client: Box<dyn IdClient>,
    inner: Mutex<Inner>,
    listener: Mutex<Option<Listener>>,
}

impl Account {
    /// The account whose token is in `options.file`, if one is there.
    pub fn open(options: AccountOptions, client: impl IdClient + 'static) -> Arc<Self> {
        let token = options
            .file
            .as_ref()
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<TokenFile>(&bytes).ok())
            .filter(|file| file.version == VERSION && !file.access_token.is_empty());
        Arc::new(Self {
            options,
            client: Box::new(client),
            inner: Mutex::new(Inner {
                token,
                ..Inner::default()
            }),
            listener: Mutex::new(None),
        })
    }

    /// Hear every change of the account; the last listener set is the one that hears.
    pub fn listen(&self, listener: impl Fn(&Snapshot) + Send + Sync + 'static) {
        *lock(&self.listener) = Some(Box::new(listener));
    }

    pub fn status(&self) -> Snapshot {
        snapshot(&self.lock())
    }

    /// Ask endue ID for a code and wait for the person in the background. A sign-in under way
    /// answers as it is. `Err` says why endue ID could not be asked; nothing changed then.
    pub fn sign_in(self: &Arc<Self>) -> Result<Snapshot, String> {
        if matches!(self.status().state, State::SigningIn(_)) {
            return Ok(self.status());
        }
        let url = format!("{}/oauth/device/code", self.options.id_url);
        let form = [
            ("client_id", self.options.client_id.as_str()),
            ("scope", SCOPE),
        ];
        let (status, body) = self.client.post_form(&url, &form)?;
        let text = |key: &str| body.get(key).and_then(Value::as_str).map(str::to_owned);
        let (Some(device_code), Some(user_code), Some(verification_uri)) = (
            text("device_code"),
            text("user_code"),
            text("verification_uri"),
        ) else {
            return Err(refusal("the sign-in code", status, &body));
        };
        let lifetime = body
            .get("expires_in")
            .and_then(Value::as_u64)
            .unwrap_or(600);
        // endue ID's interval, never under the desk's own (RFC 8628 says 5 s when it names none).
        let interval = body
            .get("interval")
            .and_then(Value::as_u64)
            .map_or(self.options.interval, Duration::from_secs)
            .max(self.options.interval);
        let code = Code {
            user_code,
            verification_uri,
            verification_uri_complete: text("verification_uri_complete"),
            expires_at: now() + lifetime,
        };
        let generation = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.signing = Some(code.clone());
            inner.problem = None;
            inner.generation
        };
        self.changed();
        let this = Arc::clone(self);
        let polled = thread::Builder::new()
            .name("desk-account-sign-in".to_owned())
            .spawn(move || this.poll(generation, &device_code, interval, code.expires_at));
        if polled.is_err() {
            self.end(
                generation,
                None,
                Some("Desk could not wait for the sign-in.".to_owned()),
            );
        }
        Ok(self.status())
    }

    /// Forget the token and stop any sign-in under way.
    pub fn sign_out(&self) -> Snapshot {
        {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.signing = None;
            inner.token = None;
            inner.problem = None;
            // Under the lock, so a sign-in that ends now never writes the file back (#494).
            if let Some(path) = &self.options.file {
                let _ = fs::remove_file(path);
            }
        }
        self.changed();
        self.status()
    }

    /// The bearer token for the brain, refreshed first when it has expired; `None` while signed out.
    pub fn token(&self) -> Option<String> {
        let token = self.lock().token.clone()?;
        let expired = token.expires_at.is_some_and(|at| at <= now() + EARLY);
        let Some(refresh) = token.refresh_token.as_deref().filter(|_| expired) else {
            return Some(token.access_token);
        };
        let url = format!("{}/oauth/token", self.options.id_url);
        let form = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh),
            ("client_id", self.options.client_id.as_str()),
        ];
        match self.client.post_form(&url, &form) {
            Ok((_, body)) if body.get("access_token").is_some() => {
                let fresh = token_of(&body, Some(refresh))?;
                let access = fresh.access_token.clone();
                self.keep(fresh);
                Some(access)
            }
            // endue ID no longer knows the refresh token: the person signs in again.
            Ok((_, body)) if error_of(&body) == Some("invalid_grant") => {
                let generation = self.lock().generation;
                self.end(generation, None, Some(RAN_OUT.to_owned()));
                self.forget_file();
                None
            }
            // Unreachable for now: the old token, which the brain may still take.
            _ => Some(token.access_token),
        }
    }

    fn poll(&self, generation: u64, device_code: &str, mut interval: Duration, expires_at: u64) {
        let url = format!("{}/oauth/token", self.options.id_url);
        let form = [
            ("grant_type", DEVICE_GRANT),
            ("device_code", device_code),
            ("client_id", self.options.client_id.as_str()),
        ];
        loop {
            thread::sleep(interval);
            if self.lock().generation != generation {
                return;
            }
            if now() >= expires_at {
                return self.end(generation, None, Some(EXPIRED.to_owned()));
            }
            let Ok((status, body)) = self.client.post_form(&url, &form) else {
                continue;
            };
            if body.get("access_token").is_some() {
                return match token_of(&body, None) {
                    Some(token) => self.end(generation, Some(token), None),
                    None => self.end(generation, None, Some(refusal("the token", status, &body))),
                };
            }
            match error_of(&body) {
                Some("authorization_pending") => {}
                Some("slow_down") => interval += Duration::from_secs(5),
                Some("access_denied") => return self.end(generation, None, Some(DECLINED.into())),
                Some("expired_token") => return self.end(generation, None, Some(EXPIRED.into())),
                _ => return self.end(generation, None, Some(refusal("the token", status, &body))),
            }
        }
    }

    /// The sign-in of `generation` ended with `token`, or with `problem`.
    fn end(&self, generation: u64, token: Option<TokenFile>, problem: Option<String>) {
        {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            inner.signing = None;
            inner.problem = problem;
            if token.is_some() || inner.problem.as_deref() == Some(RAN_OUT) {
                inner.token = token.clone();
            }
            // Saved while the generation still holds: a sign-out waits for the file, then removes
            // it, instead of removing nothing and leaving this write behind (#494).
            if let Some(token) = &token {
                self.save(token);
            }
        }
        self.changed();
    }

    fn keep(&self, token: TokenFile) {
        let mut inner = self.lock();
        inner.token = Some(token.clone());
        self.save(&token);
    }

    fn save(&self, token: &TokenFile) {
        if let Some(path) = &self.options.file
            && let Ok(bytes) = serde_json::to_vec_pretty(token)
        {
            let _ = write_private(path, &bytes);
        }
    }

    fn forget_file(&self) {
        if let Some(path) = &self.options.file {
            let _ = fs::remove_file(path);
        }
    }

    fn changed(&self) {
        let snapshot = self.status();
        if let Some(listener) = lock(&self.listener).as_ref() {
            listener(&snapshot);
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        lock(&self.inner)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn snapshot(inner: &Inner) -> Snapshot {
    let state = match (&inner.signing, &inner.token) {
        (Some(code), _) => State::SigningIn(code.clone()),
        (None, Some(_)) => State::SignedIn,
        (None, None) => State::SignedOut,
    };
    Snapshot {
        state,
        problem: inner.problem.clone(),
    }
}

/// A token response (RFC 6749, section 5.1); a refresh that names no new refresh token keeps `kept`.
fn token_of(body: &Value, kept: Option<&str>) -> Option<TokenFile> {
    let access_token = body.get("access_token")?.as_str()?.to_owned();
    let refresh_token = body
        .get("refresh_token")
        .and_then(Value::as_str)
        .or(kept)
        .map(str::to_owned);
    let expires_at = body
        .get("expires_in")
        .and_then(Value::as_u64)
        .map(|secs| now() + secs);
    Some(TokenFile {
        version: VERSION,
        note: NOTE.to_owned(),
        access_token,
        refresh_token,
        expires_at,
    })
}

fn error_of(body: &Value) -> Option<&str> {
    body.get("error").and_then(Value::as_str)
}

/// What people read when endue ID answered with something other than what was asked for.
fn refusal(what: &str, status: u16, body: &Value) -> String {
    let why = body
        .get("error_description")
        .or_else(|| body.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("no reason given");
    format!("endue ID did not hand out {what} ({status}: {why}).")
}

/// Unix seconds now.
pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
