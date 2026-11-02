//! The updates folder (`<data>/updates`): the one build kept on disk with its `staged.json`, the
//! rollout salt, and the newest index serial seen per channel. Bytes are checked (length and sha256)
//! on the way in and again on the way out.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::status::Chosen;
use crate::verify::sha256_hex;

const STAGED: &str = "staged.json";
const SALT: &str = "salt";
const SEEN: &str = "seen.json";

pub struct Stage {
    dir: PathBuf,
}

impl Stage {
    pub fn open(dir: impl Into<PathBuf>) -> io::Result<Self> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The staged build, when `staged.json` reads and its file is there at its length.
    pub fn staged(&self) -> Option<Chosen> {
        let text = fs::read(self.dir.join(STAGED)).ok()?;
        let chosen: Chosen = serde_json::from_slice(&text).ok()?;
        let len = fs::metadata(self.file(&chosen)).ok()?.len();
        (len == chosen.size).then_some(chosen)
    }

    /// Keep `bytes` as `chosen`'s artifact, replacing any other staged build. Refused when the length
    /// or the sha256 differs from what the manifest said.
    pub fn put(&self, chosen: &Chosen, bytes: &[u8]) -> Result<(), String> {
        check(chosen, bytes)?;
        let folder = self.dir.join(&chosen.version);
        let written = (|| {
            fs::create_dir_all(&folder)?;
            let partial = folder.join(format!("{}.partial", chosen.file));
            fs::write(&partial, bytes)?;
            fs::rename(&partial, self.file(chosen))?;
            let record = serde_json::to_vec_pretty(chosen).map_err(io::Error::other)?;
            let temp = self.dir.join(format!("{STAGED}.partial"));
            fs::write(&temp, record)?;
            fs::rename(&temp, self.dir.join(STAGED))
        })();
        written.map_err(|e| format!("the update could not be kept on disk: {e}"))?;
        self.remove_builds_but(Some(&chosen.version));
        Ok(())
    }

    /// The staged artifact's bytes, checked again against `chosen`.
    pub fn read(&self, chosen: &Chosen) -> Result<Vec<u8>, String> {
        let bytes =
            fs::read(self.file(chosen)).map_err(|e| format!("the staged update is gone: {e}"))?;
        check(chosen, &bytes)?;
        Ok(bytes)
    }

    /// Forget the staged build and remove its files.
    pub fn discard(&self) {
        let _ = fs::remove_file(self.dir.join(STAGED));
        self.remove_builds_but(None);
    }

    /// This desk's rollout salt: 16 random bytes made once and never sent anywhere.
    pub fn salt(&self) -> Vec<u8> {
        let path = self.dir.join(SALT);
        if let Ok(salt) = fs::read(&path)
            && salt.len() == 16
        {
            return salt;
        }
        let mut salt = vec![0u8; 16];
        if getrandom::fill(&mut salt).is_err() {
            // Without randomness every desk shares bucket 0's answer: rollouts still end at 100.
            salt.fill(0);
        }
        let _ = fs::write(&path, &salt);
        salt
    }

    /// The newest index serial seen for `channel`.
    pub fn seen(&self, channel: &str) -> Option<u64> {
        self.seen_all().get(channel).copied()
    }

    /// Remember `serial` for `channel` when it is the newest seen.
    pub fn see(&self, channel: &str, serial: u64) {
        let mut seen = self.seen_all();
        if seen.get(channel).is_some_and(|known| *known >= serial) {
            return;
        }
        seen.insert(channel.to_owned(), serial);
        if let Ok(text) = serde_json::to_vec(&seen) {
            let _ = fs::write(self.dir.join(SEEN), text);
        }
    }

    fn seen_all(&self) -> BTreeMap<String, u64> {
        fs::read(self.dir.join(SEEN))
            .ok()
            .and_then(|text| serde_json::from_slice(&text).ok())
            .unwrap_or_default()
    }

    fn file(&self, chosen: &Chosen) -> PathBuf {
        self.dir.join(&chosen.version).join(&chosen.file)
    }

    /// Remove every build folder except `keep`'s.
    fn remove_builds_but(&self, keep: Option<&str>) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let is_build = entry.file_type().is_ok_and(|t| t.is_dir());
            if is_build && keep != name.to_str() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// Whether `bytes` are `chosen`'s artifact by length and sha256.
fn check(chosen: &Chosen, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 != chosen.size {
        return Err(format!(
            "the update is {} bytes, not the {} its manifest names",
            bytes.len(),
            chosen.size
        ));
    }
    if !sha256_hex(bytes).eq_ignore_ascii_case(&chosen.sha256) {
        return Err("the update's sha256 differs from its manifest".to_owned());
    }
    Ok(())
}
