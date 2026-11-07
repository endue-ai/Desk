//! Login items in memory, for tests here and in the crates above. It follows the same rules as the
//! OS backends: one registration, replaced by `register`, a missing one read as `None`, removing
//! nothing is fine, and a failed write keeps what was registered.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use super::{LoginItems, Registration, text};
use crate::{Error, ErrorCode};

/// `LoginItems` that keep one registration and count the writes that changed it. Starts empty;
/// `failing` makes every `register` and `unregister` an `io_error` that changes nothing, as a
/// folder or registry key the desk cannot write would.
#[derive(Debug, Default)]
pub struct FakeLoginItems {
    registration: Mutex<Option<Registration>>,
    writes: AtomicUsize,
    failing: bool,
}

impl FakeLoginItems {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts with `registration` registered, as if written before; it is not counted as a write.
    pub fn with_registration(self, registration: Registration) -> Self {
        *self.lock() = Some(registration);
        self
    }

    /// Every write fails with `io_error`; reads still answer.
    pub fn failing(mut self) -> Self {
        self.failing = true;
        self
    }

    /// What is registered now.
    pub fn registration(&self) -> Option<Registration> {
        self.lock().clone()
    }

    /// How many `register` and `unregister` calls succeeded.
    pub fn writes(&self) -> usize {
        self.writes.load(Ordering::SeqCst)
    }

    fn write(&self, registration: Option<Registration>) -> Result<(), Error> {
        if self.failing {
            return Err(Error::new(
                ErrorCode::IoError,
                "fake login items: told to fail",
            ));
        }
        *self.lock() = registration;
        self.writes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn lock(&self) -> MutexGuard<'_, Option<Registration>> {
        self.registration.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl LoginItems for FakeLoginItems {
    fn name(&self) -> &'static str {
        "fake"
    }

    fn location(&self) -> String {
        "memory".to_owned()
    }

    fn registered(&self) -> Result<Option<Registration>, Error> {
        Ok(self.registration())
    }

    fn register(&self, registration: &Registration) -> Result<(), Error> {
        text(registration)?;
        self.write(Some(registration.clone()))
    }

    fn unregister(&self) -> Result<(), Error> {
        self.write(None)
    }
}
