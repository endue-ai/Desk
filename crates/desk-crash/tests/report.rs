//! Crash reports on disk (#322): what a report holds, what it never says, how many are kept, and
//! the one a next start shows once.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use desk_crash::{BACKTRACE_MAX, Context, Crashes, KEEP, MESSAGE_MAX, Report};

fn data(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-crash-{tag}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

fn context(home: &str) -> Context {
    let context = Context::new("0.1.0", Some("abc1234"), Some(std::path::Path::new(home)));
    context.set_plugins(vec!["endue.notes".into(), "endue.mail".into()]);
    context
}

#[test]
fn a_report_names_the_version_os_message_and_plugins() {
    let data = data("fields");
    let crashes = Crashes::in_data(&data);
    let report = Report::webview(
        "TypeError: x is undefined",
        "at draw (shell.js:1:2)",
        &context("/srv/mira"),
    );
    let path = crashes.write(&report).unwrap();
    assert_eq!(path.parent().unwrap(), data.join("crashes"));
    let name = path.file_name().unwrap().to_str().unwrap();
    assert!(
        name.len() == "20261102T091500123Z.json".len() && name.ends_with("Z.json"),
        "{name}"
    );
    let written: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    for field in [
        "schema",
        "kind",
        "at",
        "version",
        "os",
        "arch",
        "message",
        "backtrace",
        "plugins",
    ] {
        assert!(written.get(field).is_some(), "{field} in {written}");
    }
    assert_eq!(written["schema"], 1);
    assert_eq!(written["kind"], "webview");
    assert_eq!(written["version"], "0.1.0");
    assert_eq!(written["commit"], "abc1234");
    assert_eq!(written["os"], std::env::consts::OS);
    assert_eq!(
        written["plugins"],
        serde_json::json!(["endue.notes", "endue.mail"])
    );
    assert_eq!(
        written["backtrace"],
        serde_json::json!(["at draw (shell.js:1:2)"])
    );
}

#[test]
fn paths_under_home_are_redacted() {
    let report = Report::panic(
        "cannot open /srv/mira/Notes/secret.md and /Users/kai/a and C:\\Users\\Lena\\b",
        Some("/home/ci/desk/src/lib.rs:3:1"),
        Some("main"),
        "0: /srv/mira/x\n1: /home/ci/y",
        &context("/srv/mira"),
    );
    let text = serde_json::to_string(&report).unwrap();
    for name in ["/srv/mira", "kai", "Lena", "/home/ci"] {
        assert!(!text.contains(name), "{name} in {text}");
    }
    assert!(
        report.message.contains("~/Notes/secret.md"),
        "{}",
        report.message
    );
    assert_eq!(report.location.as_deref(), Some("~/desk/src/lib.rs:3:1"));
    assert_eq!(report.backtrace, ["0: ~/x", "1: ~/y"]);
}

#[test]
fn long_messages_and_backtraces_are_cut() {
    let long = "x".repeat(MESSAGE_MAX * 3);
    let stack: String = (0..200).map(|n| format!("frame {n}\n")).collect();
    let report = Report::webview(&long, &stack, &context("/srv/mira"));
    assert_eq!(
        report.message.chars().count(),
        MESSAGE_MAX + 1,
        "the cut and its …"
    );
    assert_eq!(report.backtrace.len(), BACKTRACE_MAX);
}

#[test]
fn the_newest_report_is_last_and_old_ones_are_pruned() {
    let data = data("prune");
    let crashes = Crashes::in_data(&data);
    let context = context("/srv/mira");
    let mut last = PathBuf::new();
    for n in 0..KEEP + 5 {
        last = crashes
            .write(&Report::webview(&format!("error {n}"), "", &context))
            .unwrap();
    }
    assert_eq!(crashes.count(), KEEP);
    let (path, newest) = crashes.newest().unwrap();
    assert_eq!(path, last);
    assert_eq!(newest["message"], format!("error {}", KEEP + 4));
}

#[test]
fn an_unseen_report_is_taken_once() {
    let data = data("seen");
    let crashes = Crashes::in_data(&data);
    assert!(crashes.take_unseen().is_none());
    let context = context("/srv/mira");
    crashes
        .write(&Report::webview("first", "", &context))
        .unwrap();
    crashes
        .write(&Report::webview("second", "", &context))
        .unwrap();
    assert_eq!(crashes.take_unseen().unwrap()["message"], "second");
    assert!(crashes.take_unseen().is_none(), "shown once");
    crashes
        .write(&Report::webview("third", "", &context))
        .unwrap();
    assert_eq!(crashes.take_unseen().unwrap()["message"], "third");
}
