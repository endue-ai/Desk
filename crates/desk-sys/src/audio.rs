//! Audio primitives: the microphone (cpal) and the wake-word interface. Captured audio never leaves
//! the core; a `WakeDetector` listens to it. No engine ships yet: `NoWakeWord` never fires (ADR 0020).
//! No permission checks happen here: desk-core authorizes every call first.

use std::io;
use std::sync::mpsc;
use std::thread::JoinHandle;

/// Mono samples in [-1, 1] at the capture's sample rate.
pub type Frames<'a> = &'a [f32];

/// What a capture hands its samples to, with the sample rate they were taken at.
pub type OnFrames = Box<dyn FnMut(Frames<'_>, u32) + Send>;

/// Where samples come from. The system microphone in the app; a recording in tests.
pub trait Microphone: Send + Sync {
    /// Start delivering mono samples to `on_frames`, at `sample_rate` when the device can, until the
    /// returned `Capture` is dropped.
    fn open(&self, sample_rate: Option<u32>, on_frames: OnFrames) -> io::Result<Capture>;
}

/// A running capture. Dropping it closes the microphone.
pub struct Capture {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Capture {
    /// A capture run by `thread`, which must return once `stop` is dropped or sent to.
    pub fn new(stop: mpsc::Sender<()>, thread: JoinHandle<()>) -> Self {
        Self {
            stop: Some(stop),
            thread: Some(thread),
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// The wake word was heard.
#[derive(Debug, Clone, PartialEq)]
pub struct Detection {
    pub word: String,
    /// In [0, 1].
    pub confidence: f32,
}

/// Listens for the wake word in a stream of mono samples. One detector per capture.
pub trait WakeDetector: Send {
    fn feed(&mut self, frames: Frames<'_>, sample_rate: u32) -> Option<Detection>;
}

/// The detector until a wake-word engine is chosen: it never hears anything.
#[derive(Debug, Default)]
pub struct NoWakeWord;

impl WakeDetector for NoWakeWord {
    fn feed(&mut self, _frames: Frames<'_>, _sample_rate: u32) -> Option<Detection> {
        None
    }
}

/// The default input device, through cpal (feature `microphone`).
#[cfg(feature = "microphone")]
#[derive(Debug, Default)]
pub struct SystemMicrophone;

#[cfg(feature = "microphone")]
impl Microphone for SystemMicrophone {
    fn open(&self, sample_rate: Option<u32>, on_frames: OnFrames) -> io::Result<Capture> {
        // Some platforms' streams cannot leave the thread that built them, so one thread owns it.
        let (ready, started) = mpsc::channel();
        let (stop, stopped) = mpsc::channel::<()>();
        let thread = std::thread::Builder::new()
            .name("desk-microphone".to_owned())
            .spawn(move || match device_stream(sample_rate, on_frames) {
                Ok(stream) => {
                    let _ = ready.send(Ok(()));
                    let _ = stopped.recv();
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready.send(Err(e));
                }
            })?;
        started
            .recv()
            .map_err(|_| io::Error::other("the microphone thread ended"))??;
        Ok(Capture::new(stop, thread))
    }
}

#[cfg(feature = "microphone")]
fn device_stream(wanted: Option<u32>, mut on_frames: OnFrames) -> io::Result<cpal::Stream> {
    use cpal::SampleFormat;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no microphone"))?;
    let mut supported = device.default_input_config().map_err(io::Error::other)?;
    if let Some(rate) = wanted {
        let fits = device
            .supported_input_configs()
            .map_err(io::Error::other)?
            .find(|c| {
                c.sample_format() == supported.sample_format()
                    && (c.min_sample_rate()..=c.max_sample_rate()).contains(&rate)
            });
        if let Some(range) = fits {
            supported = range.with_sample_rate(rate);
        }
    }
    let channels = usize::from(supported.channels().max(1));
    let rate = supported.sample_rate();
    let config = supported.config();
    let (mut interleaved, mut mono) = (Vec::new(), Vec::new());
    let mut deliver = move |samples: &mut dyn Iterator<Item = f32>| {
        interleaved.clear();
        interleaved.extend(samples);
        mono.clear();
        mono.extend(
            interleaved
                .chunks(channels)
                .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32),
        );
        on_frames(&mono, rate);
    };
    let errors = |e| eprintln!("desk-sys: microphone error: {e}");
    let stream = match supported.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], _: &_| deliver(&mut data.iter().copied()),
            errors,
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            config,
            move |data: &[i16], _: &_| {
                deliver(&mut data.iter().map(|&s| f32::from(s) / f32::from(i16::MAX)))
            },
            errors,
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            config,
            move |data: &[u16], _: &_| {
                deliver(&mut data.iter().map(|&s| (f32::from(s) - 32768.0) / 32768.0))
            },
            errors,
            None,
        ),
        other => {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                format!("the microphone's sample format {other} is not supported"),
            ));
        }
    }
    .map_err(io::Error::other)?;
    stream.play().map_err(io::Error::other)?;
    Ok(stream)
}
