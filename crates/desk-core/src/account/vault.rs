//! Where the session is kept (ADR 0239). The access token and the refresh cookie go to the OS
//! keychain, under service `ai.endue.desktop` and account `endue-id` (`endue-id@<host>` for a platform
//! other than endue's); `<data>/account.json` keeps only what is not secret, as version 3:
//!
//! ```json
//! { "version": 3, "note": "...", "issuedAt": 1767225300, "expiresAt": 1767225600,
//!   "profile": { "displayName": "Ada" } }
//! ```
//!
//! A version 2 file (`session.rs`, tokens in it) moves into the keychain on the next start. Where
//! the keychain does not answer, the session stays a version 2 file readable by this user only, and
//! the log says so once.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use desk_sys::keychain::Keychain;
use serde::{Deserialize, Serialize};

use super::session::Session;
use super::{AccountLog, AccountOptions, DEFAULT_PLATFORM_URL, Profile};
use crate::secrets::write_private;

const VERSION: u32 = 3;
const NOTE: &str = "who is signed in to endue ID; the tokens are in the OS keychain";
/// The keychain account for endue's own platform.
const ACCOUNT: &str = "endue-id";
const FALLBACK: &str = "the OS keychain did not answer; the endue ID session is kept in \
                        account.json, readable by this user only";

/// `account.json` version 3: no token in it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    version: u32,
    #[serde(default)]
    note: String,
    issued_at: u64,
    expires_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    profile: Option<Profile>,
}

/// The keychain entry's secret.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Secret {
    access_token: String,
    refresh_cookie: String,
}

#[derive(Debug)]
pub(super) struct Vault {
    file: Option<PathBuf>,
    keychain: Option<Arc<dyn Keychain>>,
    account: String,
    log: AccountLog,
    warned: AtomicBool,
}

impl Vault {
    pub fn new(options: &AccountOptions) -> Self {
        Self {
            file: options.file.clone(),
            keychain: options.keychain.clone(),
            account: account_for(&options.platform_url),
            log: options.log.clone(),
            warned: AtomicBool::new(false),
        }
    }

    /// The session kept on this desk, moving a version 2 file's tokens into the keychain.
    pub fn load(&self) -> Option<Session> {
        let path = self.file.as_deref()?;
        if let Some(plain) = Session::read(path) {
            if self.put(&plain) {
                self.write_record(&plain);
            }
            return Some(plain);
        }
        let bytes = fs::read(path).ok()?;
        let record = serde_json::from_slice::<Record>(&bytes).ok()?;
        if record.version != VERSION {
            return None;
        }
        let kept = self.keychain.as_ref()?.get(&self.account).ok()??;
        let secret = serde_json::from_str::<Secret>(&kept).ok()?;
        let whole = !secret.access_token.is_empty() && !secret.refresh_cookie.is_empty();
        whole.then(|| {
            Session::restore(
                secret.access_token,
                secret.refresh_cookie,
                record.issued_at,
                record.expires_at,
                record.profile,
            )
        })
    }

    /// Keep `session`: the tokens in the keychain and the rest in the file, or all of it in the
    /// private file when the keychain does not answer.
    pub fn save(&self, session: &Session) {
        if self.file.is_none() {
            return;
        }
        if self.put(session) {
            self.write_record(session);
        } else {
            self.write_plain(session);
        }
    }

    /// Forget the session: the file and the keychain entry.
    pub fn forget(&self) {
        if let Some(path) = &self.file {
            let _ = fs::remove_file(path);
        }
        if let Some(keychain) = &self.keychain {
            let _ = keychain.delete(&self.account);
        }
    }

    /// Whether the keychain took the session's tokens.
    fn put(&self, session: &Session) -> bool {
        let Some(keychain) = &self.keychain else {
            return false;
        };
        let secret = Secret {
            access_token: session.access_token.clone(),
            refresh_cookie: session.refresh_cookie.clone(),
        };
        let Ok(text) = serde_json::to_string(&secret) else {
            return false;
        };
        match keychain.set(&self.account, &text) {
            Ok(()) => true,
            Err(_) => {
                if !self.warned.swap(true, Ordering::SeqCst) {
                    self.log.say(FALLBACK);
                }
                false
            }
        }
    }

    fn write_record(&self, session: &Session) {
        let Some(path) = &self.file else { return };
        let record = Record {
            version: VERSION,
            note: NOTE.to_owned(),
            issued_at: session.issued_at,
            expires_at: session.expires_at,
            profile: session.profile.clone(),
        };
        if let Ok(bytes) = serde_json::to_vec_pretty(&record) {
            let _ = write_private(path, &bytes);
        }
    }

    fn write_plain(&self, session: &Session) {
        if let Some(path) = &self.file {
            session.write(path);
        }
    }
}

/// `endue-id` for endue's platform, `endue-id@<host>` for any other, so a development session
/// never replaces the real one.
fn account_for(platform_url: &str) -> String {
    if platform_url == DEFAULT_PLATFORM_URL {
        return ACCOUNT.to_owned();
    }
    let rest = platform_url
        .split_once("://")
        .map_or(platform_url, |(_, rest)| rest);
    let host = rest.split('/').next().unwrap_or(rest);
    format!("{ACCOUNT}@{host}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keychain_account_follows_the_platform() {
        assert_eq!(account_for(DEFAULT_PLATFORM_URL), "endue-id");
        assert_eq!(
            account_for("https://platform.dev.endue.ai"),
            "endue-id@platform.dev.endue.ai"
        );
        assert_eq!(
            account_for("http://127.0.0.1:4100/base"),
            "endue-id@127.0.0.1:4100"
        );
    }
}
