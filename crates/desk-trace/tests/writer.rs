//! The trace writer: core phases and the ready line on the process clock, the runtime's User Timing
//! measures shifted onto it, and the file written whole into the data folder.

use std::ffi::OsStr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};

use desk_trace::{FILE, Origin, RuntimePhase, Trace};
use serde_json::Value;

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_dir(name: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("desk-trace-{name}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// A process that started at 1 000 000 ms after the epoch.
fn origin() -> Origin {
    Origin::at(UNIX_EPOCH + Duration::from_secs(1_000), Instant::now())
}

fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

fn events(trace: &Trace) -> Vec<Value> {
    trace.to_json()["traceEvents"]
        .as_array()
        .expect("traceEvents")
        .clone()
}

fn named<'a>(events: &'a [Value], name: &str) -> &'a Value {
    events
        .iter()
        .find(|e| e["name"] == name && e["ph"] != "M")
        .unwrap_or_else(|| panic!("no event {name} in {events:#?}"))
}

/// The thread name a metadata event gives `tid`.
fn thread_name(events: &[Value], tid: &Value) -> String {
    events
        .iter()
        .find(|e| e["ph"] == "M" && e["name"] == "thread_name" && &e["tid"] == tid)
        .and_then(|e| e["args"]["name"].as_str())
        .unwrap_or_default()
        .to_owned()
}

#[test]
fn core_phases_are_complete_events_in_microseconds_from_process_start() {
    let origin = origin();
    let trace = Trace::new(origin);
    let start = origin.instant();
    trace.span("core init", start + ms(10), start + ms(35));
    trace.instant_at(desk_trace::READY_LINE, start + ms(900));

    let json = trace.to_json();
    assert_eq!(json["displayTimeUnit"], "ms");
    assert_eq!(json["otherData"]["startedAt"], 1_000_000);
    let events = events(&trace);

    let init = named(&events, "core init");
    assert_eq!(init["ph"], "X");
    assert_eq!(init["cat"], "core");
    assert_eq!(init["ts"], 10_000);
    assert_eq!(init["dur"], 25_000);
    assert_eq!(init["pid"], 1);
    assert_eq!(thread_name(&events, &init["tid"]), "core");

    let ready = named(&events, "ready line");
    assert_eq!(ready["ph"], "i");
    assert_eq!(ready["ts"], 900_000);
    assert_eq!(ready["tid"], init["tid"]);

    let process = events
        .iter()
        .find(|e| e["ph"] == "M" && e["name"] == "process_name")
        .expect("a process name");
    assert_eq!(process["args"]["name"], "endue Desk");
}

#[test]
fn runtime_phases_land_on_the_process_clock_with_each_plugin_mount_on_its_own_track() {
    let origin = origin();
    let trace = Trace::new(origin);
    let start = origin.instant();
    trace.span("app services", start + ms(60), start + ms(80));
    // The webview's time origin is 100 ms after process start.
    let time_origin = 1_000_000.0 + 100.0;
    trace.runtime(
        time_origin,
        &[
            phase("session restore", 50.0, 20.0),
            phase("mount endue.notes", 10.0, 30.5),
            phase("mount endue.dock", 12.0, 8.0),
        ],
    );
    let events = events(&trace);

    let restore = named(&events, "session restore");
    assert_eq!(restore["ph"], "X");
    assert_eq!(restore["cat"], "runtime");
    assert_eq!(restore["ts"], 150_000);
    assert_eq!(restore["dur"], 20_000);
    assert_eq!(thread_name(&events, &restore["tid"]), "runtime");

    let notes = named(&events, "mount endue.notes");
    let dock = named(&events, "mount endue.dock");
    assert_eq!(notes["cat"], "plugin");
    assert_eq!(notes["ts"], 110_000);
    assert_eq!(notes["dur"], 30_500);
    assert_ne!(notes["tid"], dock["tid"]);
    assert_ne!(notes["tid"], restore["tid"]);
    assert_eq!(thread_name(&events, &notes["tid"]), "plugin endue.notes");
    assert_eq!(thread_name(&events, &dock["tid"]), "plugin endue.dock");

    // From the end of the core's last phase to the webview's time origin.
    let webview = named(&events, desk_trace::WEBVIEW_START);
    assert_eq!(webview["cat"], "webview");
    assert_eq!(webview["ts"], 80_000);
    assert_eq!(webview["dur"], 20_000);
}

#[test]
fn a_later_runtime_report_replaces_the_earlier_one() {
    let origin = origin();
    let trace = Trace::new(origin);
    let time_origin = 1_000_000.0 + 100.0;
    trace.runtime(time_origin, &[phase("plugin list", 5.0, 5.0)]);
    trace.runtime(
        time_origin,
        &[
            phase("plugin list", 5.0, 5.0),
            phase(desk_trace::FIRST_FRAME, 800.0, 33.0),
        ],
    );
    let events = events(&trace);
    let lists = events.iter().filter(|e| e["name"] == "plugin list").count();
    assert_eq!(lists, 1, "{events:#?}");
    assert_eq!(named(&events, desk_trace::FIRST_FRAME)["ts"], 900_000);
}

#[test]
fn desk_trace_is_on_for_any_value_but_empty_or_0() {
    assert!(!desk_trace::enabled(None));
    assert!(!desk_trace::enabled(Some(OsStr::new(""))));
    assert!(!desk_trace::enabled(Some(OsStr::new("0"))));
    assert!(desk_trace::enabled(Some(OsStr::new("1"))));
    assert!(desk_trace::enabled(Some(OsStr::new("yes"))));
    assert_eq!(desk_trace::ENV, "DESK_TRACE");
}

#[test]
fn the_trace_is_written_whole_into_trace_json_and_reads_back() {
    let dir = temp_dir("write");
    let origin = origin();
    // The data folder does not exist yet on a first start: writing makes it.
    let trace = Trace::in_dir(origin, &dir);
    assert_eq!(trace.file(), Some(dir.join(FILE).as_path()));
    trace.span("core init", origin.instant(), origin.instant() + ms(5));
    trace.write().expect("written");
    trace.instant_at("ready line", origin.instant() + ms(700));
    trace.write().expect("written again");

    let text = std::fs::read_to_string(dir.join(FILE)).expect("trace.json");
    let json: Value = serde_json::from_str(&text).expect("JSON");
    assert_eq!(json, trace.to_json());
    let names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec![FILE.to_owned()], "no temp file is left behind");
    // Not in a folder: nothing to write, and that is fine.
    assert!(Trace::new(origin).write().is_ok());
    let _ = std::fs::remove_dir_all(&dir);
}

fn phase(name: &str, start: f64, duration: f64) -> RuntimePhase {
    RuntimePhase {
        name: name.to_owned(),
        start,
        duration,
    }
}
