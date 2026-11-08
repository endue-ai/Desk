//! desk-sys microphone capture (feature `audio`): the `AudioInput` contract through `FakeInput`, which
//! runs the same pipeline as the cpal backend, and the OS input (cpal, AVFoundation's grant on macOS).
//!
//! No test here opens a microphone or asks the OS for one, except the ignored test people run by hand.

use std::f64::consts::TAU;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::thread;
use std::time::Duration;

use desk_sys::audio::fake::FakeInput;
use desk_sys::audio::{AudioInput, Authorization, Capture, CaptureOptions, Event, Frame};
use desk_sys::audio::{InputDevice, OnEvent};
use desk_sys::{Error, ErrorCode};

/// The watchdog: an event or a push that takes longer fails the test instead of hanging it.
const WAIT: Duration = Duration::from_secs(10);

fn device(id: &str, name: &str, default: bool, sample_rate: u32, channels: u16) -> InputDevice {
    let (id, name) = (id.to_owned(), name.to_owned());
    InputDevice {
        id,
        name,
        default,
        sample_rate,
        channels,
    }
}

/// A fake with one microphone, `fake:mic`, the default, at `rate` Hz with `channels` channels.
fn mic(rate: u32, channels: u16) -> FakeInput {
    FakeInput::new().with_devices(vec![device("fake:mic", "Microphone", true, rate, channels)])
}

fn at(sample_rate: u32) -> CaptureOptions {
    CaptureOptions {
        device: None,
        sample_rate,
    }
}

/// `seconds` of a sine at `hz` and `amplitude`, the same on every channel, interleaved.
fn tone(hz: f64, amplitude: f64, rate: u32, channels: u16, seconds: f64) -> Vec<f32> {
    let frames = (f64::from(rate) * seconds).round() as usize;
    let sample = |n: usize| amplitude * (TAU * (hz * n as f64 / f64::from(rate)).fract()).sin();
    (0..frames)
        .flat_map(|n| std::iter::repeat_n(sample(n) as f32, usize::from(channels)))
        .collect()
}

/// Feed `samples` to `fake:mic` the way cpal's callback does, 10 ms at a time.
fn push(input: &FakeInput, samples: &[f32]) {
    let mic = &input.devices().expect("devices")[0];
    let chunk = (mic.sample_rate as usize / 100).max(1) * usize::from(mic.channels);
    for part in samples.chunks(chunk) {
        input.push("fake:mic", part);
    }
}

fn sink() -> (OnEvent, Receiver<Event>) {
    let (sender, events) = mpsc::channel();
    let on_event: OnEvent = Box::new(move |event| {
        let _ = sender.send(event);
    });
    (on_event, events)
}

fn start(input: &dyn AudioInput, options: &CaptureOptions) -> (Capture, Receiver<Event>) {
    let (on_event, events) = sink();
    let capture = input.capture(options, on_event).expect("starts");
    (capture, events)
}

/// The error a capture answers instead of starting.
fn refused(input: &dyn AudioInput, options: &CaptureOptions) -> Error {
    let result = input.capture(options, Box::new(|_| {}));
    result.err().expect("refused")
}

/// The frames up to `End` and its error. Nothing may follow `End`: the callback is dropped with it.
fn until_end(events: &Receiver<Event>) -> (Vec<Frame>, Option<Error>) {
    let mut frames = Vec::new();
    loop {
        match events.recv_timeout(WAIT).expect("End arrives") {
            Event::Frame(frame) => frames.push(frame),
            Event::End(error) => {
                let after = events.recv_timeout(Duration::from_millis(500));
                assert_eq!(after.err(), Some(RecvTimeoutError::Disconnected));
                return (frames, error);
            }
        }
    }
}

/// Capture `samples` from `fake:mic` at `out` Hz, stop, and answer every frame.
fn run(input: &FakeInput, out: u32, samples: &[f32]) -> Vec<Frame> {
    let (capture, events) = start(input, &at(out));
    push(input, samples);
    capture.stop();
    let (frames, error) = until_end(&events);
    assert_eq!(error, None);
    frames
}

fn joined(frames: &[Frame]) -> Vec<i16> {
    frames.iter().flat_map(|f| f.samples.clone()).collect()
}

/// The frames without two at each end, where the filter starts and stops.
fn middle(frames: &[Frame]) -> &[Frame] {
    assert!(frames.len() > 8, "{} frames", frames.len());
    &frames[2..frames.len() - 2]
}

/// RMS relative to full scale.
fn rms(samples: &[i16]) -> f64 {
    let sum: f64 = samples.iter().map(|&s| f64::from(s).powi(2)).sum();
    (sum / samples.len() as f64).sqrt() / 32768.0
}

fn db(value: f64) -> f64 {
    20.0 * value.max(1e-10).log10()
}

fn close(value: f32, want: f64, within: f64) -> bool {
    (f64::from(value) - want).abs() <= within
}

#[test]
fn the_fake_input_lists_its_devices_default_first() {
    let array = device("fake:array", "Array Microphone", false, 44_100, 2);
    let input = FakeInput::new().with_devices(vec![
        device("fake:usb", "USB Microphone", false, 48_000, 1),
        array.clone(),
        device("fake:builtin", "Built-in Microphone", true, 48_000, 1),
    ]);
    let devices = input.devices().expect("devices");
    let ids: Vec<&str> = devices.iter().map(|d| d.id.as_str()).collect();
    assert_eq!(ids, ["fake:builtin", "fake:array", "fake:usb"]);
    assert_eq!(devices[1], array);
    assert!(devices[0].default && !devices[2].default);
    assert!(FakeInput::new().devices().expect("no devices").is_empty());
}

#[test]
fn a_capture_delivers_16_khz_mono_frames_of_20_ms() {
    assert_eq!(CaptureOptions::default(), at(16_000));
    let frames = run(&mic(48_000, 2), 16_000, &tone(440.0, 0.5, 48_000, 2, 1.0));
    assert!((49..=51).contains(&frames.len()), "{} frames", frames.len());
    for (i, frame) in frames.iter().enumerate() {
        assert_eq!(frame.samples.len(), 320);
        assert_eq!(frame.at_ms, 20 * i as u64);
    }
    let samples = joined(middle(&frames));
    let flips = |w: &&[i16]| (w[0] < 0) != (w[1] < 0);
    let crossings = samples.windows(2).filter(flips).count();
    let hz = crossings as f64 / 2.0 / (samples.len() as f64 / 16_000.0);
    assert!((hz / 440.0 - 1.0).abs() <= 0.02, "the tone reads {hz} Hz");
}

#[test]
fn every_device_rate_comes_out_at_the_rate_asked() {
    for rate in [8_000, 16_000, 22_050, 44_100, 48_000] {
        let input = mic(rate, 1);
        for out in [8_000, 16_000, 48_000] {
            let frames = run(&input, out, &tone(440.0, 0.5, rate, 1, 1.0));
            let size = out as usize / 50;
            let sized = frames.iter().all(|f| f.samples.len() == size);
            assert!(sized, "{rate} -> {out}");
            let off = (frames.len() * size).abs_diff(out as usize);
            assert!(off <= size, "{rate} -> {out}: {off} samples off");
        }
    }
    let ramp = |i: i32| ((i * 7_919) % 65_536 - 32_768) as i16;
    let pushed: Vec<i16> = (0..16_000).map(ramp).collect();
    let samples: Vec<f32> = pushed.iter().map(|&k| f32::from(k) / 32768.0).collect();
    let frames = run(&mic(16_000, 1), 16_000, &samples);
    assert_eq!(joined(&frames), pushed, "passed through");
}

#[test]
fn a_sample_rate_outside_8_to_48_khz_is_invalid_params() {
    let input = mic(48_000, 1);
    for rate in [0, 7_999, 48_001] {
        let err = refused(&input, &at(rate));
        assert_eq!(err.code, ErrorCode::InvalidParams, "{rate}: {err}");
    }
    assert_eq!(input.captures_opened("fake:mic"), 0);
    assert_eq!(input.open_captures("fake:mic"), 0);
}

#[test]
fn tones_above_the_output_nyquist_are_filtered_out() {
    let input = mic(48_000, 1);
    let level = |hz| {
        let frames = run(&input, 16_000, &tone(hz, 0.5, 48_000, 1, 1.0));
        db(rms(&joined(middle(&frames))))
    };
    let (pass, stop) = (level(1_000.0), level(12_000.0));
    assert!((pass + 9.03).abs() < 0.3, "1 kHz: {pass} dBFS");
    assert!(pass - stop >= 30.0, "12 kHz: {stop} dBFS");
}

#[test]
fn channels_are_averaged_into_mono() {
    let input = mic(48_000, 2);
    let one = tone(1_000.0, 0.5, 48_000, 1, 1.0);
    let opposite: Vec<f32> = one.iter().flat_map(|&s| [s, -s]).collect();
    let frames = run(&input, 16_000, &opposite);
    assert!(frames.len() >= 49);
    for frame in &frames {
        assert!(frame.samples.iter().all(|&s| s == 0), "{:?}", frame.at_ms);
        assert_eq!((frame.level.rms_db, frame.level.peak_db), (-100.0, -100.0));
    }
    let left: Vec<f32> = one.iter().flat_map(|&s| [s, 0.0]).collect();
    let frames = run(&input, 16_000, &left);
    let (got, want) = (rms(&joined(middle(&frames))), 0.5 / 2f64.sqrt() / 2.0);
    assert!((got / want - 1.0).abs() <= 0.01, "{got}, not {want}");
}

#[test]
fn the_level_meter_reads_rms_and_peak_in_dbfs() {
    let input = mic(48_000, 1);
    for (amplitude, want_rms, want_peak) in [(1.0, -3.0, 0.0), (0.1, -23.0, -20.0)] {
        let frames = run(&input, 16_000, &tone(1_000.0, amplitude, 48_000, 1, 1.0));
        for frame in middle(&frames) {
            let level = frame.level;
            assert!(close(level.rms_db, want_rms, 0.3), "{level:?}");
            assert!(close(level.peak_db, want_peak, 0.5), "{level:?}");
        }
    }
    let frames = run(&input, 16_000, &vec![0.0; 48_000]);
    assert_eq!(frames.len(), 50);
    for frame in &frames {
        assert_eq!((frame.level.rms_db, frame.level.peak_db), (-100.0, -100.0));
    }
}

#[test]
fn stopping_delivers_what_was_pushed_and_ends_once() {
    let input = mic(48_000, 2);
    let (capture, events) = start(&input, &at(16_000));
    // One second and 5 ms: fifty complete frames and a partial one, which is dropped.
    push(&input, &tone(440.0, 0.5, 48_000, 2, 1.005));
    capture.stop();
    let (frames, error) = until_end(&events);
    assert_eq!((frames.len(), error), (50, None));
    capture.stop();
    push(&input, &tone(440.0, 0.5, 48_000, 2, 0.1));
    drop(capture);
    assert_eq!(events.try_recv().err(), Some(TryRecvError::Disconnected));
    assert_eq!(input.open_captures("fake:mic"), 0);
}

#[test]
fn dropping_a_capture_stops_it() {
    let input = mic(16_000, 1);
    let (capture, events) = start(&input, &at(16_000));
    assert_eq!(input.open_captures("fake:mic"), 1);
    push(&input, &tone(440.0, 0.5, 16_000, 1, 0.1));
    drop(capture);
    let (frames, error) = until_end(&events);
    assert_eq!((frames.len(), error), (5, None));
    assert_eq!(input.open_captures("fake:mic"), 0);
    assert_eq!(input.captures_opened("fake:mic"), 1);
}

#[test]
fn a_failing_device_ends_the_capture_with_its_error() {
    let input = mic(16_000, 1);
    let (capture, events) = start(&input, &at(16_000));
    push(&input, &tone(440.0, 0.5, 16_000, 1, 0.1));
    let unplugged = Error::new(ErrorCode::IoError, "the microphone was unplugged");
    input.fail("fake:mic", unplugged.clone());
    push(&input, &tone(440.0, 0.5, 16_000, 1, 0.1));
    let (frames, error) = until_end(&events);
    assert_eq!(error, Some(unplugged));
    assert!(frames.len() <= 5, "{} frames", frames.len());
    capture.stop();
}

#[test]
fn an_unknown_or_missing_device_is_not_found() {
    let input = mic(16_000, 1);
    let named = |id: &str| CaptureOptions {
        device: Some(id.to_owned()),
        ..at(16_000)
    };
    let err = refused(&input, &named("nope"));
    assert_eq!(err.code, ErrorCode::NotFound, "{err}");
    let err = refused(&FakeInput::new(), &at(16_000));
    assert_eq!(err.code, ErrorCode::NotFound, "{err}");
    let (_capture, _events) = start(&input, &named("fake:mic"));
    assert_eq!(input.open_captures("fake:mic"), 1);
}

#[test]
fn capture_waits_for_the_os_grant_and_never_reaches_the_device_before() {
    let input = mic(16_000, 1).with_authorization(Authorization::NotDetermined);
    assert_eq!(input.authorization(), Authorization::NotDetermined);
    let err = refused(&input, &at(16_000));
    assert_eq!(err.code, ErrorCode::PermissionDenied, "{err}");
    assert_eq!(input.captures_opened("fake:mic"), 0);
    assert_eq!(input.devices().expect("listed without the grant").len(), 1);
    assert_eq!(input.request_access(), Ok(Authorization::Authorized));
    let frames = run(&input, 16_000, &tone(440.0, 0.5, 16_000, 1, 0.1));
    assert_eq!(frames.len(), 5);

    for no in [Authorization::Denied, Authorization::Restricted] {
        let input = mic(16_000, 1).with_authorization(no);
        assert_eq!(input.request_access(), Ok(no));
        let err = refused(&input, &at(16_000));
        assert_eq!(err.code, ErrorCode::PermissionDenied, "{no:?}: {err}");
        assert_eq!(input.captures_opened("fake:mic"), 0);
    }
    let asked = mic(16_000, 1)
        .with_authorization(Authorization::NotDetermined)
        .with_answer(Authorization::Denied);
    assert_eq!(asked.request_access(), Ok(Authorization::Denied));
    assert_eq!(asked.request_access(), Ok(Authorization::Denied));
}

#[test]
fn a_stalled_consumer_never_blocks_the_device() {
    let input = Arc::new(mic(48_000, 1));
    let (release, held) = mpsc::channel::<()>();
    let (mut forward, events) = sink();
    let mut held = Some(held);
    let on_event: OnEvent = Box::new(move |event| {
        if let Some(held) = held.take() {
            let _ = held.recv();
        }
        forward(event);
    });
    let capture = input.capture(&at(16_000), on_event).expect("starts");
    let (pushed, done) = mpsc::channel();
    let pusher = Arc::clone(&input);
    thread::spawn(move || {
        push(&pusher, &tone(440.0, 0.5, 48_000, 1, 5.0));
        let _ = pushed.send(());
    });
    done.recv_timeout(WAIT).expect("pushing never blocks");
    drop(release);
    capture.stop();
    let (frames, error) = until_end(&events);
    assert_eq!(error, None);
    let n = frames.len();
    assert!(n > 0 && n < 250, "{n} frames: a full queue drops input");
    let grows = frames.windows(2).all(|w| w[0].at_ms < w[1].at_ms);
    assert!(grows, "at_ms only grows");
    assert!(frames.iter().all(|frame| frame.at_ms < 5_000));
}

#[test]
fn the_os_input_answers_on_this_platform() {
    let input = desk_sys::audio::os().expect("the OS input");
    let authorization = input.authorization();
    if cfg!(not(target_os = "macos")) {
        assert_eq!(authorization, Authorization::Authorized);
        assert_eq!(input.request_access(), Ok(Authorization::Authorized));
    }
    match input.devices() {
        Ok(devices) => {
            let defaults = devices.iter().filter(|d| d.default).count();
            let real = |d: &InputDevice| !d.id.is_empty() && d.sample_rate > 0 && d.channels > 0;
            assert!(defaults <= 1 && devices.iter().all(real), "{devices:?}");
        }
        Err(err) => assert_eq!(err.code, ErrorCode::IoError, "{err}"),
    }
}

#[test]
#[ignore = "opens the microphone: run by hand with a microphone and OS permission"]
fn on_this_computer_the_os_input_captures_the_default_microphone() {
    let input = desk_sys::audio::os().expect("the OS input");
    let devices = input.devices().expect("devices");
    eprintln!("{devices:#?}");
    let defaults = devices.iter().filter(|d| d.default).count();
    assert_eq!(defaults, 1, "one default");
    let authorization = input.request_access().expect("the OS answers");
    if authorization != Authorization::Authorized {
        eprintln!("the microphone is {authorization:?}: nothing is captured until Authorized");
        return;
    }
    let (capture, events) = start(input.as_ref(), &CaptureOptions::default());
    let Event::Frame(first) = events.recv_timeout(WAIT).expect("the first frame") else {
        panic!("the capture ended before its first frame");
    };
    // Half a second from the first frame, which holds the first 20 ms.
    thread::sleep(Duration::from_millis(480));
    capture.stop();
    let (mut frames, error) = until_end(&events);
    assert_eq!(error, None);
    frames.insert(0, first);
    assert!((23..=27).contains(&frames.len()), "{} frames", frames.len());
    assert!(frames.iter().all(|frame| frame.samples.len() == 320));
}
