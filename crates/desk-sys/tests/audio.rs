//! desk-sys audio (feature `audio`): the wake-word default, captures that stop when dropped, and a
//! system microphone that fails cleanly where there is none.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;

use desk_sys::audio::{Capture, NoWakeWord, WakeDetector};

#[test]
fn no_wake_word_never_hears_anything() {
    let mut detector = NoWakeWord;
    let loud = vec![0.9f32; 16_000];
    assert_eq!(detector.feed(&loud, 16_000), None);
}

#[test]
fn dropping_a_capture_stops_and_joins_its_thread() {
    let ended = Arc::new(AtomicBool::new(false));
    let (stop, stopped) = mpsc::channel::<()>();
    let flag = ended.clone();
    let thread = thread::spawn(move || {
        let _ = stopped.recv();
        flag.store(true, Ordering::SeqCst);
    });
    drop(Capture::new(stop, thread));
    assert!(
        ended.load(Ordering::SeqCst),
        "the thread ended before drop returned"
    );
}

// Linux CI has no sound card: opening must fail with an error, not hang or panic. (macOS would show
// the microphone prompt, so it is not run there.)
#[cfg(all(target_os = "linux", feature = "microphone"))]
#[test]
fn the_system_microphone_opens_or_says_why() {
    use desk_sys::audio::{Microphone, SystemMicrophone};
    match SystemMicrophone.open(Some(16_000), Box::new(|_, _| {})) {
        Ok(capture) => drop(capture),
        Err(e) => assert!(!e.to_string().is_empty()),
    }
}
