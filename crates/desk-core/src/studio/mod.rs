//! The platform client studio.* goes through (ADR 0122): the one the app or a test gives the core,
//! else one built on first use over the account's token, at `DESK_ENDUE_PLATFORM_URL` or endue AI's
//! own platform, as the account's. The token comes only from the account's public accessors (`token`,
//! and `renew` after a 401) and never crosses the bridge.

use std::sync::{Arc, OnceLock};

use desk_platform::{Platform, Tokens};

use crate::account::Account;

pub(crate) mod map;
pub(crate) mod map_catalog;
mod serve;
mod spaces;

/// The account's token as the platform client takes it.
struct AccountTokens(Arc<Account>);

impl Tokens for AccountTokens {
    fn token(&self) -> Option<String> {
        self.0.token()
    }

    /// Renew the session now, as endue.ai does after a 401, and hand out the new token. When the
    /// renewal gives none, or the same one back, the call is `signed_out` and is not tried twice.
    fn refresh(&self, rejected: &str) -> Option<String> {
        self.0.renew();
        self.0.token().filter(|token| token != rejected)
    }
}

/// The account's token for a platform client: what the core uses when it builds its own.
pub fn studio_tokens(account: &Arc<Account>) -> Arc<dyn Tokens> {
    Arc::new(AccountTokens(Arc::clone(account)))
}

#[derive(Default)]
pub(crate) struct Studio {
    given: Option<Arc<Platform>>,
    built: OnceLock<Option<Arc<Platform>>>,
}

impl Studio {
    pub(crate) fn with(platform: Platform) -> Self {
        Self {
            given: Some(Arc::new(platform)),
            built: OnceLock::new(),
        }
    }

    /// The client: the one given, else one over `account`'s token; `None` without either.
    pub(crate) fn platform(&self, account: Option<&Arc<Account>>) -> Option<Arc<Platform>> {
        if let Some(given) = &self.given {
            return Some(Arc::clone(given));
        }
        self.built
            .get_or_init(|| {
                let account = account?;
                Platform::from_env(studio_tokens(account))
                    .ok()
                    .map(Arc::new)
            })
            .clone()
    }
}
