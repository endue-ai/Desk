//! Local crash reports (#322). A panic hook (`install_hook`) and the webview's uncaught errors
//! (`Report::webview`) write `<data>/crashes/<timestamp>.json`: the version, the OS, the message, a
//! backtrace and the plugins that were on, with every path under the person's home as `~` and long
//! text cut. `desk doctor --last-crash` prints the newest; the next start takes it once
//! (`take_unseen`) to show a notice. Nothing is uploaded (ADR 0007).

mod redact;
mod time;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use redact::{BACKTRACE_MAX, MESSAGE_MAX, cut, redact};

/// The report format; it becomes a spec with the upload task (ADR 0007).
pub const SCHEMA: u32 = 1;
/// The most reports kept; older ones go when a new one is written.
pub const KEEP: usize = 20;
/// The folder under the data folder, and the file that names the newest report already shown.
pub const FOLDER: &str = "crashes";
const SEEN: &str = ".seen";

/// One crash, as written to disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub schema: u32,
    /// `panic` (the Rust side) or `webview` (an uncaught error in the shell's window).
    pub kind: String,
    pub at: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    pub os: String,
    pub arch: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread: Option<String>,
    pub backtrace: Vec<String>,
    pub plugins: Vec<String>,
}

/// What a report says about the desk, set once at start; the plugins are refreshed as they change.
#[derive(Debug, Default)]
pub struct Context {
    pub version: String,
    pub commit: Option<String>,
    /// The person's home folder, which reports never name.
    pub home: Option<String>,
    plugins: Mutex<Vec<String>>,
}

impl Context {
    pub fn new(version: &str, commit: Option<&str>, home: Option<&Path>) -> Self {
        Self {
            version: version.to_owned(),
            commit: commit.map(str::to_owned),
            home: home.map(|h| h.display().to_string()),
            plugins: Mutex::default(),
        }
    }

    /// The ids of the plugins that are on now.
    pub fn set_plugins(&self, ids: Vec<String>) {
        if let Ok(mut plugins) = self.plugins.lock() {
            *plugins = ids;
        }
    }

    /// The plugins, without waiting: a panic while the list is being set reports none.
    fn plugins_now(&self) -> Vec<String> {
        self.plugins
            .try_lock()
            .map(|p| p.clone())
            .unwrap_or_default()
    }
}

impl Report {
    fn new(kind: &str, message: &str, backtrace: Vec<String>, context: &Context) -> Self {
        let home = context.home.as_deref();
        Self {
            schema: SCHEMA,
            kind: kind.to_owned(),
            at: time::rfc3339(SystemTime::now()),
            version: context.version.clone(),
            commit: context.commit.clone(),
            os: std::env::consts::OS.to_owned(),
            arch: std::env::consts::ARCH.to_owned(),
            message: cut(&redact(message, home), MESSAGE_MAX),
            location: None,
            thread: None,
            backtrace: backtrace
                .iter()
                .filter(|line| !line.trim().is_empty())
                .take(BACKTRACE_MAX)
                .map(|line| cut(&redact(line, home), MESSAGE_MAX))
                .collect(),
            plugins: context.plugins_now(),
        }
    }

    /// A Rust panic: its message, where it happened, on which thread, and the backtrace.
    pub fn panic(
        message: &str,
        location: Option<&str>,
        thread: Option<&str>,
        backtrace: &str,
        context: &Context,
    ) -> Self {
        let lines = backtrace.lines().map(str::to_owned).collect();
        let mut report = Self::new("panic", message, lines, context);
        report.location = location.map(|l| redact(l, context.home.as_deref()));
        report.thread = thread.map(str::to_owned);
        report
    }

    /// An uncaught error or rejection in the shell's window: its message and JavaScript stack.
    pub fn webview(message: &str, stack: &str, context: &Context) -> Self {
        let lines = stack.lines().map(str::to_owned).collect();
        Self::new("webview", message, lines, context)
    }
}

/// The crash reports of one data folder.
#[derive(Debug, Clone)]
pub struct Crashes {
    dir: PathBuf,
}

impl Crashes {
    pub fn in_data(data: &Path) -> Self {
        Self {
            dir: data.join(FOLDER),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Write `report` as a new file and keep the newest `KEEP`.
    pub fn write(&self, report: &Report) -> io::Result<PathBuf> {
        fs::create_dir_all(&self.dir)?;
        let stamp = time::stamp(SystemTime::now());
        let mut path = self.dir.join(format!("{stamp}.json"));
        let mut n = 0;
        while path.exists() {
            n += 1;
            path = self.dir.join(format!("{stamp}-{n}.json"));
        }
        let text = serde_json::to_string_pretty(report).map_err(io::Error::other)?;
        fs::write(&path, format!("{text}\n"))?;
        for old in self.names().iter().rev().skip(KEEP) {
            let _ = fs::remove_file(self.dir.join(old));
        }
        Ok(path)
    }

    /// The report file names, oldest first.
    fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .filter(|name| name.ends_with(".json"))
            .collect();
        names.sort_by_key(|name| order(name));
        names
    }

    pub fn count(&self) -> usize {
        self.names().len()
    }

    /// The newest report: its file and what it holds, as JSON.
    pub fn newest(&self) -> Option<(PathBuf, Value)> {
        let name = self.names().pop()?;
        let path = self.dir.join(&name);
        let value = serde_json::from_str(&fs::read_to_string(&path).ok()?).ok()?;
        Some((path, value))
    }

    /// The newest report when it was not shown yet, marked shown; then nothing until a newer one.
    pub fn take_unseen(&self) -> Option<Value> {
        let name = self.names().pop()?;
        let seen = fs::read_to_string(self.dir.join(SEEN)).unwrap_or_default();
        if !seen.trim().is_empty() && order(&name) <= order(seen.trim()) {
            return None;
        }
        let _ = fs::write(self.dir.join(SEEN), &name);
        serde_json::from_str(&fs::read_to_string(self.dir.join(&name)).ok()?).ok()
    }
}

/// A file name's place in time: its stamp, then the clash number.
fn order(name: &str) -> (String, u32) {
    let stem = name.trim_end_matches(".json");
    match stem.split_once('-') {
        Some((stamp, n)) => (stamp.to_owned(), n.parse().unwrap_or(0)),
        None => (stem.to_owned(), 0),
    }
}

/// Write a report for every panic in `data`, then run the hook that was there before.
pub fn install_hook(data: PathBuf, context: Arc<Context>) {
    let crashes = Crashes::in_data(&data);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "a panic with no message".to_owned());
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
        let current = std::thread::current();
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let report = Report::panic(
            &message,
            location.as_deref(),
            current.name(),
            &backtrace,
            &context,
        );
        if let Err(why) = crashes.write(&report) {
            eprintln!("endue Desk: the crash report was not written ({why})");
        }
        previous(info);
    }));
}
