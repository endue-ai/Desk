//! The history of what fs.write replaced (ADR 0076), in memory over its files (`history_index`):
//! every index, how many versions name each blob and how large it is. Keeping a version prunes the
//! path to `max_versions`, then the oldest versions desk-wide while the blobs the indexes name hold
//! more than `max_bytes`; a blob goes once no index names it.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::FsVersion;
use desk_plugin_host::rfc3339;

use crate::history_index::{self as files, Index, key_of, millis};

/// The bounds the desk.files settings set.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Limits {
    pub max_bytes: u64,
    pub max_versions: usize,
}

/// What keeping the bytes before a write came to.
pub(crate) enum Kept {
    Version(String),
    /// A new file, the same bytes, a history kept at 0 versions, or not a regular file.
    Nothing,
    /// The file is larger than the whole budget: written without a version.
    TooLarge(u64),
}

pub(crate) struct History {
    dir: PathBuf,
    indexes: BTreeMap<String, Index>,
    /// Blob → (size, how many versions name it).
    blobs: BTreeMap<String, (u64, usize)>,
    last_millis: u64,
}

impl History {
    /// The history in `dir`, and a warning for each index it had to set aside. Never fails: a
    /// missing folder is an empty history.
    pub(crate) fn open(dir: PathBuf) -> (Self, Vec<String>) {
        let (indexes, broken) = files::load(&dir.join("paths"));
        let mut history = Self {
            dir,
            indexes,
            blobs: BTreeMap::new(),
            last_millis: 0,
        };
        for index in history.indexes.values() {
            for version in &index.versions {
                let entry = history
                    .blobs
                    .entry(version.sha256.clone())
                    .or_insert((version.size, 0));
                entry.1 += 1;
                history.last_millis = history.last_millis.max(millis(&version.id).unwrap_or(0));
            }
        }
        let named: BTreeSet<String> = history.blobs.keys().cloned().collect();
        files::sweep(&history.objects(), &named);
        let warnings = broken
            .iter()
            .map(|aside| {
                format!(
                    "fs history: an index was not readable and was set aside as {}; that file's history starts empty",
                    aside.display()
                )
            })
            .collect();
        (history, warnings)
    }

    fn objects(&self) -> PathBuf {
        self.dir.join("objects")
    }

    fn paths(&self) -> PathBuf {
        self.dir.join("paths")
    }

    /// The versions of `real` (a file named by its folder's real path), newest first.
    pub(crate) fn versions(&self, real: &Path) -> Vec<FsVersion> {
        self.indexes
            .get(&key_of(real))
            .map(|index| index.versions.clone())
            .unwrap_or_default()
    }

    /// The bytes of one version of `real`: `NotFound` when its index or its blob does not hold it,
    /// `InvalidData` when the blob no longer hashes to it.
    pub(crate) fn read(&self, real: &Path, id: &str) -> io::Result<Vec<u8>> {
        let version = self
            .versions(real)
            .into_iter()
            .find(|v| v.id == id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("no version {id}")))?;
        files::read_blob(&self.objects(), &version.sha256)
    }

    /// Before `caller` writes `new` over `file` (named `real`), keep its bytes as a version.
    pub(crate) fn keep(
        &mut self,
        real: &Path,
        file: &Path,
        new: &[u8],
        caller: &str,
        now: SystemTime,
        limits: Limits,
    ) -> io::Result<Kept> {
        let meta = match fs::symlink_metadata(file) {
            Ok(meta) if meta.is_file() => meta,
            _ => return Ok(Kept::Nothing),
        };
        if limits.max_versions == 0 {
            return Ok(Kept::Nothing);
        }
        if meta.len() > limits.max_bytes {
            return Ok(Kept::TooLarge(meta.len()));
        }
        if meta.len() == new.len() as u64 && fs::read(file)? == new {
            return Ok(Kept::Nothing);
        }
        let (sha256, size) = files::keep_blob(&self.objects(), file)?;
        let id = self.next_id(now)?;
        let key = key_of(real);
        let index = self.indexes.entry(key.clone()).or_insert_with(|| Index {
            version: files::VERSION,
            path: real.to_string_lossy().into_owned(),
            versions: Vec::new(),
        });
        index.versions.insert(
            0,
            FsVersion {
                id: id.clone(),
                at: rfc3339(now),
                caller: caller.to_owned(),
                size,
                sha256: sha256.clone(),
            },
        );
        self.blobs.entry(sha256).or_insert((size, 0)).1 += 1;
        let mut changed = BTreeSet::from([key.clone()]);
        while self.indexes[&key].versions.len() > limits.max_versions {
            self.drop_oldest_of(&key);
        }
        while self.bytes() > limits.max_bytes {
            let Some(oldest) = self.oldest_key() else {
                break;
            };
            self.drop_oldest_of(&oldest);
            changed.insert(oldest);
        }
        self.save(&changed)?;
        Ok(Kept::Version(id))
    }

    /// Take a version back out (the write it was kept for failed).
    pub(crate) fn take_back(&mut self, real: &Path, id: &str) {
        let key = key_of(real);
        let Some(index) = self.indexes.get_mut(&key) else {
            return;
        };
        let Some(at) = index.versions.iter().position(|v| v.id == id) else {
            return;
        };
        let version = index.versions.remove(at);
        self.unref(&version.sha256);
        let _ = self.save(&BTreeSet::from([key]));
    }

    /// The bytes of the blobs the indexes name, each counted once.
    fn bytes(&self) -> u64 {
        self.blobs.values().map(|(size, _)| size).sum()
    }

    /// The index whose oldest version is the oldest desk-wide.
    fn oldest_key(&self) -> Option<String> {
        self.indexes
            .iter()
            .filter_map(|(key, index)| Some((millis(&index.versions.last()?.id)?, key)))
            .min()
            .map(|(_, key)| key.clone())
    }

    fn drop_oldest_of(&mut self, key: &str) {
        if let Some(version) = self
            .indexes
            .get_mut(key)
            .and_then(|index| index.versions.pop())
        {
            self.unref(&version.sha256);
        }
    }

    fn unref(&mut self, sha: &str) {
        let Some((_, refs)) = self.blobs.get_mut(sha) else {
            return;
        };
        *refs -= 1;
        if *refs == 0 {
            self.blobs.remove(sha);
            files::remove_blob(&self.objects(), sha);
        }
    }

    /// Rewrite the indexes of `keys`; those left empty go.
    fn save(&mut self, keys: &BTreeSet<String>) -> io::Result<()> {
        let paths = self.paths();
        let mut result = Ok(());
        for key in keys {
            if let Some(index) = self.indexes.get(key) {
                let saved = files::save(&paths, key, index);
                result = result.and(saved);
                if index.versions.is_empty() {
                    self.indexes.remove(key);
                }
            }
        }
        result
    }

    /// `<unix-ms>-<6 hex>`, its milliseconds after every id before it, so ids order versions.
    fn next_id(&mut self, now: SystemTime) -> io::Result<String> {
        let now = now
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
        self.last_millis = now.max(self.last_millis + 1);
        let mut bits = [0u8; 3];
        getrandom::fill(&mut bits).map_err(|e| io::Error::other(e.to_string()))?;
        Ok(format!("{}-{}", self.last_millis, files::hex(bits)))
    }
}

/// `path` with its folder's real path (no symlinks, no `..`), so one file has one history however
/// it is named. The path as it is when the folder does not resolve.
pub(crate) fn real_path(path: &Path) -> PathBuf {
    let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else {
        return path.to_path_buf();
    };
    fs::canonicalize(folder).map_or_else(|_| path.to_path_buf(), |real| real.join(name))
}
