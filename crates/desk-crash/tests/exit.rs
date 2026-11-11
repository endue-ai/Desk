//! A run that ended without quitting (ADR 0187): the next start writes an `exit` report that says
//! when that run started, which process it was and whether it got ready, unless that run's own panic
//! report already explains it. The next start shows it once, as it does a panic's.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use desk_crash::{Context, Crashes, Report};

fn data(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-exit-{tag}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

fn context() -> Context {
    Context::new(
        "0.1.0",
        Some("abc1234"),
        Some(std::path::Path::new("/srv/mira")),
    )
}

#[test]
fn an_exit_report_names_the_run_that_did_not_quit() {
    let report = Report::exit("2026-11-12T01:02:03.456Z", 4242, true, &context());
    assert_eq!(report.kind, "exit");
    assert_eq!(report.version, "0.1.0");
    assert!(report.backtrace.is_empty());
    for part in [
        "2026-11-12T01:02:03.456Z",
        "4242",
        "without quitting",
        "killed",
    ] {
        assert!(
            report.message.contains(part),
            "{part} in {}",
            report.message
        );
    }
    assert!(!report.message.contains("before it was ready"));

    let early = Report::exit("2026-11-12T01:02:03Z", 7, false, &context());
    assert!(
        early.message.contains("before it was ready"),
        "{}",
        early.message
    );

    let crashes = Crashes::in_data(&data("shown"));
    crashes.write(&report).unwrap();
    let shown = crashes.take_unseen().expect("the next start shows it");
    assert_eq!(shown["kind"], "exit");
    assert!(crashes.take_unseen().is_none(), "once");
}

#[test]
fn a_panic_written_since_a_time_is_found_and_other_reports_are_not() {
    let crashes = Crashes::in_data(&data("since"));
    let before = SystemTime::now() - Duration::from_secs(5);
    assert!(!crashes.panicked_since(before), "no reports at all");

    crashes
        .write(&Report::webview("TypeError: x", "at y", &context()))
        .unwrap();
    assert!(
        !crashes.panicked_since(before),
        "a page error does not end a run"
    );

    crashes
        .write(&Report::panic("boom", None, Some("main"), "", &context()))
        .unwrap();
    assert!(crashes.panicked_since(before));
    let later = SystemTime::now() + Duration::from_secs(5);
    assert!(
        !crashes.panicked_since(later),
        "a panic before that time is another run's"
    );
}
