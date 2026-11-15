//! A keychain in memory, for tests here and in the crates above. It follows the OS keychain's rules:
//! a missing secret reads as `None`, deleting nothing is fine, and `unavailable` answers every call
//! with `unsupported`, as a desk without a Secret Service would.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

use super::Keychain;
use crate::{Error, ErrorCode};

#[derive(Debug, Default)]
pub struct FakeKeychain {
    secrets: Mutex<BTreeMap<String, String>>,
    unavailable: bool,
}

impl FakeKeychain {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every call fails with `unsupported`; nothing is kept.
    pub fn unavailable() -> Self {
        Self {
            unavailable: true,
            ..Self::default()
        }
    }

    /// Every account with a secret kept, and the secret.
    pub fn secrets(&self) -> BTreeMap<String, String> {
        self.lock().clone()
    }

    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, String>> {
        self.secrets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn answer(&self) -> Result<(), Error> {
        if self.unavailable {
            return Err(Error::new(
                ErrorCode::Unsupported,
                "the fake keychain does not answer",
            ));
        }
        Ok(())
    }
}

impl Keychain for FakeKeychain {
    fn get(&self, account: &str) -> Result<Option<String>, Error> {
        self.answer()?;
        Ok(self.lock().get(account).cloned())
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), Error> {
        self.answer()?;
        self.lock().insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn delete(&self, account: &str) -> Result<(), Error> {
        self.answer()?;
        self.lock().remove(account);
        Ok(())
    }
}
