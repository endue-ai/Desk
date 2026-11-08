//! The session the desk keeps for the person: the access token (which lives 300 s), the `endue_rt`
//! refresh cookie, when the token was issued and expires, and the profile, in one file readable by
//! this user only (`<data>/account.json`, mode 0600) until the OS keychain (SYS-06). A version 1
//! file, from the endpoints endue ID never served, is not read.
//!
//! ```json
//! { "version": 2, "note": "...", "accessToken": "...", "refreshCookie": "...",
//!   "issuedAt": 1767225300, "expiresAt": 1767225600, "profile": { "displayName": "Ada" } }
//! ```

use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{Profile, now};
use crate::secrets::write_private;

const VERSION: u32 = 2;
const NOTE: &str = "the endue ID session in plain text until Desk uses the OS keychain; readable by this user only";
/// A token this close to its expiry is renewed before it is handed out.
const EARLY: u64 = 30;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Session {
    version: u32,
    note: String,
    pub access_token: String,
    pub refresh_cookie: String,
    pub issued_at: u64,
    pub expires_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
}

impl Session {
    pub fn new(access_token: String, refresh_cookie: String, expires_in: u64) -> Self {
        let issued_at = now();
        Self {
            version: VERSION,
            note: NOTE.to_owned(),
            access_token,
            refresh_cookie,
            issued_at,
            expires_at: issued_at + expires_in,
            profile: None,
        }
    }

    /// The session in `path`, when one of this version is there.
    pub fn read(path: &Path) -> Option<Self> {
        let bytes = fs::read(path).ok()?;
        let session = serde_json::from_slice::<Self>(&bytes).ok()?;
        let whole = !session.access_token.is_empty() && !session.refresh_cookie.is_empty();
        (session.version == VERSION && whole).then_some(session)
    }

    pub fn write(&self, path: &Path) {
        if let Ok(bytes) = serde_json::to_vec_pretty(self) {
            let _ = write_private(path, &bytes);
        }
    }

    /// The renewed token and the rotated cookie.
    pub fn renewed(&mut self, access_token: String, refresh_cookie: String, expires_in: u64) {
        let profile = self.profile.take();
        *self = Self::new(access_token, refresh_cookie, expires_in);
        self.profile = profile;
    }

    /// Whether the token is too close to its expiry to hand out as it is.
    pub fn expiring(&self) -> bool {
        self.expires_at <= now() + EARLY
    }

    /// When the keeper renews it: `lead` before it expires, or halfway for a short-lived token.
    pub fn due_at(&self, lead: Duration) -> u64 {
        let life = self.expires_at.saturating_sub(self.issued_at);
        self.expires_at - lead.as_secs().min(life / 2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keeper_renews_a_lead_ahead_or_halfway() {
        let mut session = Session::new("a".into(), "r".into(), 300);
        session.issued_at = 1000;
        session.expires_at = 1300;
        assert_eq!(session.due_at(Duration::from_secs(90)), 1210);
        session.expires_at = 1060;
        assert_eq!(session.due_at(Duration::from_secs(90)), 1030);
    }

    #[test]
    fn a_renewal_keeps_the_profile() {
        let mut session = Session::new("a".into(), "r1".into(), 300);
        session.profile = Some(Profile {
            display_name: Some("Ada".into()),
            ..Profile::default()
        });
        session.renewed("b".into(), "r2".into(), 300);
        assert_eq!(session.refresh_cookie, "r2");
        assert_eq!(
            session.profile.unwrap().display_name.as_deref(),
            Some("Ada")
        );
    }
}
