//! What the last sync read: each transcript's size, change time, item id and title, so the next one
//! reads only what changed. Kept as JSON in the desk's data folder; a file that cannot be read starts
//! over, which costs one full read and loses nothing.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// The shape's version; another one starts over.
const VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Seen {
    pub version: u32,
    /// By transcript path.
    pub files: BTreeMap<String, Mark>,
}

/// One transcript as it was read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mark {
    pub size: u64,
    pub modified: u64,
    /// The item it became; empty when it became none.
    pub id: String,
    /// The thread name it was read with (Codex), so a rename reads it again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl Seen {
    /// What `path` holds, or a fresh start.
    pub fn load(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Seen>(&bytes).ok())
            .filter(|seen| seen.version == VERSION)
            .unwrap_or_else(Seen::fresh)
    }

    pub fn fresh() -> Self {
        Self {
            version: VERSION,
            files: BTreeMap::new(),
        }
    }

    /// Write it through a temporary file, so a crash leaves the old one whole.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let temp = path.with_extension("json.tmp");
        fs::write(&temp, serde_json::to_vec(self).map_err(io::Error::other)?)?;
        fs::rename(&temp, path)
    }

    /// The item ids the transcripts became.
    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.files
            .values()
            .map(|mark| mark.id.as_str())
            .filter(|id| !id.is_empty())
    }
}
