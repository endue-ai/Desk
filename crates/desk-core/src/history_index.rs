//! The history's files (ADR 0076): blobs in `objects/<sha256>`, each written once under its content's
//! SHA-256, and one index per path in `paths/<sha256(path)>.json`, rewritten whole:
//!
//! ```json
//! { "version": 1, "path": "/Users/me/notes/a.md",
//!   "versions": [{ "id": "1793520000000-3fa9c1", "at": "2026-11-02T09:20:00Z",
//!                  "caller": "endue.notes", "size": 42, "sha256": "9f86d0..." }] }
//! ```
//!
//! `versions` is newest first, as fs.history lists them. Files whose names start with a dot are temp
//! files a killed write left behind: they are removed when the history opens.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use desk_bridge::FsVersion;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const VERSION: u32 = 1;

/// One path's index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Index {
    pub version: u32,
    pub path: String,
    pub versions: Vec<FsVersion>,
}

/// SHA-256 as lowercase hex.
pub(crate) fn hex(digest: impl AsRef<[u8]>) -> String {
    digest.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// The index name of a path: the SHA-256 of the path as text.
pub(crate) fn key_of(path: &Path) -> String {
    hex(Sha256::digest(path.to_string_lossy().as_bytes()))
}

fn is_sha(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The milliseconds an id starts with, which order versions desk-wide.
pub(crate) fn millis(id: &str) -> Option<u64> {
    let (millis, rest) = id.split_once('-')?;
    let hex6 = rest.len() == 6 && rest.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    hex6.then(|| millis.parse().ok()).flatten()
}

/// A hidden temp file name in `dir`, unique within this process.
fn temp_in(dir: &Path) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(".in-{}-{n}.tmp", std::process::id()))
}

/// Copy the file at `from` into `objects` under its SHA-256, hashing as it copies, and answer the
/// hash and the size. The copy goes to a temp file renamed into place, so a blob is whole or absent.
pub(crate) fn keep_blob(objects: &Path, from: &Path) -> io::Result<(String, u64)> {
    fs::create_dir_all(objects)?;
    let temp = temp_in(objects);
    let copied = copy_hashed(from, &temp);
    let (sha, size) = match copied {
        Ok(done) => done,
        Err(err) => {
            let _ = fs::remove_file(&temp);
            return Err(err);
        }
    };
    let blob = objects.join(&sha);
    if blob.exists() {
        fs::remove_file(&temp)?;
    } else {
        fs::rename(&temp, &blob)?;
        sync_dir(objects);
    }
    Ok((sha, size))
}

fn copy_hashed(from: &Path, to: &Path) -> io::Result<(String, u64)> {
    let mut source = File::open(from)?;
    let mut target = File::options().write(true).create_new(true).open(to)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 256 * 1024];
    let mut size = 0;
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        target.write_all(&buffer[..read])?;
        size += read as u64;
    }
    target.sync_all()?;
    Ok((hex(hasher.finalize()), size))
}

/// The bytes of blob `sha`. `InvalidData` when they no longer hash to it.
pub(crate) fn read_blob(objects: &Path, sha: &str) -> io::Result<Vec<u8>> {
    let bytes = fs::read(objects.join(sha))?;
    if hex(Sha256::digest(&bytes)) != sha {
        let why = format!("the kept version {sha} is damaged");
        return Err(io::Error::new(io::ErrorKind::InvalidData, why));
    }
    Ok(bytes)
}

pub(crate) fn remove_blob(objects: &Path, sha: &str) {
    let _ = fs::remove_file(objects.join(sha));
}

/// Rewrite the index of `key`, or remove it once it holds no version.
pub(crate) fn save(paths: &Path, key: &str, index: &Index) -> io::Result<()> {
    let file = paths.join(format!("{key}.json"));
    if index.versions.is_empty() {
        return match fs::remove_file(&file) {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
            _ => Ok(()),
        };
    }
    let text = serde_json::to_string_pretty(index).map_err(io::Error::other)?;
    desk_sys::fs::write(&file, text.as_bytes(), true).map(drop)
}

/// What `paths` holds: the indexes by key, and the broken ones, each renamed `<name>.broken`
/// (not JSON, another version or shape, or a key that is not its path's). A missing folder holds
/// nothing. Temp files are removed.
pub(crate) fn load(paths: &Path) -> (BTreeMap<String, Index>, Vec<PathBuf>) {
    let mut indexes = BTreeMap::new();
    let mut broken = Vec::new();
    let Ok(entries) = fs::read_dir(paths) else {
        return (indexes, broken);
    };
    for entry in entries.flatten() {
        let file = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            let _ = fs::remove_file(&file);
            continue;
        }
        let Some(key) = name.strip_suffix(".json").filter(|key| is_sha(key)) else {
            continue;
        };
        match read_index(&file).filter(|index| key_of(Path::new(&index.path)) == key) {
            Some(index) => {
                indexes.insert(key.to_owned(), index);
            }
            None => {
                let aside = paths.join(format!("{name}.broken"));
                if fs::rename(&file, &aside).is_ok() {
                    broken.push(aside);
                }
            }
        }
    }
    (indexes, broken)
}

fn read_index(file: &Path) -> Option<Index> {
    let index: Index = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    let whole = |v: &FsVersion| millis(&v.id).is_some() && is_sha(&v.sha256);
    (index.version == VERSION && index.versions.iter().all(whole)).then_some(index)
}

/// Remove the blobs in `objects` that `named` does not hold, and temp files.
pub(crate) fn sweep(objects: &Path, named: &BTreeSet<String>) {
    let Ok(entries) = fs::read_dir(objects) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || (is_sha(&name) && !named.contains(&name)) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Make a rename durable. Best effort: some file systems refuse to sync a folder.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(dir) = File::open(dir) {
        let _ = dir.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}
