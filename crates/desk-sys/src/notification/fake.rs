//! A notifier in memory, for tests here and in the crates above. It follows the same rules as the OS
//! notifiers: nothing is posted before the OS allows it, posting never prompts, a refusal is never
//! asked again, and only a posted notification can be clicked.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use super::{Authorization, Click, ClickHandler, ClickSlot, Notification, Notifier, denied};
use crate::Error;

/// A `Notifier` that keeps what it posts. Starts `NotDetermined`, as a desk the OS never asked about;
/// `request_authorization` turns that into the answer set by `with_answer` (`Authorized` unless
/// changed) and leaves every other authorization as it is, as the OS does.
pub struct FakeNotifier {
    authorization: Mutex<Authorization>,
    answer: Authorization,
    posted: Mutex<Vec<Notification>>,
    prompts: AtomicUsize,
    clicks: ClickSlot,
}

impl FakeNotifier {
    pub fn new() -> Self {
        Self {
            authorization: Mutex::new(Authorization::NotDetermined),
            answer: Authorization::Authorized,
            posted: Mutex::new(Vec::new()),
            prompts: AtomicUsize::new(0),
            clicks: ClickSlot::default(),
        }
    }

    pub fn with_authorization(self, authorization: Authorization) -> Self {
        *lock(&self.authorization) = authorization;
        self
    }

    /// What the person answers the prompt `request_authorization` shows.
    pub fn with_answer(mut self, answer: Authorization) -> Self {
        self.answer = answer;
        self
    }

    /// Every notification posted, in order.
    pub fn posted(&self) -> Vec<Notification> {
        lock(&self.posted).clone()
    }

    /// How many times the OS prompt was shown.
    pub fn prompts(&self) -> usize {
        self.prompts.load(Ordering::SeqCst)
    }

    /// The person clicks the notification posted with `id`: the handler is called, on this thread,
    /// if there is one and `id` was posted.
    pub fn click(&self, id: &str) {
        if lock(&self.posted).iter().any(|posted| posted.id == id) {
            self.clicks.fire(Click { id: id.to_owned() });
        }
    }
}

impl Default for FakeNotifier {
    fn default() -> Self {
        Self::new()
    }
}

impl Notifier for FakeNotifier {
    fn authorization(&self) -> Authorization {
        *lock(&self.authorization)
    }

    fn request_authorization(&self) -> Result<Authorization, Error> {
        let mut authorization = lock(&self.authorization);
        if *authorization == Authorization::NotDetermined {
            self.prompts.fetch_add(1, Ordering::SeqCst);
            *authorization = self.answer;
        }
        Ok(*authorization)
    }

    fn post(&self, notification: &Notification) -> Result<(), Error> {
        let authorization = self.authorization();
        if !authorization.can_post() {
            return Err(denied(authorization));
        }
        lock(&self.posted).push(notification.clone());
        Ok(())
    }

    fn on_click(&self, handler: ClickHandler) {
        self.clicks.set(handler);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
