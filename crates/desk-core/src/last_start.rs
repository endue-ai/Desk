//! last-start.json (ADR 0061): how the starts before this one went, so a desk that keeps dying
//! before it is ready starts in safe mode instead of dying again.
//!
//! ```json
//! { "at": "2026-11-02T09:00:00Z", "pid": 4242, "phase": "starting", "failed": 1 }
//! ```
//!
//! Each start writes `phase: "starting"` and the ready line marks it `ready`, or `late` past
//! `READY_WITHIN`. `failed` counts the starts in a row before this one that did not reach ready in
//! time; at `CRASH_LOOP` this start is a crash loop. An unreadable file is kept broken and counts as
//! no earlier start.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use desk_plugin_host::rfc3339;
use serde::{Deserialize, Serialize};

use crate::state_file::{BrokenFile, json_as, screen};

/// How long a start may take to reach the ready line and still count as one that made it.
pub const READY_WITHIN: Duration = Duration::from_secs(60);

/// Starts in a row that did not make it, after which the next one runs in safe mode.
pub const CRASH_LOOP: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Starting,
    Ready,
    Late,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    at: String,
    pid: u32,
    phase: Phase,
    #[serde(default)]
    failed: u32,
}

/// This start, as written to last-start.json.
#[derive(Debug)]
pub struct LastStart {
    path: PathBuf,
    at: SystemTime,
    record: Record,
}

/// What the earlier starts say about this one.
#[derive(Debug)]
pub struct Begun {
    /// The starts before this one did not reach ready `CRASH_LOOP` times in a row.
    pub crash_loop: bool,
    pub failed_before: u32,
    /// last-start.json itself, when it could not be read.
    pub broken: Option<BrokenFile>,
}

impl LastStart {
    /// Read how the last start went and write this one as `starting`.
    pub fn begin(path: &Path, now: SystemTime, pid: u32) -> (Self, Begun) {
        let broken = screen(path, json_as::<Record>);
        let previous = std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Record>(&bytes).ok());
        let failed_before = match previous {
            Some(record) if record.phase != Phase::Ready => record.failed.saturating_add(1),
            _ => 0,
        };
        let start = Self {
            path: path.to_path_buf(),
            at: now,
            record: Record {
                at: rfc3339(now),
                pid,
                phase: Phase::Starting,
                failed: failed_before,
            },
        };
        start.write(&start.record);
        let begun = Begun {
            crash_loop: failed_before >= CRASH_LOOP,
            failed_before,
            broken,
        };
        (start, begun)
    }

    /// The ready line: `ready` when it came within `READY_WITHIN` of the start, `late` otherwise.
    pub fn ready(&self, now: SystemTime) {
        let in_time = now
            .duration_since(self.at)
            .map_or(true, |took| took <= READY_WITHIN);
        let phase = if in_time { Phase::Ready } else { Phase::Late };
        self.write(&Record {
            phase,
            ..self.record.clone()
        });
    }

    /// Write the record whole (a temp file renamed over it); a failure only loses the count.
    fn write(&self, record: &Record) {
        if let Ok(text) = serde_json::to_string_pretty(record) {
            let _ = desk_sys::fs::write(&self.path, text.as_bytes(), true);
        }
    }
}
