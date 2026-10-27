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
