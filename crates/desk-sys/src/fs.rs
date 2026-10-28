//! File primitives. No permission checks happen here: desk-core authorizes every call first.

use std::io;
use std::path::{Path, PathBuf};

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

/// Create or overwrite a file. Returns the bytes written.
pub fn write(path: &Path, bytes: &[u8]) -> io::Result<u64> {
    std::fs::write(path, bytes)?;
    Ok(bytes.len() as u64)
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
pub enum ChangeKind {
    Created,
    Modified,
    Removed,
}

/// One change under a watched path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub path: PathBuf,
    pub kind: ChangeKind,
}

/// Call `on_change` with each changed path under `path` (recursive) until the `Watch` is dropped.
/// Events are not debounced here; callers coalesce them.
pub fn watch(path: &Path, on_change: impl Fn(PathBuf) + Send + 'static) -> io::Result<Watch> {
    watch_changes(path, true, move |change| on_change(change.path))
}

/// Call `on_change` with each change under `path` (and its sub-folders when `recursive`) until the
/// `Watch` is dropped. A rename is reported as the old path removed and the new one created; when
/// the platform does not say which side a path is, its existence decides.
pub fn watch_changes(
    path: &Path,
    recursive: bool,
    on_change: impl Fn(Change) + Send + 'static,
) -> io::Result<Watch> {
    use notify::event::ModifyKind;
    use notify::{EventKind, RecursiveMode, Watcher as _};
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        for path in event.paths {
            let kind = match event.kind {
                EventKind::Create(_) => ChangeKind::Created,
                EventKind::Remove(_) => ChangeKind::Removed,
                EventKind::Modify(ModifyKind::Name(_)) if path.exists() => ChangeKind::Created,
                EventKind::Modify(ModifyKind::Name(_)) => ChangeKind::Removed,
                EventKind::Modify(_) => ChangeKind::Modified,
                _ => continue,
            };
            on_change(Change { path, kind });
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
