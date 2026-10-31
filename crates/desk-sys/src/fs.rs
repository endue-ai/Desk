//! File primitives. No permission checks happen here: desk-core authorizes every call first.
//! Errors are `io::Error`s whose kind carries the bridge code: `desk_sys::Error::from` maps them.

use std::ffi::{OsStr, OsString};
use std::fs::{OpenOptions, Permissions};
use std::io::{self, Write as _};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

mod watch;
pub use watch::{Change, Changed, Watch, WatchOptions, watch, watch_changes, watch_debounced};

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
    /// When a file or folder last changed; `None` for symlinks, and when the OS has no such time.
    pub modified: Option<SystemTime>,
}

/// Read a whole file.
pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    std::fs::read(path)
}

/// List one folder, sorted by name, with each file's size and each file's and folder's modification
/// time. Not recursive.
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
        let (size, modified) = match kind {
            EntryKind::File => {
                let metadata = entry.metadata()?;
                (Some(metadata.len()), metadata.modified().ok())
            }
            EntryKind::Dir => (None, entry.metadata().and_then(|m| m.modified()).ok()),
            EntryKind::Symlink => (None, None),
        };
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size,
            modified,
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Replace `path` with `content` atomically and return the bytes written; `create_dirs` creates
/// missing parent folders instead of failing with `NotFound`. The bytes go to a temp file in the same
/// folder, are flushed to disk, and the temp file is renamed over the target, so a reader sees the old
/// content or the new, never a mix. An existing file keeps its permissions. A folder or a symlink at
/// `path` is refused (`IsADirectory`, `InvalidInput`: `invalid_params`), since writing through a link
/// could leave the path desk-core checked.
pub fn write(path: &Path, content: &[u8], create_dirs: bool) -> io::Result<u64> {
    let refuse = |kind, why: &str| io::Error::new(kind, format!("{}: {why}", path.display()));
    let Some(name) = path.file_name() else {
        return Err(refuse(io::ErrorKind::InvalidInput, "not a file path"));
    };
    let permissions = match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            return Err(refuse(io::ErrorKind::InvalidInput, "is a symlink"));
        }
        Ok(meta) if meta.is_dir() => {
            return Err(refuse(io::ErrorKind::IsADirectory, "is a folder"));
        }
        Ok(meta) => Some(meta.permissions()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => None,
        Err(err) => return Err(with_path(err, path)),
    };
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    if create_dirs {
        std::fs::create_dir_all(parent).map_err(|err| with_path(err, parent))?;
    }
    match std::fs::metadata(parent) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => {
            return Err(refuse(
                io::ErrorKind::NotADirectory,
                "the parent is not a folder",
            ));
        }
        Err(err) => return Err(with_path(err, parent)),
    }

    let temp = parent.join(temp_name(name));
    let result =
        write_temp(&temp, content, permissions).and_then(|()| std::fs::rename(&temp, path));
    if let Err(err) = result {
        let _ = std::fs::remove_file(&temp);
        return Err(with_path(err, path));
    }
    sync_dir(parent);
    Ok(content.len() as u64)
}

fn write_temp(temp: &Path, content: &[u8], permissions: Option<Permissions>) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(temp)?;
    file.write_all(content)?;
    if let Some(permissions) = permissions {
        file.set_permissions(permissions)?;
    }
    file.sync_all()
}

/// `.<name>.desk-<pid>-<n>.tmp` beside the target: hidden, and unique within this process.
fn temp_name(name: &OsStr) -> OsString {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let mut temp = OsString::from(".");
    temp.push(name);
    temp.push(format!(".desk-{}-{n}.tmp", std::process::id()));
    temp
}

/// Make the rename itself durable. Best effort: some file systems refuse to sync a folder.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(dir) = std::fs::File::open(dir) {
        let _ = dir.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

/// Name the path in an OS error's message, keeping its kind.
fn with_path(err: io::Error, path: &Path) -> io::Error {
    io::Error::new(err.kind(), format!("{}: {err}", path.display()))
}
