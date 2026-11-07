//! `stat`, `mkdir` and `rename`, and the checks `copy` shares: what exists at a path, and a folder
//! moved or copied into itself.

use std::fs::Metadata;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::{EntryKind, kind_of, with_path};

/// What one path is, without following a symlink at it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stat {
    pub kind: EntryKind,
    /// Size in bytes, for files only.
    pub size: Option<u64>,
    /// When a file or folder last changed; `None` for symlinks, and when the OS has no such time.
    pub modified: Option<SystemTime>,
    /// The entry's own read-only flag (`Permissions::readonly`: no write bit on Unix, the read-only
    /// attribute on Windows), not whether the current user may write it.
    pub readonly: bool,
}

/// Describe `path`. A symlink is `Symlink` with no size or time, its target not followed; a missing
/// path is `NotFound`.
pub fn stat(path: &Path) -> io::Result<Stat> {
    let meta = std::fs::symlink_metadata(path).map_err(|err| with_path(err, path))?;
    let kind = kind_of(meta.file_type());
    let (size, modified) = match kind {
        EntryKind::File => (Some(meta.len()), meta.modified().ok()),
        EntryKind::Dir => (None, meta.modified().ok()),
        EntryKind::Symlink => (None, None),
    };
    Ok(Stat {
        kind,
        size,
        modified,
        readonly: meta.permissions().readonly(),
    })
}

/// Create the folder `path` and return the folders created, outermost first. `parents` also creates
/// missing parent folders, which a plain call reports as `NotFound`. Any entry already at `path`,
/// a folder too, is `AlreadyExists` even with `parents`, so the list is exactly what an undo removes.
/// When a folder cannot be created, the ones this call made are removed again.
pub fn mkdir(path: &Path, parents: bool) -> io::Result<Vec<PathBuf>> {
    if path.file_name().is_none() {
        return Err(refuse(
            io::ErrorKind::InvalidInput,
            path,
            "not a folder path",
        ));
    }
    if entry_at(path)?.is_some() {
        return Err(refuse(io::ErrorKind::AlreadyExists, path, "already exists"));
    }
    let mut missing = vec![path];
    if parents {
        for dir in path.ancestors().skip(1) {
            if dir.as_os_str().is_empty() {
                break;
            }
            match std::fs::metadata(dir) {
                Ok(meta) if meta.is_dir() => break,
                Ok(_) => return Err(refuse(io::ErrorKind::NotADirectory, dir, "not a folder")),
                Err(err) if err.kind() == io::ErrorKind::NotFound => missing.push(dir),
                Err(err) => return Err(with_path(err, dir)),
            }
        }
    }
    let mut created: Vec<PathBuf> = Vec::with_capacity(missing.len());
    for dir in missing.into_iter().rev() {
        if let Err(err) = std::fs::create_dir(dir) {
            for made in created.iter().rev() {
                let _ = std::fs::remove_dir(made);
            }
            return Err(with_path(err, dir));
        }
        created.push(dir.to_path_buf());
    }
    Ok(created)
}

/// Rename or move `from` (a file, a folder with its contents, or a link itself) to `to`. Never
/// overwrites: an entry at `to` is `AlreadyExists`, unless it is `from` under another spelling (a
/// case-only rename on a case-insensitive volume). A folder moved into itself is `InvalidInput`.
/// Across volumes the OS refuses (`CrossesDevices`); this never copies and deletes instead.
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    let meta = std::fs::symlink_metadata(from).map_err(|err| with_path(err, from))?;
    if meta.is_dir() {
        refuse_into_itself(from, to)?;
    }
    if let Some(target) = entry_at(to)?
        && !same_entry(from, &meta, to, &target)
    {
        return Err(refuse(io::ErrorKind::AlreadyExists, to, "already exists"));
    }
    std::fs::rename(from, to).map_err(|err| {
        let message = format!("{} to {}: {err}", from.display(), to.display());
        io::Error::new(err.kind(), message)
    })
}

/// The entry at `path`, a symlink itself and not its target, or `None` when nothing is there.
pub(super) fn entry_at(path: &Path) -> io::Result<Option<Metadata>> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => Ok(Some(meta)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(with_path(err, path)),
    }
}

/// The folder `path` is in; `.` for a bare name.
pub(super) fn parent_of(path: &Path) -> &Path {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    }
}

/// Refuse to put the folder `from` at `to` inside itself, comparing real paths, so neither another
/// spelling of a name nor a link in `to`'s path gets past it. `to`'s folder must exist.
pub(super) fn refuse_into_itself(from: &Path, to: &Path) -> io::Result<()> {
    let from_real = from.canonicalize().map_err(|err| with_path(err, from))?;
    let parent = parent_of(to);
    let parent_real = parent
        .canonicalize()
        .map_err(|err| with_path(err, parent))?;
    if parent_real.starts_with(&from_real) {
        let why = format!("inside {}, the folder it would be put in", from.display());
        return Err(refuse(io::ErrorKind::InvalidInput, to, &why));
    }
    Ok(())
}

/// An error of `kind` that names `path`.
pub(super) fn refuse(kind: io::ErrorKind, path: &Path, why: &str) -> io::Error {
    io::Error::new(kind, format!("{}: {why}", path.display()))
}

/// Whether the entry at `to` is `from` itself: same device and inode.
#[cfg(unix)]
fn same_entry(_from: &Path, from: &Metadata, _to: &Path, to: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    from.dev() == to.dev() && from.ino() == to.ino()
}

/// Whether the entry at `to` is `from` itself: the same folder and names equal ignoring case, and
/// the same real path, so two names in a case-sensitive folder stay two entries.
#[cfg(windows)]
fn same_entry(from: &Path, _: &Metadata, to: &Path, _: &Metadata) -> bool {
    fn equal<T: PartialEq>(a: Option<T>, b: Option<T>) -> bool {
        a.is_some() && a == b
    }
    let lower = |path: &Path| path.file_name().map(|n| n.to_string_lossy().to_lowercase());
    let real_parent = |path: &Path| parent_of(path).canonicalize().ok();
    equal(lower(from), lower(to))
        && equal(real_parent(from), real_parent(to))
        && equal(from.canonicalize().ok(), to.canonicalize().ok())
}

#[cfg(not(any(unix, windows)))]
fn same_entry(_: &Path, _: &Metadata, _: &Path, _: &Metadata) -> bool {
    false
}
