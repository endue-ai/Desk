//! Files on disk, for the paths the mock host takes as absolute: `fs.read` reads the file and
//! `fs.list` lists the folder, with each entry's `modified-at` from its metadata.

use std::fs;
use std::io::ErrorKind;

use desk_plugin_host::{DirEntry, EntryKind, Error, ErrorCode, rfc3339};

pub fn read(path: &str) -> Result<Vec<u8>, Error> {
    fs::read(path).map_err(|e| io(path, &e))
}

pub fn list(path: &str) -> Result<Vec<DirEntry>, Error> {
    let mut listed = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| io(path, &e))? {
        let entry = entry.map_err(|e| io(path, &e))?;
        let meta = entry.metadata().map_err(|e| io(path, &e))?;
        let kind = if meta.is_dir() {
            EntryKind::Dir
        } else if meta.is_symlink() {
            EntryKind::Symlink
        } else {
            EntryKind::File
        };
        listed.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size: meta.is_file().then_some(meta.len()),
            modified_at: meta.modified().ok().map(rfc3339),
        });
    }
    Ok(listed)
}

fn io(path: &str, error: &std::io::Error) -> Error {
    let code = match error.kind() {
        ErrorKind::NotFound => ErrorCode::NotFound,
        _ => ErrorCode::IoError,
    };
    Error {
        code,
        message: format!("{path}: {error}"),
    }
}
