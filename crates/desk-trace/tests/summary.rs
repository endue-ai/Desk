//! The summary `desk doctor --trace` prints: every phase by start, the totals (the ready line, the
//! first interactive frame, and each category's sum) and the five longest phases.

use std::time::{Duration, Instant, UNIX_EPOCH};

use desk_trace::{Origin, RuntimePhase, Trace, summarize};
use serde_json::{Value, json};

/// A complete event (`ph: "X"`): `ts` and `dur` in µs.
fn x(name: &str, cat: &str, ts: u64, dur: u64, tid: u64) -> Value {
    json!({ "name": name, "cat": cat, "ph": "X", "ts": ts, "dur": dur, "pid": 1, "tid": tid })
}

/// A start-up as the app writes one, by hand: seven phases in three categories and the ready line.
fn trace_text() -> String {
    json!({
        "traceEvents": [
            { "name": "process_name", "ph": "M", "pid": 1, "tid": 0, "args": { "name": "Desk" } },
            x("plugin registry", "core", 40_000, 60_000, 1),
            x("core init", "core", 10_000, 30_000, 1),
            x("session restore", "runtime", 700_000, 120_000, 2),
            x("mount endue.notes", "plugin", 400_000, 250_000, 3),
            x("mount endue.dock", "plugin", 410_000, 90_000, 4),
            x("plugin list", "runtime", 380_000, 15_000, 2),
            x("first interactive frame", "runtime", 900_000, 33_500, 2),
            { "name": "ready line", "ph": "i", "s": "p", "ts": 905_000, "pid": 1, "tid": 1 },
        ],
        "displayTimeUnit": "ms",
    })
    .to_string()
}

#[test]
fn the_summary_lists_phases_by_start_with_totals_and_the_five_longest() {
    let summary = summarize(&trace_text()).expect("a trace");
    let names: Vec<&str> = summary.phases.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "core init",
            "plugin registry",
            "plugin list",
            "mount endue.notes",
            "mount endue.dock",
            "session restore",
            "first interactive frame",
        ]
    );
    let init = &summary.phases[0];
    assert_eq!(init.category, "core");
    assert_eq!(init.start_ms, 10.0);
    assert_eq!(init.duration_ms, 30.0);

    let totals: Vec<(&str, f64, usize)> = summary
        .totals
        .iter()
        .map(|t| (t.category.as_str(), t.ms, t.count))
        .collect();
    assert_eq!(
        totals,
        [
            ("core", 90.0, 2),
            ("runtime", 168.5, 3),
            ("plugin", 340.0, 2)
        ]
    );

    let longest: Vec<&str> = summary.longest.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(
        longest,
        [
            "mount endue.notes",
            "session restore",
            "mount endue.dock",
            "plugin registry",
            "first interactive frame",
        ]
    );

    let text = summary.to_string();
    for heading in ["phases", "totals", "five longest"] {
        assert!(text.contains(heading), "{heading} in:\n{text}");
    }
    assert!(text.contains("mount endue.notes"), "{text}");
    assert!(text.contains("250.0"), "{text}");
}

#[test]
fn the_summary_names_the_ready_line_and_the_first_interactive_frame() {
    let summary = summarize(&trace_text()).expect("a trace");
    assert_eq!(summary.mark(desk_trace::READY_LINE), Some(905.0));
    assert_eq!(summary.mark(desk_trace::FIRST_FRAME), Some(933.5));
    let text = summary.to_string();
    assert!(text.contains("ready line"), "{text}");
    assert!(text.contains("905.0"), "{text}");
    assert!(text.contains("933.5"), "{text}");

    let json = summary.to_json();
    assert_eq!(json["phases"].as_array().map(Vec::len), Some(7));
    assert_eq!(json["longest"].as_array().map(Vec::len), Some(5));
    assert_eq!(json["marks"][0]["name"], "ready line");
    assert_eq!(json["marks"][0]["atMs"], 905.0);
    assert_eq!(json["totals"][0]["category"], "core");
}

#[test]
fn a_bare_event_array_is_a_trace_and_anything_else_is_refused() {
    let bare = json!([
        { "name": "core init", "cat": "core", "ph": "X", "ts": 0, "dur": 1_000, "pid": 1, "tid": 1 }
    ])
    .to_string();
    let summary = summarize(&bare).expect("an array of events is a trace");
    assert_eq!(summary.phases.len(), 1);
    assert_eq!(summary.mark(desk_trace::FIRST_FRAME), None);
    assert!(summary.to_string().contains("not in the trace"));

    for broken in ["", "not json", "{}", "{\"traceEvents\": 3}", "[1, 2]", "[]"] {
        assert!(summarize(broken).is_err(), "{broken:?} is not a trace");
    }
}

#[test]
fn a_written_trace_summarizes_to_its_own_phases() {
    let origin = Origin::at(UNIX_EPOCH + Duration::from_secs(1_000), Instant::now());
    let trace = Trace::new(origin);
    let start = origin.instant();
    trace.span("core init", start, start + Duration::from_millis(20));
    trace.instant_at(desk_trace::READY_LINE, start + Duration::from_millis(500));
    trace.runtime(
        1_000_000.0 + 100.0,
        &[RuntimePhase {
            name: desk_trace::FIRST_FRAME.to_owned(),
            start: 390.0,
            duration: 32.0,
        }],
    );
    let summary = summarize(&trace.to_json().to_string()).expect("its own trace");
    let names: Vec<&str> = summary.phases.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(
        names,
        ["core init", "webview start", "first interactive frame"]
    );
    assert_eq!(summary.mark(desk_trace::READY_LINE), Some(500.0));
    assert_eq!(summary.mark(desk_trace::FIRST_FRAME), Some(522.0));
}
