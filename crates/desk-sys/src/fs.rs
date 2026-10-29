//! File primitives. No permission checks happen here: desk-core authorizes every call first.

use std::io;
use std::path::Path;

/// What a folder entry is. Symlinks are reported as such, never followed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
}

/// One folder entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub kind: EntryKind,
    /// Size in bytes, for files only.
    pub size: Option<u64>,
}

/// Read a whole file.
pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    std::fs::read(path)
}

/// Create or replace a whole file, creating missing parent folders when asked. Returns the bytes
/// written.
pub fn write(path: &Path, content: &[u8], create_dirs: bool) -> io::Result<u64> {
    if create_dirs && let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(content.len() as u64)
}

/// List one folder, sorted by name. Not recursive.
pub fn list(path: &Path) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let kind = if file_type.is_symlink() {
            EntryKind::Symlink
        } else if file_type.is_dir() {
            EntryKind::Dir
        } else {
            EntryKind::File
        };
        let size = match kind {
            EntryKind::File => Some(entry.metadata()?.len()),
            EntryKind::Dir | EntryKind::Symlink => None,
        };
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// A running watch. Dropping it stops the watch.
pub struct Watch {
    _watcher: notify::RecommendedWatcher,
}

/// What happened to a watched path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    Created,
    Modified,
    Removed,
}

/// Call `on_change` with each changed path under `path` (recursive) until the `Watch` is dropped.
/// Events are not debounced here; callers coalesce them.
pub fn watch(
    path: &Path,
    on_change: impl Fn(std::path::PathBuf) + Send + 'static,
) -> io::Result<Watch> {
    watch_changes(path, true, move |path, _change| on_change(path))
}

/// Call `on_change` with each changed path and what happened to it, under `path` (and its
/// sub-folders when `recursive`), until the `Watch` is dropped. Not debounced.
pub fn watch_changes(
    path: &Path,
    recursive: bool,
    on_change: impl Fn(std::path::PathBuf, Change) + Send + 'static,
) -> io::Result<Watch> {
    use notify::{EventKind, RecursiveMode, Watcher as _};
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let change = match event.kind {
            EventKind::Create(_) => Change::Created,
            EventKind::Modify(_) => Change::Modified,
            EventKind::Remove(_) => Change::Removed,
            _ => return,
        };
        for path in event.paths {
            on_change(path, change);
        }
    })
    .map_err(io::Error::other)?;
    let mode = if recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };
    watcher.watch(path, mode).map_err(io::Error::other)?;
    Ok(Watch { _watcher: watcher })
}
