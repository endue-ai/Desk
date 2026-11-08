//! Microphone capture: list the input devices and capture one as mono 16-bit PCM frames of 20 ms, each
//! with its level. Who may capture is decided above this crate; here an input refuses with
//! `permission_denied` until the OS grants the microphone, without opening a device, while `devices`
//! lists names and formats without it.
//!
//! Every capture runs the same pipeline (`pipeline`): the device's callback only copies into a queue
//! holding one second of input and never blocks, and one worker thread per capture averages the
//! channels into mono, resamples (`resample`), cuts frames, meters them and calls `on_event`.
//!
//! `os()` is cpal (CoreAudio, WASAPI, ALSA) with AVFoundation's grant on macOS; `fake` is an input in
//! memory for tests, here and in the crates above.

use std::any::Any;
use std::sync::{Mutex, MutexGuard};

use crate::{Error, ErrorCode};

#[cfg(target_os = "macos")]
mod avfoundation;
pub mod fake;
mod pipeline;
mod resample;
mod system;

/// The sample rate a capture delivers unless asked for another, what speech recognition expects.
pub const DEFAULT_SAMPLE_RATE: u32 = 16_000;
/// The rates a capture may ask for, as the bridge's `sampleRate`.
pub const SAMPLE_RATES: std::ops::RangeInclusive<u32> = 8_000..=48_000;

/// Whether the OS lets the desk hear the microphone; `AVAuthorizationStatus` by name. Windows and
/// Linux give desktop programs no way to ask, so their input is always `Authorized`, and a capture
/// the OS refuses (the privacy setting, the audio group) answers `permission_denied`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Authorization {
    /// Never asked: `request_access` shows the OS prompt.
    NotDetermined,
    /// A policy (parental controls, MDM) forbids the microphone.
    Restricted,
    /// The person said no; only the OS settings change it.
    Denied,
    /// Capturing is allowed.
    Authorized,
}

impl Authorization {
    /// Whether an input may open a device with this authorization.
    pub fn can_capture(self) -> bool {
        self == Self::Authorized
    }
}

/// A microphone, or any other device that records.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InputDevice {
    /// cpal's device id as a string (`<host>:<id>`), stable across restarts, so a setting may keep it.
    pub id: String,
    /// The name the OS shows for it.
    pub name: String,
    /// Whether it is the OS's default input. At most one device is.
    pub default: bool,
    /// Its own sample rate, which a capture converts from.
    pub sample_rate: u32,
    /// Its own channel count, which a capture averages into mono.
    pub channels: u16,
}

/// What to capture.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CaptureOptions {
    /// An `InputDevice::id`; the default input when `None`.
    pub device: Option<String>,
    /// Samples per second of the frames, in `SAMPLE_RATES`; `DEFAULT_SAMPLE_RATE` by default.
    pub sample_rate: u32,
}

impl Default for CaptureOptions {
    fn default() -> Self {
        Self {
            device: None,
            sample_rate: DEFAULT_SAMPLE_RATE,
        }
    }
}

/// How loud one frame is, in dBFS: a full-scale sine reads −3.01 RMS and 0 peak. Silence reads
/// `SILENCE_DB` for both.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Level {
    pub rms_db: f32,
    pub peak_db: f32,
}

/// The floor of `Level`, what digital silence reads.
pub const SILENCE_DB: f32 = -100.0;

/// 20 ms of mono signed 16-bit PCM (LINEAR16) at the capture's rate: `sample_rate / 50` samples.
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub samples: Vec<i16>,
    pub level: Level,
    /// Milliseconds since the capture started, of the first sample. Input the queue had no room for
    /// shows as a gap.
    pub at_ms: u64,
}

/// What a capture reports, in order. `End` comes once and last: `None` after `stop` or a drop, the
/// error when the device failed or vanished (`io_error`).
#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Frame(Frame),
    End(Option<Error>),
}

/// What `capture` takes. It runs on the capture's own thread, which a slow callback holds up without
/// ever blocking the device; it is dropped after `End`.
pub type OnEvent = Box<dyn FnMut(Event) + Send>;

/// The microphones. Nothing reaches a device before the OS grants the microphone.
pub trait AudioInput: Send + Sync {
    /// The current authorization. Never prompts.
    fn authorization(&self) -> Authorization;
    /// Ask the OS for the microphone, showing its prompt if the person was never asked, and block
    /// until it answers. Returns the authorization afterwards; a refusal stays.
    fn request_access(&self) -> Result<Authorization, Error>;
    /// The input devices, the default first and the rest by name. Needs no grant: no audio is read.
    fn devices(&self) -> Result<Vec<InputDevice>, Error>;
    /// Open `options.device` (the default input when `None`) at its own format and start delivering
    /// frames to `on_event`. A rate outside `SAMPLE_RATES` is `invalid_params`; then, without opening
    /// anything, `permission_denied` unless `authorization()` is `Authorized`; an unknown device, or
    /// no default input, is `not_found`. Each capture opens its own stream.
    fn capture(&self, options: &CaptureOptions, on_event: OnEvent) -> Result<Capture, Error>;
}

/// The OS input: cpal's default host, with AVFoundation's microphone grant on macOS. The app needs
/// `NSMicrophoneUsageDescription` in its Info.plist before it calls `request_access` there.
pub fn os() -> Result<Box<dyn AudioInput>, Error> {
    Ok(Box::new(system::System))
}

/// A running capture. `stop` and a drop end it alike.
pub struct Capture {
    running: Mutex<Option<Running>>,
}

// The core keeps captures in its state and stops them from any thread.
const _: fn() = || {
    fn shared<T: Send + Sync>() {}
    shared::<Capture>();
};

struct Running {
    /// The device side: the cpal stream, or the fake's registration. Dropping it stops the input.
    source: Box<dyn Any + Send>,
    worker: pipeline::Worker,
}

impl Capture {
    fn new(source: Box<dyn Any + Send>, worker: pipeline::Worker) -> Self {
        Self {
            running: Mutex::new(Some(Running { source, worker })),
        }
    }

    /// Stop the device, deliver every complete frame already captured (a partial last one is
    /// dropped), then `End(None)`, and wait until `on_event` has been dropped, unless called from
    /// it. Stopping again does nothing; after a device failure, which already sent `End`, it only
    /// closes the device.
    pub fn stop(&self) {
        let running = self.lock().take();
        if let Some(Running { source, worker }) = running {
            drop(source);
            worker.finish();
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<Running>> {
        self.running.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The checks every input makes before it reaches a device: the rate, then the OS grant.
fn check(options: &CaptureOptions, authorization: Authorization) -> Result<(), Error> {
    if !SAMPLE_RATES.contains(&options.sample_rate) {
        return Err(Error::new(
            ErrorCode::InvalidParams,
            format!(
                "a capture's sample rate is 8000 to 48000 Hz, not {}",
                options.sample_rate
            ),
        ));
    }
    if !authorization.can_capture() {
        return Err(Error::new(
            ErrorCode::PermissionDenied,
            format!("capturing needs the OS's microphone permission; it is {authorization:?}"),
        ));
    }
    Ok(())
}

/// The `not_found` for an unknown device, or for no default input when `device` is `None`.
fn not_found(device: Option<&str>) -> Error {
    match device {
        Some(id) => Error::new(ErrorCode::NotFound, format!("no input device {id:?}")),
        None => Error::new(ErrorCode::NotFound, "there is no default input device"),
    }
}

/// The default first, then by name, then by id.
fn sort_devices(devices: &mut [InputDevice]) {
    devices.sort_by(|a, b| {
        b.default
            .cmp(&a.default)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
}
