//! audio.capture.* through Core::handle, with a recorded microphone and a scripted detector.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use desk_bridge::{BridgeError, BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode};
use desk_core::{Core, DetectorFactory, Roots};
use desk_sys::audio::{Capture, Detection, Microphone, OnFrames, WakeDetector};
use serde_json::{Value, json};

const RATE: u32 = 16_000;

/// Plays silence in 100 ms chunks until the capture is dropped; counts open captures.
#[derive(Default)]
struct Recording {
    open: Arc<AtomicUsize>,
}

impl Microphone for Recording {
    fn open(&self, _rate: Option<u32>, mut on_frames: OnFrames) -> std::io::Result<Capture> {
        let (stop, stopped) = mpsc::channel::<()>();
        let open = self.open.clone();
        open.fetch_add(1, Ordering::SeqCst);
        let thread = thread::spawn(move || {
            let chunk = vec![0.0f32; (RATE / 10) as usize];
            while let Err(mpsc::TryRecvError::Empty) = stopped.try_recv() {
                on_frames(&chunk, RATE);
                thread::sleep(Duration::from_millis(2));
            }
            open.fetch_sub(1, Ordering::SeqCst);
        });
        Ok(Capture::new(stop, thread))
    }
}

/// Hears "hey eris" once a second of audio has passed, every time it is fed after that.
struct AfterOneSecond {
    heard: u64,
}

impl WakeDetector for AfterOneSecond {
    fn feed(&mut self, frames: &[f32], rate: u32) -> Option<Detection> {
        self.heard += frames.len() as u64;
        (self.heard >= u64::from(rate)).then(|| Detection {
            word: "hey eris".to_owned(),
            confidence: 0.9,
        })
    }
}

fn detector() -> DetectorFactory {
    Arc::new(|| Box::new(AfterOneSecond { heard: 0 }) as Box<dyn WakeDetector>)
}

fn core(grant: Value) -> (Core, Arc<AtomicUsize>) {
    let microphone = Recording::default();
    let open = microphone.open.clone();
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_audio(Arc::new(microphone), detector());
    core.grant("desk", serde_json::from_value(grant).unwrap());
    (core, open)
}

fn call(core: &Core, method: &str, params: Value) -> Result<Value, BridgeError> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle("desk", request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error),
    }
}

fn wakes(events: &Receiver<BridgeEvent>, within: Duration) -> Vec<Value> {
    let deadline = Instant::now() + within;
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        if let Ok(event) = events.recv_timeout(Duration::from_millis(20)) {
            let event = serde_json::to_value(event).unwrap();
            if event["event"] == "audio.wake" {
                seen.push(event["data"].clone());
            }
        }
    }
    seen
}

fn listening() -> Value {
    json!({ "permission": "audio:capture", "wakeWord": true })
}

#[test]
fn the_wake_word_arrives_once_per_utterance_with_its_time() {
    let (core, open) = core(listening());
    let events = core.events().subscribe();
    let started = call(
        &core,
        "audio.capture.start",
        json!({ "wakeWord": true, "scope": listening() }),
    )
    .unwrap();
    let capture_id = started["captureId"].as_str().unwrap().to_owned();
    assert_eq!(open.load(Ordering::SeqCst), 1);

    let heard = wakes(&events, Duration::from_millis(300));
    assert!(!heard.is_empty(), "a wake word was heard");
    assert_eq!(heard[0]["captureId"], capture_id.as_str());
    assert_eq!(heard[0]["word"], "hey eris");
    assert!((heard[0]["confidence"].as_f64().unwrap() - 0.9).abs() < 1e-6);
    assert_eq!(
        heard[0]["atMs"], 1000,
        "measured in captured audio, not wall time"
    );
    if let Some(next) = heard.get(1) {
        assert!(
            next["atMs"].as_u64().unwrap() >= 2500,
            "quiet for 1.5 s after a wake"
        );
    }

    call(
        &core,
        "audio.capture.stop",
        json!({ "captureId": capture_id, "scope": listening() }),
    )
    .unwrap();
    assert_eq!(open.load(Ordering::SeqCst), 0, "stop closes the microphone");
    call(
        &core,
        "audio.capture.stop",
        json!({ "captureId": capture_id, "scope": listening() }),
    )
    .expect("stopping twice is not an error");
}

#[test]
fn without_wake_word_nothing_is_heard() {
    let plain = json!({ "permission": "audio:capture" });
    let (core, open) = core(plain.clone());
    let events = core.events().subscribe();
    call(&core, "audio.capture.start", json!({ "scope": plain })).unwrap();
    assert_eq!(open.load(Ordering::SeqCst), 1);
    assert!(wakes(&events, Duration::from_millis(200)).is_empty());
}

#[test]
fn the_wake_word_needs_a_scope_and_grant_that_allow_it() {
    let plain = json!({ "permission": "audio:capture" });
    let (core, open) = core(plain.clone());
    let error = call(
        &core,
        "audio.capture.start",
        json!({ "wakeWord": true, "scope": plain }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    let error = call(
        &core,
        "audio.capture.start",
        json!({ "wakeWord": true, "scope": listening() }),
    )
    .unwrap_err();
    assert_eq!(
        error.code,
        ErrorCode::PermissionDenied,
        "the grant has no wake word"
    );
    assert_eq!(open.load(Ordering::SeqCst), 0);
}

#[test]
fn revoking_the_grant_closes_the_microphone() {
    let microphone = Recording::default();
    let open = microphone.open.clone();
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_audio(Arc::new(microphone), detector());
    let grant = core.grant("desk", serde_json::from_value(listening()).unwrap());
    call(
        &core,
        "audio.capture.start",
        json!({ "scope": listening() }),
    )
    .unwrap();
    assert_eq!(open.load(Ordering::SeqCst), 1);
    assert!(core.revoke("desk", &grant.grant_id));
    assert_eq!(open.load(Ordering::SeqCst), 0);
}

#[test]
fn a_desk_without_a_microphone_says_so() {
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    });
    core.grant("desk", serde_json::from_value(listening()).unwrap());
    let error = call(
        &core,
        "audio.capture.start",
        json!({ "scope": listening() }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Unsupported);
}
