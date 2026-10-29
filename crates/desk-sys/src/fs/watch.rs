//! Watching paths with notify: the raw watches (every event, callers coalesce) and the debounced
//! one (one batch of changed paths per quiet period).

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecursiveMode, Watcher as _};

/// A batch never waits longer than this many quiet periods, even while events keep coming.
const MAX_WAIT_PERIODS: u32 = 10;

/// What happened to a path (bridge `FsChange`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Change {
    Created,
    Modified,
    Removed,
}

/// One changed path in a batch (bridge `fs.changed`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changed {
    /// Under the path the watch was started with, as the caller wrote it.
    pub path: PathBuf,
    pub change: Change,
}

/// How a debounced watch reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WatchOptions {
    /// Watch sub-folders too.
    pub recursive: bool,
    /// How long the path must be quiet before a batch is reported.
    pub debounce: Duration,
}

impl Default for WatchOptions {
    fn default() -> Self {
        Self {
            recursive: true,
            debounce: Duration::from_millis(100),
        }
    }
}

/// A running watch. Dropping it stops the watch; once drop returns, the callback has been dropped
/// and is never called again.
pub struct Watch {
    watcher: Option<notify::RecommendedWatcher>,
    debouncer: Option<(Sender<Message>, JoinHandle<()>)>,
}

impl Drop for Watch {
    fn drop(&mut self) {
        // Stop the OS watch first, so no event arrives after the debouncer is told to stop.
        self.watcher.take();
        if let Some((sender, thread)) = self.debouncer.take() {
            let _ = sender.send(Message::Stop);
            // A callback that drops its own watch must not wait for itself.
            if thread.thread().id() != thread::current().id() {
                let _ = thread.join();
            }
        }
    }
}

enum Message {
    Event(notify::Event),
    Stop,
}

/// Call `on_change` with each changed path under `path` (recursive) until the `Watch` is dropped.
/// Events are not debounced here; callers coalesce them. `watch_debounced` reports batches.
pub fn watch(path: &Path, on_change: impl Fn(PathBuf) + Send + 'static) -> io::Result<Watch> {
    watch_changes(path, true, move |path, _change| on_change(path))
}

/// Call `on_change` with each changed path and what the event says happened to it, under `path`
/// (and its sub-folders when `recursive`), until the `Watch` is dropped. Not debounced: one file
/// write can arrive as several events. Paths are reported under `path` as given, as by
/// `watch_debounced`.
pub fn watch_changes(
    path: &Path,
    recursive: bool,
    on_change: impl Fn(PathBuf, Change) + Send + 'static,
) -> io::Result<Watch> {
    let roots = Roots::of(path)?;
    let real = roots.real.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let change = match event.kind {
            EventKind::Create(_) => Change::Created,
            EventKind::Modify(_) => Change::Modified,
            EventKind::Remove(_) => Change::Removed,
            _ => return,
        };
        for path in event.paths {
            on_change(roots.shown(&path), change);
        }
    })
    .map_err(|err| watch_error(err, path))?;
    watcher
        .watch(&real, mode(recursive))
        .map_err(|err| watch_error(err, path))?;
    Ok(Watch {
        watcher: Some(watcher),
        debouncer: None,
    })
}

/// Call `on_changes` with one batch of changed paths per quiet period, until the `Watch` is dropped.
/// A path appears once per batch: `removed` if it is gone when the batch is reported, `created` if it
/// was created during the batch, otherwise `modified`. Paths are reported under `path` as given, even
/// when the OS reports them through a resolved symlink (macOS `/var` is `/private/var`).
pub fn watch_debounced(
    path: &Path,
    options: WatchOptions,
    on_changes: impl FnMut(Vec<Changed>) + Send + 'static,
) -> io::Result<Watch> {
    let roots = Roots::of(path)?;
    let (sender, receiver) = mpsc::channel();
    let events = sender.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let _ = events.send(Message::Event(event));
        }
    })
    .map_err(|err| watch_error(err, path))?;
    watcher
        .watch(&roots.real, mode(options.recursive))
        .map_err(|err| watch_error(err, path))?;
    let thread = thread::Builder::new()
        .name("desk-fs-watch".to_owned())
        .spawn(move || debounce(&receiver, options.debounce, &roots, on_changes))?;
    Ok(Watch {
        watcher: Some(watcher),
        debouncer: Some((sender, thread)),
    })
}

fn mode(recursive: bool) -> RecursiveMode {
    if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    }
}

/// The watched path as the caller gave it, and as the OS reports it.
struct Roots {
    given: PathBuf,
    real: PathBuf,
}

impl Roots {
    /// Resolving the path first also makes a missing one `NotFound` on every OS (notify's Windows
    /// backend reports it as a generic error).
    fn of(path: &Path) -> io::Result<Self> {
        let real = path
            .canonicalize()
            .map_err(|err| io::Error::new(err.kind(), format!("{}: {err}", path.display())))?;
        Ok(Self {
            given: path.to_path_buf(),
            real,
        })
    }

    fn shown(&self, path: &Path) -> PathBuf {
        match path.strip_prefix(&self.real) {
            Ok(rest) if rest.as_os_str().is_empty() => self.given.clone(),
            Ok(rest) => self.given.join(rest),
            Err(_) => path.to_path_buf(),
        }
    }
}

fn debounce(
    receiver: &Receiver<Message>,
    quiet: Duration,
    roots: &Roots,
    mut on_changes: impl FnMut(Vec<Changed>),
) {
    // Path -> whether it was created during the batch.
    let mut pending: BTreeMap<PathBuf, bool> = BTreeMap::new();
    let mut started = Instant::now();
    loop {
        let message = if pending.is_empty() {
            receiver.recv().map_err(|_| RecvTimeoutError::Disconnected)
        } else {
            let deadline = started + quiet * MAX_WAIT_PERIODS;
            receiver.recv_timeout(quiet.min(deadline.saturating_duration_since(Instant::now())))
        };
        match message {
            Ok(Message::Event(event)) => {
                if pending.is_empty() {
                    started = Instant::now();
                }
                record(&mut pending, event);
            }
            Ok(Message::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {
                let batch = flush(&mut pending, roots);
                if !batch.is_empty() {
                    on_changes(batch);
                }
            }
        }
    }
}

fn record(pending: &mut BTreeMap<PathBuf, bool>, event: notify::Event) {
    let created_at = |index: usize| match event.kind {
        EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => true,
        // A rename names the old path first and the new one second.
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => index == 1,
        _ => false,
    };
    if matches!(event.kind, EventKind::Access(_) | EventKind::Other) {
        return;
    }
    for (index, path) in event.paths.iter().enumerate() {
        let created = created_at(index);
        *pending.entry(path.clone()).or_insert(created) |= created;
    }
}

fn flush(pending: &mut BTreeMap<PathBuf, bool>, roots: &Roots) -> Vec<Changed> {
    std::mem::take(pending)
        .into_iter()
        .map(|(path, created)| {
            let change = if std::fs::symlink_metadata(&path).is_err() {
                Change::Removed
            } else if created {
                Change::Created
            } else {
                Change::Modified
            };
            Changed {
                path: roots.shown(&path),
                change,
            }
        })
        .collect()
}

/// notify's errors as `io::Error`s whose kind maps to the bridge code (`desk_sys::Error::from`).
fn watch_error(err: notify::Error, path: &Path) -> io::Error {
    let kind = match &err.kind {
        notify::ErrorKind::Io(io) => io.kind(),
        notify::ErrorKind::PathNotFound | notify::ErrorKind::WatchNotFound => {
            io::ErrorKind::NotFound
        }
        notify::ErrorKind::InvalidConfig(_) => io::ErrorKind::InvalidInput,
        notify::ErrorKind::MaxFilesWatch | notify::ErrorKind::Generic(_) => io::ErrorKind::Other,
    };
    io::Error::new(kind, format!("{}: {err}", path.display()))
}
