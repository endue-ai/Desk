//! The pipeline every capture runs, the cpal backend's and the fake's alike.
//!
//! The device's side, `Feed`, copies each callback's samples into a channel and never blocks: when
//! the queue already holds one second of input it drops the new samples, which shows as a gap in
//! `at_ms`. One worker thread per capture (`desk-audio`) takes them in order, averages the channels
//! into mono, resamples to the capture's rate, cuts frames of `rate / 50` samples, meters each and
//! calls `on_event`; `End` comes last, and `on_event` is dropped with the thread.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use super::resample::Resampler;
use super::{Event, Frame, Level, OnEvent, SILENCE_DB};
use crate::{Error, ErrorCode};

enum Message {
    /// Interleaved samples whose first is input sample `at`, counted from 0 across channels.
    Audio {
        at: u64,
        samples: Vec<f32>,
    },
    Fail(Error),
    Stop,
}

/// The device's side of a capture, what its callback calls. Clones share the queue.
#[derive(Clone)]
pub(super) struct Feed {
    sender: Sender<Message>,
    /// Samples sent and not yet taken by the worker.
    queued: Arc<AtomicUsize>,
    /// The input index of the next sample the device delivers, dropped samples included.
    next: Arc<AtomicU64>,
    /// One second of input, interleaved.
    capacity: usize,
}

impl Feed {
    /// Queue one callback's interleaved samples, converted to `f32` by `convert`, or drop them when
    /// the queue is full or the capture has ended. Never blocks.
    pub(super) fn push<T: Copy>(&self, data: &[T], convert: impl Fn(T) -> f32) {
        let len = data.len();
        let at = self.next.fetch_add(len as u64, Ordering::Relaxed);
        if self.queued.fetch_add(len, Ordering::AcqRel) + len > self.capacity {
            self.queued.fetch_sub(len, Ordering::AcqRel);
            return;
        }
        let samples = data.iter().map(|&sample| convert(sample)).collect();
        if self.sender.send(Message::Audio { at, samples }).is_err() {
            self.queued.fetch_sub(len, Ordering::AcqRel);
        }
    }

    /// End the capture with `error` once the samples queued before it are framed.
    pub(super) fn fail(&self, error: Error) {
        let _ = self.sender.send(Message::Fail(error));
    }
}

/// A capture whose device side exists and whose worker has not started. Dropping it calls nothing.
pub(super) struct Pending {
    sender: Sender<Message>,
    receiver: Receiver<Message>,
    queued: Arc<AtomicUsize>,
    framer: Framer,
}

/// The running worker. Finishing or dropping it ends the capture.
pub(super) struct Worker {
    sender: Sender<Message>,
    thread: Option<JoinHandle<()>>,
}

/// A feed for a device at `device_rate` with `channels`, framing at `rate`.
pub(super) fn prepare(
    device_rate: u32,
    channels: u16,
    rate: u32,
) -> Result<(Feed, Pending), Error> {
    if device_rate == 0 || channels == 0 {
        return Err(Error::new(
            ErrorCode::IoError,
            format!("the device reports {device_rate} Hz with {channels} channels"),
        ));
    }
    let (sender, receiver) = mpsc::channel();
    let queued = Arc::new(AtomicUsize::new(0));
    let feed = Feed {
        sender: sender.clone(),
        queued: Arc::clone(&queued),
        next: Arc::new(AtomicU64::new(0)),
        capacity: device_rate as usize * usize::from(channels),
    };
    let framer = Framer::new(device_rate, channels, rate);
    let pending = Pending {
        sender,
        receiver,
        queued,
        framer,
    };
    Ok((feed, pending))
}

impl Pending {
    /// Start the worker. Samples the feed queued before this are framed first.
    pub(super) fn start(self, on_event: OnEvent) -> Result<Worker, Error> {
        let Pending {
            sender,
            receiver,
            queued,
            framer,
        } = self;
        let thread = thread::Builder::new()
            .name("desk-audio".to_owned())
            .spawn(move || run(&receiver, &queued, framer, on_event))
            .map_err(|err| Error::io(&err, "the desk-audio thread"))?;
        Ok(Worker {
            sender,
            thread: Some(thread),
        })
    }
}

impl Worker {
    /// Frame what is queued, send `End(None)` unless the capture already ended, and wait for the
    /// thread unless this is it (`on_event` dropping its own capture).
    pub(super) fn finish(mut self) {
        self.end();
    }

    fn end(&mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = self.sender.send(Message::Stop);
            if thread.thread().id() != thread::current().id() {
                let _ = thread.join();
            }
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.end();
    }
}

fn run(
    receiver: &Receiver<Message>,
    queued: &AtomicUsize,
    mut framer: Framer,
    mut on_event: OnEvent,
) {
    let error = loop {
        match receiver.recv() {
            Ok(Message::Audio { at, samples }) => {
                queued.fetch_sub(samples.len(), Ordering::AcqRel);
                framer.push(at, &samples, &mut on_event);
            }
            Ok(Message::Fail(error)) => break Some(error),
            Ok(Message::Stop) | Err(_) => {
                framer.flush(&mut on_event);
                break None;
            }
        }
    };
    on_event(Event::End(error));
}

/// Turns interleaved device samples into frames.
struct Framer {
    channels: usize,
    from: u64,
    to: u64,
    size: usize,
    /// `None` when the device already runs at the capture's rate.
    resampler: Option<Resampler>,
    /// The input index the next contiguous samples start at.
    expected: u64,
    /// The start of a device frame whose other channels have not arrived.
    carry: Vec<f32>,
    mono: Vec<f32>,
    /// Output samples not framed yet; the first is output sample `out_at`.
    out: Vec<f32>,
    out_at: u64,
}

impl Framer {
    fn new(device_rate: u32, channels: u16, rate: u32) -> Self {
        Self {
            channels: usize::from(channels),
            from: u64::from(device_rate),
            to: u64::from(rate),
            size: (rate / 50) as usize,
            resampler: (device_rate != rate).then(|| Resampler::new(device_rate, rate)),
            expected: 0,
            carry: Vec::new(),
            mono: Vec::new(),
            out: Vec::new(),
            out_at: 0,
        }
    }

    fn push(&mut self, at: u64, samples: &[f32], on_event: &mut OnEvent) {
        if at > self.expected {
            // Input was dropped: finish what came before the gap, and start again after it.
            self.flush(on_event);
            self.restart(at);
        }
        self.expected = at + samples.len() as u64;
        self.carry.extend_from_slice(samples);
        let whole = self.carry.len() / self.channels * self.channels;
        let channels = self.channels as f32;
        self.mono.clear();
        let frames = self.carry[..whole].chunks_exact(self.channels);
        self.mono
            .extend(frames.map(|frame| frame.iter().sum::<f32>() / channels));
        self.carry.drain(..whole);
        match &mut self.resampler {
            Some(resampler) => resampler.process(&self.mono, &mut self.out),
            None => self.out.extend_from_slice(&self.mono),
        }
        self.emit(on_event);
    }

    /// Frame everything the input so far yields; a partial last frame stays behind.
    fn flush(&mut self, on_event: &mut OnEvent) {
        if let Some(resampler) = &mut self.resampler {
            resampler.flush(&mut self.out);
        }
        self.emit(on_event);
    }

    /// Start over at input index `at`: a partial frame is dropped and the filter starts afresh.
    fn restart(&mut self, at: u64) {
        let frame = at / self.channels as u64;
        self.out_at = (frame * self.to).div_ceil(self.from);
        self.out.clear();
        self.carry.clear();
        if self.resampler.is_some() {
            self.resampler = Some(Resampler::new(self.from as u32, self.to as u32));
        }
    }

    fn emit(&mut self, on_event: &mut OnEvent) {
        let mut start = 0;
        while self.out.len() - start >= self.size {
            let samples: Vec<i16> = self.out[start..start + self.size]
                .iter()
                .map(|&x| pcm(x))
                .collect();
            let level = level(&samples);
            let at_ms = self.out_at * 1000 / self.to;
            self.out_at += self.size as u64;
            start += self.size;
            on_event(Event::Frame(Frame {
                samples,
                level,
                at_ms,
            }));
        }
        self.out.drain(..start);
    }
}

/// A sample in -1.0..=1.0 as 16-bit PCM, rounded and clipped.
fn pcm(sample: f32) -> i16 {
    (sample * 32768.0).round().clamp(-32768.0, 32767.0) as i16
}

/// RMS and peak relative to full scale (32768), in dBFS.
fn level(samples: &[i16]) -> Level {
    let (mut sum, mut peak) = (0.0f64, 0.0f64);
    for &sample in samples {
        let x = f64::from(sample) / 32768.0;
        sum += x * x;
        peak = peak.max(x.abs());
    }
    let rms = (sum / samples.len().max(1) as f64).sqrt();
    Level {
        rms_db: dbfs(rms),
        peak_db: dbfs(peak),
    }
}

fn dbfs(value: f64) -> f32 {
    if value > 0.0 {
        (20.0 * value.log10()).max(f64::from(SILENCE_DB)) as f32
    } else {
        SILENCE_DB
    }
}
