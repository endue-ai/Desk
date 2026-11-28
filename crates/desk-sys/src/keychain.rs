//! Secrets in the OS keychain (ADR 0239): one string under a service and an account, read, written
//! and deleted. `os(service)` is keyring-core over the login Keychain on macOS, Credential Manager on
//! Windows and the Secret Service on Linux; `fake` keeps secrets in memory for tests, here and in the
//! crates above. A keychain that does not answer (no Secret Service, a locked or missing store) is
//! `unsupported`, so the caller can keep the secret elsewhere; any other failure is `io_error`.

use std::fmt;
use std::sync::Arc;

use keyring_core::{CredentialStore, Entry};

use crate::{Error, ErrorCode};

pub mod fake;

/// The service the desk's secrets are kept under: the app identifier.
pub const SERVICE: &str = "ai.endue.desktop";

/// A keychain for one service. A missing secret is `Ok(None)` and deleting one is fine.
pub trait Keychain: Send + Sync + fmt::Debug {
    /// The secret kept for `account`, if one is.
    fn get(&self, account: &str) -> Result<Option<String>, Error>;
    /// Keep `secret` for `account`, replacing what was kept.
    fn set(&self, account: &str, secret: &str) -> Result<(), Error>;
    /// Forget the secret kept for `account`; nothing kept is fine.
    fn delete(&self, account: &str) -> Result<(), Error>;
}

/// The OS keychain for `service`, or `unsupported` where this OS has none that answers.
pub struct OsKeychain {
    service: String,
    store: Arc<CredentialStore>,
}

impl fmt::Debug for OsKeychain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OsKeychain")
            .field("service", &self.service)
            .field("store", &self.store.vendor())
            .finish()
    }
}

/// The OS keychain for `service`. Nothing is read or written until the first call.
pub fn os(service: &str) -> Result<OsKeychain, Error> {
    let store = native_store().map_err(|err| failure(&err, "the OS keychain"))?;
    Ok(OsKeychain {
        service: service.to_owned(),
        store,
    })
}

#[cfg(target_os = "macos")]
fn native_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Ok(apple_native_keyring_store::keychain::Store::new()?)
}

#[cfg(windows)]
fn native_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Ok(windows_native_keyring_store::Store::new()?)
}

#[cfg(target_os = "linux")]
fn native_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Ok(zbus_secret_service_keyring_store::Store::new()?)
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn native_store() -> keyring_core::Result<Arc<CredentialStore>> {
    Err(keyring_core::Error::NoDefaultStore)
}

impl OsKeychain {
    fn entry(&self, account: &str) -> Result<Entry, Error> {
        self.store
            .build(&self.service, account, None)
            .map_err(|err| failure(&err, account))
    }
}

impl Keychain for OsKeychain {
    fn get(&self, account: &str) -> Result<Option<String>, Error> {
        match self.entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(err) => Err(failure(&err, account)),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), Error> {
        self.entry(account)?
            .set_password(secret)
            .map_err(|err| failure(&err, account))
    }

    fn delete(&self, account: &str) -> Result<(), Error> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(err) => Err(failure(&err, account)),
        }
    }
}

/// `unsupported` for a keychain that does not answer, `io_error` for anything else.
fn failure(err: &keyring_core::Error, context: &str) -> Error {
    use keyring_core::Error as K;
    let code = match err {
        K::NoStorageAccess(_) | K::NoDefaultStore | K::NotSupportedByStore(_) => {
            ErrorCode::Unsupported
        }
        // The Secret Service missing from D-Bus comes back as a platform failure.
        K::PlatformFailure(_) => ErrorCode::Unsupported,
        _ => ErrorCode::IoError,
    };
    Error::new(code, format!("{context}: {err}"))
}
