//! The one file a file backend keeps its registration in: read whole, written whole (a temp file
//! in the same folder, then a rename) and removed, with std only. Every failure is `io_error` with
//! the path.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};

use super::io_error;
use crate::Error;

/// Keeps the temp files of two writes in one process apart.
static NEXT: AtomicU32 = AtomicU32::new(0);

/// The file's text, or `None` when it does not exist. Bytes that are not UTF-8 are replaced, which
/// makes the registration unreadable rather than the read a failure.
pub(super) fn read(path: &Path) -> Result<Option<String>, Error> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(err) => Err(io_error(err, path.display())),
    }
}

/// Write `text` as the whole file, making its folder first. Readers see the old file or the new
/// one, never part of it; a failure leaves the old file and no temp file. On Unix the file is
/// never writable by group or others (0644 at most), which launchd requires of a LaunchAgent.
pub(super) fn write(path: &Path, text: &str) -> Result<(), Error> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(io_error("not a file path", path.display()));
    };
    fs::create_dir_all(dir).map_err(|err| io_error(err, dir.display()))?;
    let temp = dir.join(format!(
        ".{}.{}-{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let written = write_new(&temp, text).and_then(|()| fs::rename(&temp, path));
    written.map_err(|err| {
        let _ = fs::remove_file(&temp);
        io_error(err, path.display())
    })
}

fn write_new(path: &Path, text: &str) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o644);
    let mut file = options.open(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()
}

/// Remove the file; `Ok` when it does not exist.
pub(super) fn remove(path: &Path) -> Result<(), Error> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
        Err(err) => Err(io_error(err, path.display())),
    }
}
