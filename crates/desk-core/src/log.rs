//! The desk's log: one ring of the latest entries over every channel, and the same entries as JSON
//! Lines in `desk.log` in the logs folder. When `desk.log` would pass `LOG_ROTATE_BYTES` it becomes
//! `desk.log.1` (replacing the one before), so there are at most two files. At start the ring is
//! filled again from `desk.log.1` then `desk.log`. A file that cannot be written is left alone and
//! the ring still serves, as the store's save does.

use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Write as _;
use std::path::PathBuf;

use desk_bridge::LogEntry;
use serde_json::{Map, Value};

/// How many entries the ring keeps, over every channel.
pub const LOG_RING_ENTRIES: usize = 10_000;

/// How large `desk.log` grows before it becomes `desk.log.1`.
pub const LOG_ROTATE_BYTES: u64 = 4 * 1024 * 1024;

const CURRENT: &str = "desk.log";
const ROTATED: &str = "desk.log.1";

/// What a secret field's value becomes.
const MASK: &str = "***";

/// Field names, lowercased, that hold secrets when they contain one of these.
const SECRET_NAMES: [&str; 9] = [
    "token",
    "secret",
    "password",
    "passwd",
    "authorization",
    "cookie",
    "apikey",
    "api_key",
    "api-key",
];

/// The ring, oldest first, and the file behind it when there is a logs folder.
#[derive(Debug, Default)]
pub(crate) struct Log {
    ring: VecDeque<LogEntry>,
    file: Option<LogFile>,
}

#[derive(Debug)]
struct LogFile {
    dir: PathBuf,
    handle: Option<File>,
    size: u64,
}

impl Log {
    /// A log in `dir`, its ring filled from the files already there.
    pub(crate) fn open(dir: PathBuf) -> Self {
        let mut log = Self::default();
        for name in [ROTATED, CURRENT] {
            let bytes = fs::read(dir.join(name)).unwrap_or_default();
            let entries = bytes
                .split(|b| *b == b'\n')
                .filter_map(|line| serde_json::from_slice::<LogEntry>(line).ok());
            entries.for_each(|entry| log.keep(entry));
        }
        let size = fs::metadata(dir.join(CURRENT)).map_or(0, |m| m.len());
        log.file = Some(LogFile {
            dir,
            handle: None,
            size,
        });
        log
    }

    /// Add an entry to the ring and the file.
    pub(crate) fn push(&mut self, entry: LogEntry) {
        if let Some(file) = &mut self.file {
            file.append(&entry);
        }
        self.keep(entry);
    }

    /// The latest `count` entries, of one channel or of all, oldest first.
    pub(crate) fn tail(&self, channel: Option<&str>, count: usize) -> Vec<LogEntry> {
        let mut entries: Vec<LogEntry> = self
            .ring
            .iter()
            .rev()
            .filter(|entry| channel.is_none_or(|c| entry.channel == c))
            .take(count)
            .cloned()
            .collect();
        entries.reverse();
        entries
    }

    fn keep(&mut self, entry: LogEntry) {
        if self.ring.len() == LOG_RING_ENTRIES {
            self.ring.pop_front();
        }
        self.ring.push_back(entry);
    }
}

impl LogFile {
    fn append(&mut self, entry: &LogEntry) {
        let Ok(mut line) = serde_json::to_vec(entry) else {
            return;
        };
        line.push(b'\n');
        let length = line.len() as u64;
        if self.size > 0 && self.size + length > LOG_ROTATE_BYTES {
            self.rotate();
        }
        let Some(handle) = self.handle() else { return };
        match handle.write_all(&line) {
            Ok(()) => self.size += length,
            // Try a fresh handle on the next write.
            Err(_) => self.handle = None,
        }
    }

    /// `desk.log` becomes `desk.log.1`; the next write starts a new `desk.log`.
    fn rotate(&mut self) {
        self.handle = None;
        let _ = fs::rename(self.dir.join(CURRENT), self.dir.join(ROTATED));
        self.size = 0;
    }

    fn handle(&mut self) -> Option<&mut File> {
        if self.handle.is_none() {
            let _ = fs::create_dir_all(&self.dir);
            let path = self.dir.join(CURRENT);
            let opened = OpenOptions::new().create(true).append(true).open(path);
            self.handle = opened.ok();
        }
        self.handle.as_mut()
    }
}

/// `fields` with every value whose name looks like a secret replaced by `"***"`, through nested
/// objects and arrays. Names stay; other values, strings included, are not scanned.
pub(crate) fn mask(fields: Map<String, Value>) -> Map<String, Value> {
    fields
        .into_iter()
        .map(|(name, value)| {
            let value = if secret(&name) {
                Value::String(MASK.to_owned())
            } else {
                mask_value(value)
            };
            (name, value)
        })
        .collect()
}

fn mask_value(value: Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(mask(fields)),
        Value::Array(items) => Value::Array(items.into_iter().map(mask_value).collect()),
        other => other,
    }
}

fn secret(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    SECRET_NAMES.iter().any(|secret| name.contains(secret))
}
