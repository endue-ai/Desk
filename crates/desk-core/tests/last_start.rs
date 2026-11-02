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
