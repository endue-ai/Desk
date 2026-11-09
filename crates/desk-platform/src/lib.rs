//! endue AI's platform API (`/api/v1`), the subset specs/platform/v0 writes down: the person's endue
//! AI agents, what Studio shows of them, the agent catalog, the conversations of the Home board
//! (ADR 0122), the spaces the person can open (ADR 0129) and the person's own account settings (ADR
//! 0130). Every call carries the endue ID access token `Tokens` hands out, sends no Origin
//! header, waits 15 s at most and, after a 401, refreshes the token once and tries once more. The
//! error envelope `{ error: { code, message } }` becomes a typed `PlatformError`.

use std::sync::Arc;
use std::time::Duration;

mod agents;
mod catalog;
mod error;
mod facets;
#[cfg(feature = "fake")]
pub mod fake;
mod http;
mod me;
mod spaces;
pub mod wire;
pub mod wire_account;
pub mod wire_catalog;
pub mod wire_spaces;

pub use agents::Switch;
pub use error::{ErrorKind, PlatformError, Result, SIGN_IN};

pub const NAME: &str = env!("CARGO_PKG_NAME");
/// endue AI's platform.
pub const DEFAULT_URL: &str = "https://platform.endue.ai";
/// endue AI's development platform.
pub const DEV_URL: &str = "https://platform.dev.endue.ai";
/// The variable that names another base, as the sign-in does.
pub const URL_VAR: &str = "DESK_ENDUE_PLATFORM_URL";
/// How long a call may take.
pub const TIMEOUT: Duration = Duration::from_secs(15);
/// How long starting an agent from the catalog may take; endue.ai waits as long.
pub const USE_TIMEOUT: Duration = Duration::from_secs(30);
/// Agents a page when the client pages through them all, the platform's most.
pub const PAGE: u64 = 200;
/// Pages read before the list stops: 10 000 agents.
pub const MAX_PAGES: u64 = 50;

/// Where the access token comes from: the desk's endue ID account.
pub trait Tokens: Send + Sync {
    /// The token to send, refreshed first when it has expired; `None` while signed out.
    fn token(&self) -> Option<String>;
    /// A token to try again with after endue AI refused `rejected`; `None` (or `rejected` again)
    /// when there is none, and the call is `signed_out`.
    fn refresh(&self, rejected: &str) -> Option<String>;
}

/// The client: one base URL, the token source, and the deadline of each call.
pub struct Platform {
    base: String,
    host: String,
    tokens: Arc<dyn Tokens>,
    timeout: Duration,
}

impl Platform {
    /// A client of the platform at `base_url` (`https://platform.endue.ai`, or an `http://` one for
    /// a platform on this machine).
    pub fn new(base_url: &str, tokens: Arc<dyn Tokens>) -> Result<Self> {
        let base = base_url.trim().trim_end_matches('/').to_owned();
        let rest = base
            .strip_prefix("https://")
            .or_else(|| base.strip_prefix("http://"))
            .ok_or_else(|| {
                PlatformError::new(ErrorKind::Failed, format!("not an http URL: {base}"))
            })?;
        let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
        let host = host.rsplit_once('@').map_or(host, |(_, host)| host);
        if host.is_empty() || base.contains(['?', '#']) {
            return Err(PlatformError::new(
                ErrorKind::Failed,
                format!("not a base URL: {base}"),
            ));
        }
        Ok(Self {
            host: host.to_ascii_lowercase(),
            base,
            tokens,
            timeout: TIMEOUT,
        })
    }

    /// The platform `DESK_ENDUE_PLATFORM_URL` names, else endue AI's.
    pub fn from_env(tokens: Arc<dyn Tokens>) -> Result<Self> {
        let base = std::env::var(URL_VAR)
            .ok()
            .filter(|url| !url.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_URL.to_owned());
        Self::new(&base, tokens)
    }

    /// Wait at most `timeout` for each call (`USE_TIMEOUT` stays as long, or longer).
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn base_url(&self) -> &str {
        &self.base
    }
}
