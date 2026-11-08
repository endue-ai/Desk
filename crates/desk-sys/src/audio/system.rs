//! The OS input over cpal's default host: CoreAudio on macOS, WASAPI on Windows, ALSA on Linux. A
//! capture opens the device's default input config, its own rate, channels and sample format, and
//! hands each callback's samples, converted to `f32`, to the pipeline; the callback does nothing else.
//!
//! macOS asks for the microphone through AVFoundation (`avfoundation`). Windows and Linux have no
//! prompt for desktop programs: they are `Authorized`, and a stream the OS refuses is
//! `permission_denied`.

use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{ErrorKind, Sample, SampleFormat};

use super::pipeline::{self, Feed};
use super::{
    AudioInput, Authorization, Capture, CaptureOptions, InputDevice, OnEvent, check, not_found,
    sort_devices,
};
use crate::{Error, ErrorCode};

/// How long cpal may take to open a stream, where the backend honours it.
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) struct System;

// The stream is the capture's device side, which only needs to move between threads.
const _: fn() = || {
    fn send<T: Send + 'static>() {}
    send::<cpal::Stream>();
};

impl AudioInput for System {
    #[cfg(target_os = "macos")]
    fn authorization(&self) -> Authorization {
        super::avfoundation::authorization()
    }

    #[cfg(not(target_os = "macos"))]
    fn authorization(&self) -> Authorization {
        Authorization::Authorized
    }

    #[cfg(target_os = "macos")]
    fn request_access(&self) -> Result<Authorization, Error> {
        super::avfoundation::request_access()
    }

    #[cfg(not(target_os = "macos"))]
    fn request_access(&self) -> Result<Authorization, Error> {
        Ok(Authorization::Authorized)
    }

    /// Devices whose id or default input config cpal cannot read are left out.
    fn devices(&self) -> Result<Vec<InputDevice>, Error> {
        let host = cpal::default_host();
        let default = host
            .default_input_device()
            .and_then(|device| device.id().ok());
        let inputs = host
            .input_devices()
            .map_err(|err| failed(&err, "listing the input devices"))?;
        let mut devices = Vec::new();
        for device in inputs {
            let (Ok(id), Ok(config)) = (device.id(), device.default_input_config()) else {
                continue;
            };
            let name = match device.description() {
                Ok(description) => description.name().to_owned(),
                Err(_) => id.to_string(),
            };
            devices.push(InputDevice {
                default: default.as_ref() == Some(&id),
                id: id.to_string(),
                name,
                sample_rate: config.sample_rate(),
                channels: config.channels(),
            });
        }
        sort_devices(&mut devices);
        Ok(devices)
    }

    fn capture(&self, options: &CaptureOptions, on_event: OnEvent) -> Result<Capture, Error> {
        check(options, self.authorization())?;
        let host = cpal::default_host();
        let wanted = options.device.as_deref();
        let device = match wanted {
            Some(id) => id
                .parse::<cpal::DeviceId>()
                .ok()
                .and_then(|id| host.device_by_id(&id)),
            None => host.default_input_device(),
        }
        .ok_or_else(|| not_found(wanted))?;
        let config = device
            .default_input_config()
            .map_err(|err| opening(&err, wanted))?;
        let (feed, pending) =
            pipeline::prepare(config.sample_rate(), config.channels(), options.sample_rate)?;
        let stream = open(&device, &config, feed).map_err(|err| opening(&err, wanted))?;
        stream.play().map_err(|err| opening(&err, wanted))?;
        let worker = pending.start(on_event)?;
        Ok(Capture::new(Box::new(stream), worker))
    }
}

/// Build the input stream in the device's own sample format.
fn open(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    feed: Feed,
) -> Result<cpal::Stream, cpal::Error> {
    let errors = feed.clone();
    let on_error = move |err: cpal::Error| match err.kind() {
        // Rerouted, a glitch, or no real-time priority: the stream goes on.
        ErrorKind::DeviceChanged | ErrorKind::Xrun | ErrorKind::RealtimeDenied => {}
        _ => errors.fail(Error::new(
            ErrorCode::IoError,
            format!("the input device failed: {err}"),
        )),
    };
    macro_rules! build {
        ($sample:ty) => {
            device.build_input_stream::<$sample, _, _>(
                config.config(),
                move |data: &[$sample], _: &cpal::InputCallbackInfo| {
                    feed.push(data, |sample| sample.to_sample::<f32>())
                },
                on_error,
                Some(OPEN_TIMEOUT),
            )
        };
    }
    match config.sample_format() {
        SampleFormat::I8 => build!(i8),
        SampleFormat::I16 => build!(i16),
        SampleFormat::I24 => build!(cpal::I24),
        SampleFormat::I32 => build!(i32),
        SampleFormat::I64 => build!(i64),
        SampleFormat::U8 => build!(u8),
        SampleFormat::U16 => build!(u16),
        SampleFormat::U24 => build!(cpal::U24),
        SampleFormat::U32 => build!(u32),
        SampleFormat::U64 => build!(u64),
        SampleFormat::F32 => build!(f32),
        SampleFormat::F64 => build!(f64),
        other => Err(cpal::Error::with_message(
            ErrorKind::UnsupportedConfig,
            format!("{other} samples cannot be captured"),
        )),
    }
}

/// An error opening `device`: the OS's refusal is `permission_denied`, a device gone `not_found`.
fn opening(err: &cpal::Error, device: Option<&str>) -> Error {
    match err.kind() {
        ErrorKind::PermissionDenied => Error::new(
            ErrorCode::PermissionDenied,
            format!("the OS refused the microphone: {err}"),
        ),
        ErrorKind::DeviceNotAvailable => not_found(device),
        _ => failed(err, "opening the input device"),
    }
}

fn failed(err: &cpal::Error, doing: &str) -> Error {
    Error::new(ErrorCode::IoError, format!("{doing}: {err}"))
}
