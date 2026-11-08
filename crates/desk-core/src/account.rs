//! The person's endue ID on this desk (ADR 0089, ADR 0111). endue ID is Keycloak's realm `endue`
//! at auth.endue.ai, the identity the endue.ai web uses; the desk reaches it only through the
//! platform's auth endpoints at platform.endue.ai, because its OAuth client is confidential.
//! Signing in is the device authorization grant (RFC 8628) with PKCE: the desk asks for a code
//! (`device.rs`), opens endue ID's page where the person signs in or creates an account and
//! confirms the code, and polls until the session comes. The session (`session.rs`) is an access
//! token that lives 300 s and the `endue_rt` refresh cookie (`cookie.rs`); the keeper
//! (`keeper.rs`) renews it before it expires, one refresh at a time because every refresh rotates
//! the cookie. The profile comes from `/api/v1/users/me` (`profile.rs`). The brain gets the access
//! token as its bearer token (`token`); no token crosses the bridge.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub use crate::account_client::{Call, IdClient, NetIdClient, Reply, Verb};

mod bff;
mod cookie;
mod device;
mod keeper;
mod pkce;
mod profile;
mod session;

use bff::Bff;
use keeper::Wake;
use session::Session;

/// The platform's public API and endue ID's realm, unless `DESK_ENDUE_PLATFORM_URL` and
/// `DESK_ENDUE_AUTH_URL` say otherwise.
pub const DEFAULT_PLATFORM_URL: &str = "https://platform.endue.ai";
pub const DEFAULT_AUTH_URL: &str = "https://auth.endue.ai/realms/endue";
/// The development hosts; the realm follows the platform when only the platform is named.
pub const DEV_PLATFORM_URL: &str = "https://platform.dev.endue.ai";
pub const DEV_AUTH_URL: &str = "https://id-dev.endue.ai/realms/endue";

#[derive(Debug, Clone)]
pub struct AccountOptions {
    /// Where `/api/v1/auth/*` and `/api/v1/users/me` are.
    pub platform_url: String,
    /// endue ID's realm: the only origin whose device page the desk opens.
    pub auth_url: String,
    /// The session file; `None` keeps the session in memory.
    pub file: Option<PathBuf>,
    /// How long one second of endue's poll interval lasts; tests shorten it.
    pub interval_unit: Duration,
    /// The waits before each retry of a failure other than 400, 401 and 403.
    pub retry: Vec<Duration>,
    /// How long before the access token expires the keeper renews it.
    pub lead: Duration,
    /// How long the keeper waits after a renewal that did not go through.
    pub backoff: Duration,
}

impl AccountOptions {
    pub fn new(platform_url: impl Into<String>, auth_url: impl Into<String>) -> Self {
        Self {
            platform_url: trimmed(platform_url.into()),
            auth_url: trimmed(auth_url.into()),
            file: None,
            interval_unit: Duration::from_secs(1),
            retry: [400, 1200, 3000].map(Duration::from_millis).to_vec(),
            lead: Duration::from_secs(90),
            backoff: Duration::from_secs(15),
        }
    }

    /// The hosts `DESK_ENDUE_PLATFORM_URL` and `DESK_ENDUE_AUTH_URL` name, endue's otherwise.
    pub fn from_env() -> Self {
        Self::from_vars(|name| std::env::var(name).ok())
    }

    /// `from_env` over `var`, so tests need not change the process's environment.
    pub fn from_vars(var: impl Fn(&str) -> Option<String>) -> Self {
        let set = |name: &str| var(name).filter(|value| !value.trim().is_empty());
        let platform = set("DESK_ENDUE_PLATFORM_URL").map_or(DEFAULT_PLATFORM_URL.into(), trimmed);
        let realm = if platform == DEV_PLATFORM_URL {
            DEV_AUTH_URL
        } else {
            DEFAULT_AUTH_URL
        };
        let auth = set("DESK_ENDUE_AUTH_URL").unwrap_or_else(|| realm.to_owned());
        Self::new(platform, auth)
    }
}

fn trimmed(url: String) -> String {
    url.trim().trim_end_matches('/').to_owned()
}

/// Which endue ID page the person starts on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Screen {
    #[default]
    SignIn,
    SignUp,
}

/// Why the last step did not go through. The runtime words it in the person's language.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Problem {
    Offline,
    Denied,
    Expired,
    SlowDown,
    Unavailable,
    Suspended,
    Rejected,
    SessionExpired,
    Failed,
}

impl Problem {
    /// The problem for people, in English.
    pub fn text(self) -> &'static str {
        match self {
            Self::Offline => "Desk could not reach endue. Check your connection and try again.",
            Self::Denied => "The sign-in was turned down in the browser.",
            Self::Expired => "The sign-in code expired. Sign in again for a new one.",
            Self::SlowDown => "endue asked the desk to slow down. Wait a moment and try again.",
            Self::Unavailable => "endue is not answering right now. Try again in a moment.",
            Self::Suspended => "This endue account is suspended.",
            Self::Rejected => {
                "endue would not renew this desk's session. You stay signed in for now."
            }
            Self::SessionExpired => "Your endue session ended. Sign in again.",
            Self::Failed => "The sign-in did not go through. Try again.",
        }
    }
}

/// The code the person confirms, and the page it is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Code {
    pub user_code: String,
    pub verification_uri: String,
    /// The page the desk opens: the code in it, and the sign-up hint for `SignUp`.
    pub verification_uri_complete: String,
    pub screen: Screen,
    /// Unix seconds.
    pub expires_at: u64,
}

/// Who is signed in.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// A data: URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
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
    pub profile: Option<Profile>,
    pub problem: Option<Problem>,
}

/// A sign-in under way: its code, and its page without the sign-up hint.
struct Signing {
    code: Code,
    page: String,
}

#[derive(Default)]
struct Inner {
    session: Option<Session>,
    signing: Option<Signing>,
    /// Goes up with every sign-in and sign-out, so a poll that outlived its sign-in stops.
    generation: u64,
    problem: Option<Problem>,
}

type Listener = Box<dyn Fn(&Snapshot) + Send + Sync>;

pub struct Account {
    options: AccountOptions,
    client: Box<dyn IdClient>,
    inner: Mutex<Inner>,
    /// Held for the whole of a refresh: only one runs at a time.
    flight: Mutex<()>,
    listener: Mutex<Option<Listener>>,
    wake: Arc<Wake>,
    keeping: AtomicBool,
}

impl Account {
    /// The account whose session is in `options.file`, if one is there.
    pub fn open(options: AccountOptions, client: impl IdClient + 'static) -> Arc<Self> {
        let session = options.file.as_deref().and_then(Session::read);
        Arc::new(Self {
            options,
            client: Box::new(client),
            inner: Mutex::new(Inner {
                session,
                ..Inner::default()
            }),
            flight: Mutex::new(()),
            listener: Mutex::new(None),
            wake: Arc::default(),
            keeping: AtomicBool::new(false),
        })
    }

    /// Hear every change of the account; the last listener set is the one that hears.
    pub fn listen(&self, listener: impl Fn(&Snapshot) + Send + Sync + 'static) {
        *lock(&self.listener) = Some(Box::new(listener));
    }

    pub fn status(&self) -> Snapshot {
        snapshot(&self.lock())
    }

    /// End the session: forget it on this desk and stop any sign-in under way, then ask endue to
    /// revoke it. Without a connection it is forgotten all the same.
    pub fn sign_out(&self) -> Snapshot {
        let cookie = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.signing = None;
            inner.problem = None;
            // Under the lock, so a sign-in that ends now never writes the file back (#494).
            self.forget_file();
            inner.session.take().map(|session| session.refresh_cookie)
        };
        self.wake.ring();
        self.changed();
        if let Some(cookie) = cookie {
            self.bff().logout(&cookie);
        }
        self.status()
    }

    fn bff(&self) -> Bff<'_> {
        Bff {
            platform: &self.options.platform_url,
            retry: &self.options.retry,
            client: self.client.as_ref(),
        }
    }

    /// Change the account under its lock, and tell the listener when what it shows changed.
    fn update<T>(&self, change: impl FnOnce(&mut Inner) -> T) -> T {
        let (before, out, after) = {
            let mut inner = self.lock();
            let before = snapshot(&inner);
            let out = change(&mut inner);
            (before, out, snapshot(&inner))
        };
        if before != after {
            self.tell(&after);
        }
        out
    }

    fn save(&self, session: &Session) {
        if let Some(path) = &self.options.file {
            session.write(path);
        }
    }

    fn forget_file(&self) {
        if let Some(path) = &self.options.file {
            let _ = fs::remove_file(path);
        }
    }

    fn changed(&self) {
        self.tell(&self.status());
    }

    fn tell(&self, snapshot: &Snapshot) {
        if let Some(listener) = lock(&self.listener).as_ref() {
            listener(snapshot);
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
    let state = match (&inner.signing, &inner.session) {
        (Some(signing), _) => State::SigningIn(signing.code.clone()),
        (None, Some(_)) => State::SignedIn,
        (None, None) => State::SignedOut,
    };
    let profile = match state {
        State::SignedIn => inner.session.as_ref().and_then(|s| s.profile.clone()),
        _ => None,
    };
    Snapshot {
        state,
        profile,
        problem: inner.problem,
    }
}

/// Unix seconds now.
pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
