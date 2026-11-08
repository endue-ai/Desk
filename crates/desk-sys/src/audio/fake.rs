//! An input in memory, for tests here and in the crates above. It follows the same rules as the OS
//! input and runs the same pipeline: nothing opens before the OS grants the microphone, devices list
//! the default first, and the test plays the device's part, pushing samples as cpal's callback would.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use super::pipeline::{self, Feed};
use super::{
    AudioInput, Authorization, Capture, CaptureOptions, InputDevice, OnEvent, check, not_found,
    sort_devices,
};
use crate::Error;

/// An `AudioInput` over the devices it was given. Starts `Authorized`; `request_access` turns
/// `NotDetermined` into the answer set by `with_answer` (`Authorized` unless changed) and leaves
/// every other authorization as it is, as the OS does.
pub struct FakeInput {
    authorization: Mutex<Authorization>,
    answer: Authorization,
    devices: Vec<InputDevice>,
    open: Arc<Mutex<Vec<Open>>>,
    opened: Mutex<BTreeMap<String, usize>>,
    keys: AtomicU64,
}

/// A capture open on a device.
struct Open {
    key: u64,
    device: String,
    feed: Feed,
}

/// Removes its capture from the device when dropped, as stopping a cpal stream does.
struct Registration {
    open: Arc<Mutex<Vec<Open>>>,
    key: u64,
}

impl Drop for Registration {
    fn drop(&mut self) {
        lock(&self.open).retain(|open| open.key != self.key);
    }
}

impl FakeInput {
    pub fn new() -> Self {
        Self {
            authorization: Mutex::new(Authorization::Authorized),
            answer: Authorization::Authorized,
            devices: Vec::new(),
            open: Arc::default(),
            opened: Mutex::default(),
            keys: AtomicU64::new(0),
        }
    }

    pub fn with_authorization(self, authorization: Authorization) -> Self {
        *lock(&self.authorization) = authorization;
        self
    }

    /// What the person answers the prompt `request_access` shows.
    pub fn with_answer(mut self, answer: Authorization) -> Self {
        self.answer = answer;
        self
    }

    /// The devices, each with its own rate and channel count; `default` marks the default input.
    pub fn with_devices(mut self, devices: Vec<InputDevice>) -> Self {
        self.devices = devices;
        self
    }

    /// Feed interleaved samples (-1.0 to 1.0, the device's channels in turn) to every capture open on
    /// `device`, as cpal's callback does. Never blocks; a capture whose queue is full drops them.
    pub fn push(&self, device: &str, samples: &[f32]) {
        for open in lock(&self.open).iter().filter(|open| open.device == device) {
            open.feed.push(samples, |sample| sample);
        }
    }

    /// The device fails: every capture open on it ends with `error` after what was pushed before.
    pub fn fail(&self, device: &str, error: Error) {
        for open in lock(&self.open).iter().filter(|open| open.device == device) {
            open.feed.fail(error.clone());
        }
    }

    /// How many captures are open on `device` now.
    pub fn open_captures(&self, device: &str) -> usize {
        lock(&self.open)
            .iter()
            .filter(|open| open.device == device)
            .count()
    }

    /// How many captures were ever opened on `device`.
    pub fn captures_opened(&self, device: &str) -> usize {
        lock(&self.opened).get(device).copied().unwrap_or(0)
    }

    fn find(&self, id: Option<&str>) -> Result<&InputDevice, Error> {
        let found = match id {
            Some(id) => self.devices.iter().find(|device| device.id == id),
            None => self.devices.iter().find(|device| device.default),
        };
        found.ok_or_else(|| not_found(id))
    }
}

impl Default for FakeInput {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioInput for FakeInput {
    fn authorization(&self) -> Authorization {
        *lock(&self.authorization)
    }

    fn request_access(&self) -> Result<Authorization, Error> {
        let mut authorization = lock(&self.authorization);
        if *authorization == Authorization::NotDetermined {
            *authorization = self.answer;
        }
        Ok(*authorization)
    }

    fn devices(&self) -> Result<Vec<InputDevice>, Error> {
        let mut devices = self.devices.clone();
        sort_devices(&mut devices);
        Ok(devices)
    }

    fn capture(&self, options: &CaptureOptions, on_event: OnEvent) -> Result<Capture, Error> {
        check(options, self.authorization())?;
        let device = self.find(options.device.as_deref())?;
        let (feed, pending) =
            pipeline::prepare(device.sample_rate, device.channels, options.sample_rate)?;
        let key = self.keys.fetch_add(1, Ordering::Relaxed);
        let registration = Registration {
            open: Arc::clone(&self.open),
            key,
        };
        let worker = pending.start(on_event)?;
        lock(&self.open).push(Open {
            key,
            device: device.id.clone(),
            feed,
        });
        *lock(&self.opened).entry(device.id.clone()).or_default() += 1;
        Ok(Capture::new(Box::new(registration), worker))
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
