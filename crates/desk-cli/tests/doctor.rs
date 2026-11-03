//! `desk doctor --trace <file>`: the start-up trace a `DESK_TRACE=1` start wrote, summarized
//! offline (phases, totals, the five longest). Exit codes: 0 ok, 1 no trace there, 2 usage.

use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn desk(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .output()
        .expect("desk runs")
}

/// `text` in a fresh file.
fn file(text: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("desk-cli-trace-{}-{n}.json", std::process::id()));
    std::fs::write(&path, text).unwrap();
    path
}

/// A complete event (`ph: "X"`): `ts` and `dur` in µs.
fn x(name: &str, cat: &str, ts: u64, dur: u64) -> Value {
    json!({ "name": name, "cat": cat, "ph": "X", "ts": ts, "dur": dur, "pid": 1, "tid": 1 })
}

fn trace() -> PathBuf {
    let events = json!({ "traceEvents": [
        x("core init", "core", 5_000, 20_000),
        x("plugin registry", "core", 25_000, 70_000),
        x("mount endue.notes", "plugin", 300_000, 180_000),
        x("mount endue.sheets", "plugin", 310_000, 140_000),
        x("session restore", "runtime", 500_000, 90_000),
        x("plugin list", "runtime", 280_000, 10_000),
        x("first interactive frame", "runtime", 610_000, 30_000),
        { "name": "ready line", "ph": "i", "s": "p", "ts": 612_000, "pid": 1, "tid": 1 },
    ]});
    file(&events.to_string())
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn doctor_trace_prints_phases_totals_and_the_five_longest() {
    let path = trace();
    let out = desk(&["doctor", "--trace", path.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = stdout(&out);
    for part in [
        "phases",
        "core init",
        "session restore",
        "totals",
        "ready line",
        "612.0",
        "first interactive frame",
        "640.0",
        "five longest",
    ] {
        assert!(text.contains(part), "{part:?} in:\n{text}");
    }
    // Longest first: the notes mount leads; plugin list (10 ms) is not among the five.
    let longest = &text[text.find("five longest").unwrap()..];
    assert!(longest.find("mount endue.notes") < longest.find("mount endue.sheets"));
    assert!(!longest.contains("plugin list"), "{longest}");
    let _ = std::fs::remove_file(path);
}

#[test]
fn doctor_trace_with_json_prints_the_summary_as_json() {
    let path = trace();
    let out = desk(&["--json", "doctor", "--trace", path.to_str().unwrap()]);
    assert!(out.status.success());
    let summary: Value = serde_json::from_str(&stdout(&out)).expect("one JSON document");
    assert_eq!(summary["phases"].as_array().map(Vec::len), Some(7));
    assert_eq!(summary["longest"].as_array().map(Vec::len), Some(5));
    assert_eq!(summary["longest"][0]["name"], "mount endue.notes");
    assert_eq!(summary["longest"][0]["durationMs"], 180.0);
    let marks = summary["marks"].as_array().expect("marks");
    assert!(
        marks
            .iter()
            .any(|m| m["name"] == "ready line" && m["atMs"] == 612.0)
    );
    let _ = std::fs::remove_file(path);
}

#[test]
fn doctor_trace_on_a_missing_or_broken_file_exits_1() {
    let missing = std::env::temp_dir().join("desk-cli-no-such-trace.json");
    let out = desk(&["doctor", "--trace", missing.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).starts_with("desk: "));

    let broken = file("{ \"traceEvents\": \"no\" }");
    let out = desk(&["doctor", "--trace", broken.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("trace"));
    let _ = std::fs::remove_file(broken);
}

#[test]
fn doctor_without_a_trace_file_is_a_usage_error() {
    // Bare `doctor` is the state check (tests/health.rs); only `--trace` needs its file.
    let out = desk(&["doctor", "--trace"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("doctor --trace"));
    // Bare `doctor` is no usage error any more: it is the state check.
    assert_ne!(desk(&["doctor"]).status.code(), Some(2));
}
