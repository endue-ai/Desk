//! desk-sys clipboard primitives (feature `clipboard`): the `Clipboard` contract through
//! `FakeClipboard`, change detection (`Changes`, `watch`) and the OS clipboard (macOS and Windows,
//! `unsupported` on Linux).
//!
//! Only the ignored macOS and Windows test reaches the OS clipboard, and it replaces what the person
//! copied for a moment; everything else runs on the fake.

use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use desk_sys::ErrorCode;
use desk_sys::clipboard::fake::FakeClipboard;
use desk_sys::clipboard::{self, Changes, Clipboard, Marks, State};

const PLAIN: Marks = Marks {
    concealed: false,
    transient: false,
};
const CONCEALED: Marks = Marks {
    concealed: true,
    transient: false,
};
const TRANSIENT: Marks = Marks {
    concealed: false,
    transient: true,
};
const BOTH: Marks = Marks {
    concealed: true,
    transient: true,
};

/// A watch's reports, one `State` per callback.
fn watched(fake: &Arc<FakeClipboard>) -> (clipboard::Watch, mpsc::Receiver<State>) {
    let (sender, receiver) = mpsc::channel();
    let watch = clipboard::watch(fake.clone(), Duration::from_millis(10), move |state| {
        let _ = sender.send(state);
    });
    (watch, receiver)
}

#[test]
fn the_fake_clipboard_reads_back_the_text_written_to_it() {
    let fake = FakeClipboard::new();
    assert_eq!(fake.read_text().unwrap(), None);
    assert!(!fake.state().unwrap().has_text);
    assert_eq!(Marks::default(), PLAIN);

    let text = "héllo\r\nwörld 😀";
    fake.write_text(text, Marks::default()).unwrap();
    assert_eq!(fake.read_text().unwrap().as_deref(), Some(text));
    let state = fake.state().unwrap();
    assert!(state.has_text);
    assert_eq!(state.marks, PLAIN);

    fake.write_text("second", Marks::default()).unwrap();
    assert_eq!(fake.read_text().unwrap().as_deref(), Some("second"));

    fake.copy_without_text();
    assert_eq!(fake.read_text().unwrap(), None);
    let state = fake.state().unwrap();
    assert!(!state.has_text);
    assert_eq!(state.marks, PLAIN);
}

#[test]
fn every_change_advances_the_count_and_reading_never_does() {
    let fake = FakeClipboard::new();
    let mut seen = vec![fake.state().unwrap().count];
    let changes: [&dyn Fn(&FakeClipboard); 4] = [
        &|fake| fake.write_text("same", PLAIN).unwrap(),
        &|fake| fake.write_text("same", PLAIN).unwrap(),
        &|fake| fake.copy("same", PLAIN),
        &|fake| fake.copy("same", PLAIN),
    ];
    for change in changes {
        change(&fake);
        let count = fake.state().unwrap().count;
        assert!(!seen.contains(&count), "{count} was seen before: {seen:?}");
        seen.push(count);

        fake.read_text().unwrap();
        fake.state().unwrap();
        assert_eq!(fake.state().unwrap().count, count);
    }
}

#[test]
fn marks_from_another_app_are_reported_without_reading_the_text() {
    let fake = FakeClipboard::new();
    let mut changes = Changes::new(&fake);

    fake.copy("hunter2", CONCEALED);
    let state = fake.state().unwrap();
    assert!(state.has_text);
    assert_eq!(state.marks, CONCEALED);
    assert_eq!(changes.poll(&fake).unwrap().map(|s| s.marks), Some(CONCEALED));

    fake.copy("one-time code 123456", TRANSIENT);
    assert_eq!(fake.state().unwrap().marks, TRANSIENT);
    assert_eq!(changes.poll(&fake).unwrap().map(|s| s.marks), Some(TRANSIENT));
    assert_eq!(fake.text_reads(), 0);

    fake.write_text("plain", Marks::default()).unwrap();
    assert_eq!(fake.state().unwrap().marks, PLAIN);
    assert_eq!(changes.poll(&fake).unwrap().map(|s| s.marks), Some(PLAIN));
    assert_eq!(fake.text_reads(), 0);
}

#[test]
fn the_desk_can_write_text_marked_concealed_or_transient() {
    let fake = FakeClipboard::new();
    fake.write_text("secret", BOTH).unwrap();
    let state = fake.state().unwrap();
    assert!(state.has_text);
    assert_eq!(state.marks, BOTH);
    assert_eq!(fake.read_text().unwrap().as_deref(), Some("secret"));
    assert_eq!(fake.text_reads(), 1);
}

#[test]
fn text_with_a_nul_is_refused_and_the_clipboard_is_left_as_it_was() {
    let fake = FakeClipboard::new();
    fake.write_text("before", CONCEALED).unwrap();
    let before = fake.state().unwrap();

    let err = fake.write_text("a\0b", Marks::default()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidParams);
    assert_eq!(fake.state().unwrap(), before);
    assert_eq!(fake.read_text().unwrap().as_deref(), Some("before"));
}

#[test]
fn changes_report_each_new_state_once() {
    let fake = FakeClipboard::new();
    let mut changes = Changes::new(&fake);
    assert_eq!(changes.poll(&fake).unwrap(), None);

    fake.copy("one", TRANSIENT);
    let state = changes.poll(&fake).unwrap().expect("the copy is a change");
    assert_eq!(state, fake.state().unwrap());
    assert_eq!(state.marks, TRANSIENT);
    assert_eq!(changes.poll(&fake).unwrap(), None);

    fake.copy("two", TRANSIENT);
    fake.copy("three", CONCEALED);
    let state = changes.poll(&fake).unwrap().expect("two copies are one change");
    assert_eq!(state.count, fake.state().unwrap().count);
    assert_eq!(state.marks, CONCEALED);
    assert_eq!(changes.poll(&fake).unwrap(), None);
}

#[test]
fn a_failed_poll_answers_the_error_and_keeps_the_last_count() {
    let fake = FakeClipboard::new();
    let mut changes = Changes::new(&fake);
    fake.copy("one", PLAIN);
    fake.fail_next(1);
    assert_eq!(changes.poll(&fake).unwrap_err().code, ErrorCode::IoError);
    let state = changes.poll(&fake).unwrap().expect("the copy is still a change");
    assert_eq!(state.count, fake.state().unwrap().count);
    assert_eq!(changes.poll(&fake).unwrap(), None);
}

#[test]
fn a_watch_calls_back_on_each_change_and_stops_when_dropped() {
    let fake = Arc::new(FakeClipboard::new());
    let (watch, reports) = watched(&fake);

    fake.copy("one", PLAIN);
    let state = reports
        .recv_timeout(Duration::from_secs(5))
        .expect("the copy within 5 s");
    assert_eq!(state.count, fake.state().unwrap().count);

    fake.copy("two", CONCEALED);
    let state = reports
        .recv_timeout(Duration::from_secs(5))
        .expect("the second copy within 5 s");
    assert_eq!(state.marks, CONCEALED);

    drop(watch);
    fake.copy("three", PLAIN);
    assert!(
        reports.recv_timeout(Duration::from_millis(500)).is_err(),
        "a dropped watch called back"
    );
    assert_eq!(fake.text_reads(), 0);
}

#[test]
fn a_watch_keeps_polling_after_the_clipboard_fails() {
    let fake = Arc::new(FakeClipboard::new());
    let (_watch, reports) = watched(&fake);

    fake.fail_next(3);
    assert!(
        reports.recv_timeout(Duration::from_millis(300)).is_err(),
        "a failed poll was reported"
    );
    fake.copy("after", PLAIN);
    let state = reports
        .recv_timeout(Duration::from_secs(5))
        .expect("the copy after the failures within 5 s");
    // The test makes no other call, so the watch spent the three failures before this answers.
    assert_eq!(state, fake.state().unwrap());
}

#[cfg(target_os = "linux")]
#[test]
fn the_os_clipboard_is_unsupported_on_linux() {
    let err = clipboard::os().err().expect("no OS clipboard on Linux yet");
    assert_eq!(err.code, ErrorCode::Unsupported);
}

/// Puts the person's text back, with its marks, however the test ends.
#[cfg(any(target_os = "macos", target_os = "windows"))]
struct PutBack(Arc<dyn Clipboard>, Option<(String, Marks)>);

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl Drop for PutBack {
    fn drop(&mut self) {
        if let Some((text, marks)) = &self.1 {
            let _ = self.0.write_text(text, *marks);
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[test]
#[ignore = "replaces the person's clipboard for a moment; people run it with --ignored"]
fn the_os_clipboard_writes_reads_and_marks_text() {
    let os = clipboard::os().unwrap_or_else(|err| panic!("the OS clipboard: {err}"));
    let before = os.state().unwrap();
    let kept = os.read_text().unwrap().map(|text| (text, before.marks));
    let _put_back = PutBack(os.clone(), kept);

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let text = format!("desk-sys {} {nanos}\r\nhéllo wörld 😀", std::process::id());

    os.write_text(&text, Marks::default()).unwrap();
    let written = os.state().unwrap();
    assert_ne!(written.count, before.count);
    assert!(written.has_text);
    assert_eq!(written.marks, PLAIN);
    assert_eq!(os.read_text().unwrap().as_deref(), Some(text.as_str()));

    os.write_text(&text, BOTH).unwrap();
    let marked = os.state().unwrap();
    assert_ne!(marked.count, written.count);
    assert!(marked.has_text);
    assert_eq!(marked.marks, BOTH);
    assert_eq!(os.read_text().unwrap().as_deref(), Some(text.as_str()));
}
