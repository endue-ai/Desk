//! The one rule for the desk's state files (ADR 0061): a file that cannot be read as what it should
//! hold starts empty, and the unreadable copy is kept beside it as `<name>.broken` (replacing an
//! older one), so nothing the person had is overwritten by the next save. A missing file is simply
//! new. Each state holder says what "readable" means for its file; this module moves the file aside
//! and says which file it was.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;

/// A state file that was unreadable at start, now kept beside itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokenFile {
    /// The file's name, as the person sees it in the folder: `store.json`.
    pub name: String,
    /// Where the unreadable copy is now: `<path>.broken`.
    pub kept: PathBuf,
}

/// Move `path` aside to `<path>.broken`, replacing an older broken copy. `None` when there is no
/// file there or it could not be moved (it then stays, and the holder starts empty all the same).
pub fn keep_broken(path: &Path) -> Option<BrokenFile> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let kept = path.with_file_name(format!("{name}.broken"));
    match fs::rename(path, &kept) {
        Ok(()) => Some(BrokenFile { name, kept }),
        Err(_) => None,
    }
}

/// Keep `path` broken when it exists and `readable` says its bytes are not what they should be, or
/// it cannot be read at all. A missing file, or one that reads, reports nothing.
pub(crate) fn screen(path: &Path, readable: fn(&[u8]) -> bool) -> Option<BrokenFile> {
    match fs::read(path) {
        Ok(bytes) if readable(&bytes) => None,
        Ok(_) => keep_broken(path),
        Err(why) if why.kind() == io::ErrorKind::NotFound => None,
        Err(_) => keep_broken(path),
    }
}

/// Whether `bytes` are JSON of the shape `T` (the holder's own file type).
pub(crate) fn json_as<T: DeserializeOwned>(bytes: &[u8]) -> bool {
    serde_json::from_slice::<T>(bytes).is_ok()
}

/// The `.broken` files directly in `dir`, by name, for `desk doctor`.
pub fn broken_in(dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(dir)
        .map(|read| read.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    found.retain(|path| {
        path.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension == "broken")
    });
    found.sort();
    found
}
