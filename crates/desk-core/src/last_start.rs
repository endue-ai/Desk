//! last-start.json (ADR 0061): how the starts before this one went, so a desk that keeps dying
//! before it is ready starts in safe mode instead of dying again, and a run that ended without
//! quitting is named by the next start (ADR 0187).
//!
//! ```json
//! { "at": "2026-11-02T09:00:00Z", "pid": 4242, "phase": "starting", "failed": 1, "quit": false }
//! ```
//!
//! Each start writes `phase: "starting"` and the ready line marks it `ready`, or `late` past
//! `READY_WITHIN`. `failed` counts the starts in a row before this one that did not reach ready in
//! time; at `CRASH_LOOP` this start is a crash loop. A clean quit marks the record `quit: true`; one
//! still `false` at the next start was killed or crashed where nothing could write ([`Unclean`]). A
//! record without `quit` was written by an older desk, which said nothing of how its run ended. An
//! unreadable file is kept broken and counts as no earlier start.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    /// Whether this run quit cleanly; absent in a record an older desk wrote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quit: Option<bool>,
}

/// This start, as written to last-start.json.
#[derive(Debug)]
pub struct LastStart {
    path: PathBuf,
    at: SystemTime,
    record: Record,
    /// How this start went so far, for a quit that finds no record to mark.
    phase: Mutex<Phase>,
}

/// The run before this one, which ended without quitting: killed, or crashed where no report could
/// be written (a signal, an abort).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unclean {
    /// When it started, as its record says (RFC 3339), and that time read back.
    pub at: String,
    pub started: SystemTime,
    pub pid: u32,
    /// Whether it had reached its ready line.
    pub ready: bool,
}

/// What the earlier starts say about this one.
#[derive(Debug)]
pub struct Begun {
    /// The starts before this one did not reach ready `CRASH_LOOP` times in a row.
    pub crash_loop: bool,
    pub failed_before: u32,
    /// last-start.json itself, when it could not be read.
    pub broken: Option<BrokenFile>,
    /// The run before this one, when it ended without quitting.
    pub unclean: Option<Unclean>,
}

impl LastStart {
    /// Read how the last start went and write this one as `starting`.
    pub fn begin(path: &Path, now: SystemTime, pid: u32) -> (Self, Begun) {
        let broken = screen(path, json_as::<Record>);
        let previous = read(path);
        let failed_before = match &previous {
            Some(record) if record.phase != Phase::Ready => record.failed.saturating_add(1),
            _ => 0,
        };
        let unclean = previous.as_ref().and_then(unclean);
        let start = Self {
            path: path.to_path_buf(),
            at: now,
            record: Record {
                at: rfc3339(now),
                pid,
                phase: Phase::Starting,
                failed: failed_before,
                quit: Some(false),
            },
            phase: Mutex::new(Phase::Starting),
        };
        start.write(&start.record);
        let begun = Begun {
            crash_loop: failed_before >= CRASH_LOOP,
            failed_before,
            broken,
            unclean,
        };
        (start, begun)
    }

    /// The ready line: `ready` when it came within `READY_WITHIN` of the start, `late` otherwise.
    pub fn ready(&self, now: SystemTime) {
        let in_time = now
            .duration_since(self.at)
            .map_or(true, |took| took <= READY_WITHIN);
        let phase = if in_time { Phase::Ready } else { Phase::Late };
        *self.phase.lock().unwrap_or_else(|p| p.into_inner()) = phase;
        self.write(&Record {
            phase,
            ..self.record.clone()
        });
    }

    /// A clean quit: the record as it stands on disk, when it is this run's, marked `quit`; else
    /// this run's own, as it went so far.
    pub fn quit(&self) {
        let record = read(&self.path)
            .filter(|on_disk| on_disk.pid == self.record.pid)
            .unwrap_or_else(|| Record {
                phase: *self.phase.lock().unwrap_or_else(|p| p.into_inner()),
                ..self.record.clone()
            });
        self.write(&Record {
            quit: Some(true),
            ..record
        });
    }

    /// Write the record whole (a temp file renamed over it); a failure only loses the count.
    fn write(&self, record: &Record) {
        if let Ok(text) = serde_json::to_string_pretty(record) {
            let _ = desk_sys::fs::write(&self.path, text.as_bytes(), true);
        }
    }
}

fn read(path: &Path) -> Option<Record> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The run `record` describes, when it ended without quitting.
fn unclean(record: &Record) -> Option<Unclean> {
    if record.quit != Some(false) {
        return None;
    }
    let seconds = crate::time::parse_rfc3339(&record.at).and_then(|s| u64::try_from(s).ok());
    Some(Unclean {
        at: record.at.clone(),
        started: UNIX_EPOCH + Duration::from_secs(seconds.unwrap_or(0)),
        pid: record.pid,
        ready: record.phase != Phase::Starting,
    })
}
