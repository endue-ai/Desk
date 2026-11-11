//! last-start.json (ADR 0061): each start writes `{ at, pid, phase: "starting", failed }` and the
//! ready line marks it `ready`. `failed` counts the starts in a row before this one that did not
//! reach ready within 60 s; when it reaches two, this start is a crash loop and runs in safe mode.

mod support;

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_core::{LastStart, READY_WITHIN};
use serde_json::Value;
use support::home;

fn at(seconds: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_793_600_000 + seconds)
}

fn record(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn two_starts_that_never_reached_ready_make_the_next_safe() {
    assert_eq!(READY_WITHIN, Duration::from_secs(60));
    let path = home("last-start").join("data/last-start.json");

    // A first start that reaches ready.
    let (start, begun) = LastStart::begin(&path, at(0), 41);
    assert!(!begun.crash_loop);
    assert_eq!(begun.failed_before, 0);
    assert!(begun.broken.is_none());
    let written = record(&path);
    assert_eq!(written["pid"], 41);
    assert_eq!(written["phase"], "starting");
    assert_eq!(written["failed"], 0);
    assert_eq!(written["at"], "2026-11-02T06:13:20Z");
    start.ready(at(5));
    assert_eq!(record(&path)["phase"], "ready");

    // Two starts killed before ready: the third is a crash loop.
    let (_, first) = LastStart::begin(&path, at(100), 42);
    assert_eq!(first.failed_before, 0, "the start before reached ready");
    let (_, second) = LastStart::begin(&path, at(200), 43);
    assert_eq!(second.failed_before, 1);
    assert!(!second.crash_loop);
    let (third, begun) = LastStart::begin(&path, at(300), 44);
    assert_eq!(begun.failed_before, 2);
    assert!(begun.crash_loop, "two starts in a row never reached ready");
    assert_eq!(record(&path)["failed"], 2);

    // The safe start reaches ready: the next one is normal.
    third.ready(at(310));
    let (_, after) = LastStart::begin(&path, at(400), 45);
    assert!(!after.crash_loop);
    assert_eq!(after.failed_before, 0);
}

#[test]
fn a_ready_after_sixty_seconds_is_late_and_counts_as_failed() {
    let path = home("last-start-late").join("data/last-start.json");
    let (start, _) = LastStart::begin(&path, at(0), 7);
    start.ready(at(61));
    assert_eq!(record(&path)["phase"], "late");
    let (start, begun) = LastStart::begin(&path, at(100), 8);
    assert_eq!(
        begun.failed_before, 1,
        "a late start counts as one that did not make it"
    );
    start.ready(at(160));
    assert_eq!(record(&path)["phase"], "ready", "60 s is still in time");
}

#[test]
fn an_unreadable_last_start_is_kept_broken_and_counts_as_no_earlier_start() {
    let path = home("last-start-broken").join("data/last-start.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "{ \"phase\": ").unwrap();

    let (_, begun) = LastStart::begin(&path, at(0), 9);

    assert!(!begun.crash_loop);
    assert_eq!(begun.failed_before, 0);
    let broken = begun.broken.expect("the file is reported");
    assert_eq!(broken.name, "last-start.json");
    assert_eq!(broken.kept, path.with_file_name("last-start.json.broken"));
    assert_eq!(fs::read_to_string(&broken.kept).unwrap(), "{ \"phase\": ");
    assert_eq!(record(&path)["phase"], "starting");
}

#[test]
fn a_run_killed_after_its_ready_line_is_named_by_the_next_start() {
    let path = home("last-start-killed").join("data/last-start.json");
    let (start, _) = LastStart::begin(&path, at(0), 41);
    assert_eq!(
        record(&path)["quit"],
        false,
        "a run is not quit until it quits"
    );
    start.ready(at(5));

    // Killed: nothing marks the record. The next start names the run and counts nothing.
    let (_, begun) = LastStart::begin(&path, at(100), 42);
    let unclean = begun.unclean.expect("the killed run is named");
    assert_eq!(unclean.pid, 41);
    assert_eq!(unclean.at, "2026-11-02T06:13:20Z");
    assert_eq!(unclean.started, at(0));
    assert!(unclean.ready, "it had reached its ready line");
    assert_eq!(
        begun.failed_before, 0,
        "a run that got ready is no failed start"
    );
    assert!(!begun.crash_loop);
}

#[test]
fn a_clean_quit_leaves_the_next_start_nothing_to_say() {
    let path = home("last-start-quit").join("data/last-start.json");
    let (start, _) = LastStart::begin(&path, at(0), 41);
    start.ready(at(5));
    start.quit();
    let written = record(&path);
    assert_eq!(written["quit"], true);
    assert_eq!(
        written["phase"], "ready",
        "the quit keeps how the start went"
    );

    let (_, begun) = LastStart::begin(&path, at(100), 42);
    assert!(begun.unclean.is_none(), "{:?}", begun.unclean);
    assert_eq!(begun.failed_before, 0);
}

#[test]
fn a_start_that_died_before_ready_is_named_and_counted() {
    let path = home("last-start-early").join("data/last-start.json");
    let _ = LastStart::begin(&path, at(0), 7);
    let (_, begun) = LastStart::begin(&path, at(100), 8);
    let unclean = begun.unclean.expect("the start that died is named");
    assert_eq!(unclean.pid, 7);
    assert!(!unclean.ready, "it never reached its ready line");
    assert_eq!(begun.failed_before, 1);
}

#[test]
fn a_record_an_older_desk_wrote_says_nothing_of_how_its_run_ended() {
    let path = home("last-start-older").join("data/last-start.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    // A desk before the quit mark: its clean quits and its kills leave the same record.
    let older = r#"{ "at": "2026-11-02T06:13:20Z", "pid": 5, "phase": "ready", "failed": 0 }"#;
    fs::write(&path, older).unwrap();
    let (_, begun) = LastStart::begin(&path, at(100), 6);
    assert!(begun.unclean.is_none(), "{:?}", begun.unclean);
    assert!(begun.broken.is_none(), "the older record still reads");
    assert_eq!(begun.failed_before, 0);
}

#[test]
fn a_quit_marks_the_record_as_it_stands_on_disk() {
    // The app e2e leaves a record as a start that died would (phase starting) while the desk runs,
    // then quits it: the quit marks that record, so the next start still counts a failed start.
    let path = home("last-start-edited").join("data/last-start.json");
    let (start, _) = LastStart::begin(&path, at(0), 41);
    start.ready(at(5));
    let mut edited = record(&path);
    edited["phase"] = "starting".into();
    fs::write(&path, edited.to_string()).unwrap();
    start.quit();
    let written = record(&path);
    assert_eq!(written["phase"], "starting");
    assert_eq!(written["quit"], true);

    let (_, begun) = LastStart::begin(&path, at(100), 42);
    assert_eq!(begun.failed_before, 1);
    assert!(begun.unclean.is_none(), "the run quit");
}

#[test]
fn a_quit_without_a_readable_record_writes_the_run_as_it_went() {
    let path = home("last-start-gone").join("data/last-start.json");
    let (start, _) = LastStart::begin(&path, at(0), 41);
    start.ready(at(5));
    fs::remove_file(&path).unwrap();
    start.quit();
    let written = record(&path);
    assert_eq!(written["phase"], "ready");
    assert_eq!(written["quit"], true);
    assert_eq!(written["pid"], 41);
}
