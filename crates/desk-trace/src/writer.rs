//! Recording the phases of one start and writing them to `trace.json`.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{ENV, FILE, MOUNT, WEBVIEW_START, enabled};

/// The one process in the trace.
const PID: u64 = 1;
/// The core's track: its setup phases, the ready line and the gap before the webview.
const CORE: u64 = 1;
/// The runtime's track: its phases in the webview, one after another.
const RUNTIME: u64 = 2;
/// Plugin mounts overlap, so each takes a track of its own from here on.
const PLUGINS: u64 = 3;

/// Process start: where the trace's clock reads 0, on the monotonic clock and on the wall clock.
#[derive(Clone, Copy, Debug)]
pub struct Origin {
    at: Instant,
    wall: SystemTime,
}

impl Origin {
    /// Now: call it first thing in `main`.
    pub fn now() -> Self {
        Self {
            at: Instant::now(),
            wall: SystemTime::now(),
        }
    }

    /// The origin `at` on the monotonic clock, which was `wall` on the wall clock.
    pub fn at(wall: SystemTime, at: Instant) -> Self {
        Self { at, wall }
    }

    pub fn instant(&self) -> Instant {
        self.at
    }

    /// The wall time at process start in ms since the Unix epoch, as `performance.timeOrigin` is.
    pub fn wall_ms(&self) -> f64 {
        self.wall
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_secs_f64() * 1000.0)
            .unwrap_or_default()
    }

    /// µs from process start to `at`.
    fn us(&self, at: Instant) -> i64 {
        let whole = |span: std::time::Duration| i64::try_from(span.as_micros()).unwrap_or(i64::MAX);
        match at.checked_duration_since(self.at) {
            Some(after) => whole(after),
            None => -whole(self.at.duration_since(at)),
        }
    }
}

/// One User Timing measure from the runtime: ms from the webview's `performance.timeOrigin`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuntimePhase {
    pub name: String,
    pub start: f64,
    pub duration: f64,
}

#[derive(Clone, Debug)]
struct Event {
    name: String,
    cat: &'static str,
    /// µs from process start.
    ts: i64,
    /// A phase lasts this many µs; an instant has none.
    dur: Option<i64>,
    tid: u64,
}

#[derive(Default)]
struct Recorded {
    core: Vec<Event>,
    runtime: Vec<Event>,
    /// The plugins whose mounts the runtime reported, in track order.
    plugins: Vec<String>,
    /// The webview's time origin, in µs from process start, once the runtime reported.
    webview: Option<i64>,
}

/// One start's trace: the core's phases and instants, and the runtime's phases as it last reported
/// them. Every method takes `&self`, so the app can share one between its setup and its commands.
pub struct Trace {
    origin: Origin,
    file: Option<PathBuf>,
    recorded: Mutex<Recorded>,
}

impl Trace {
    /// A trace kept in memory: [`Trace::write`] writes nothing.
    pub fn new(origin: Origin) -> Self {
        Self {
            origin,
            file: None,
            recorded: Mutex::default(),
        }
    }

    /// A trace written to `trace.json` in `dir`, the app's data folder.
    pub fn in_dir(origin: Origin, dir: &Path) -> Self {
        Self {
            file: Some(dir.join(FILE)),
            ..Self::new(origin)
        }
    }

    /// A trace written into `dir` when `DESK_TRACE` turns it on, or none.
    pub fn from_env(origin: Origin, dir: &Path) -> Option<Self> {
        enabled(std::env::var_os(ENV).as_deref()).then(|| Self::in_dir(origin, dir))
    }

    pub fn file(&self) -> Option<&Path> {
        self.file.as_deref()
    }

    pub fn origin(&self) -> Origin {
        self.origin
    }

    /// A core phase from `start` until now.
    pub fn phase(&self, name: &str, start: Instant) {
        self.span(name, start, Instant::now());
    }

    /// A core phase from `start` to `end`.
    pub fn span(&self, name: &str, start: Instant, end: Instant) {
        let ts = self.origin.us(start);
        let event = Event {
            name: name.to_owned(),
            cat: "core",
            ts,
            dur: Some(self.origin.us(end) - ts),
            tid: CORE,
        };
        self.recorded().core.push(event);
    }

    /// An instant on the core's track, now.
    pub fn instant(&self, name: &str) {
        self.instant_at(name, Instant::now());
    }

    pub fn instant_at(&self, name: &str, at: Instant) {
        let event = Event {
            name: name.to_owned(),
            cat: "core",
            ts: self.origin.us(at),
            dur: None,
            tid: CORE,
        };
        self.recorded().core.push(event);
    }

    /// The runtime's phases, measured from `time_origin_ms` (its `performance.timeOrigin`). Each
    /// report holds every phase so far and replaces the one before.
    pub fn runtime(&self, time_origin_ms: f64, phases: &[RuntimePhase]) {
        let base = time_origin_ms - self.origin.wall_ms();
        let mut plugins: Vec<String> = Vec::new();
        let events = phases
            .iter()
            .map(|phase| {
                let (cat, tid) = match phase.name.strip_prefix(MOUNT) {
                    Some(plugin) => {
                        let track = match plugins.iter().position(|p| p == plugin) {
                            Some(track) => track,
                            None => {
                                plugins.push(plugin.to_owned());
                                plugins.len() - 1
                            }
                        };
                        ("plugin", PLUGINS + track as u64)
                    }
                    None => ("runtime", RUNTIME),
                };
                Event {
                    name: phase.name.clone(),
                    cat,
                    ts: micros(base + phase.start),
                    dur: Some(micros(phase.duration)),
                    tid,
                }
            })
            .collect();
        let mut recorded = self.recorded();
        recorded.runtime = events;
        recorded.plugins = plugins;
        recorded.webview = Some(micros(base));
    }

    /// The trace as the file holds it.
    pub fn to_json(&self) -> Value {
        self.json(&self.recorded())
    }

    /// Write the trace whole to its file (a temp file renamed over it), making the folder when it
    /// is missing. A trace kept in memory writes nothing.
    pub fn write(&self) -> io::Result<()> {
        let Some(file) = &self.file else {
            return Ok(());
        };
        // Held while writing, so two reports never interleave in the temp file.
        let recorded = self.recorded();
        let bytes = serde_json::to_vec(&self.json(&recorded))?;
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let temp = file.with_file_name(format!("{FILE}.tmp"));
        std::fs::write(&temp, bytes)?;
        std::fs::rename(&temp, file)
    }

    fn json(&self, recorded: &Recorded) -> Value {
        let mut tracks = vec![(CORE, "core".to_owned())];
        if recorded.runtime.iter().any(|e| e.tid == RUNTIME) {
            tracks.push((RUNTIME, "runtime".to_owned()));
        }
        for (track, plugin) in recorded.plugins.iter().enumerate() {
            tracks.push((PLUGINS + track as u64, format!("plugin {plugin}")));
        }
        let mut events = vec![json!({
            "name": "process_name", "ph": "M", "pid": PID, "tid": 0,
            "args": { "name": "endue Desk" },
        })];
        events.extend(tracks.into_iter().map(|(tid, name)| {
            json!({
                "name": "thread_name", "ph": "M", "pid": PID, "tid": tid,
                "args": { "name": name },
            })
        }));
        events.extend(recorded.core.iter().map(event));
        if let Some(gap) = webview_start(recorded) {
            events.push(event(&gap));
        }
        events.extend(recorded.runtime.iter().map(event));
        json!({
            "traceEvents": events,
            "displayTimeUnit": "ms",
            "otherData": {
                "origin": "process start",
                "startedAt": self.origin.wall_ms().round() as u64,
            },
        })
    }

    fn recorded(&self) -> MutexGuard<'_, Recorded> {
        self.recorded
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// From the end of the core's last phase to the webview's time origin, when that comes later.
fn webview_start(recorded: &Recorded) -> Option<Event> {
    let webview = recorded.webview?;
    let core_end = recorded
        .core
        .iter()
        .filter_map(|e| Some(e.ts + e.dur?))
        .max()?;
    (webview > core_end).then(|| Event {
        name: WEBVIEW_START.to_owned(),
        cat: "webview",
        ts: core_end,
        dur: Some(webview - core_end),
        tid: CORE,
    })
}

fn event(e: &Event) -> Value {
    match e.dur {
        Some(dur) => json!({
            "name": e.name, "cat": e.cat, "ph": "X", "ts": e.ts, "dur": dur,
            "pid": PID, "tid": e.tid,
        }),
        None => json!({
            "name": e.name, "cat": e.cat, "ph": "i", "s": "p", "ts": e.ts,
            "pid": PID, "tid": e.tid,
        }),
    }
}

/// ms as whole µs.
fn micros(ms: f64) -> i64 {
    (ms * 1000.0).round() as i64
}
