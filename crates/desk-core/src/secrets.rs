//! Connector secrets until Desk uses the OS keychain (ADR 0036): one JSON file in the data folder,
//! readable by this user only (mode 0600 on Unix; the profile folder's ACL on Windows), rewritten
//! whole through a temp file and a rename. Secrets are never listed and never handed to a guest;
//! disconnecting an instance removes its own. Nothing reads them yet.
//!
//! ```json
//! { "version": 1, "note": "...", "secrets": { "<connector>/<instance>": { "<setting>": "<value>" } } }
//! ```

use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const VERSION: u32 = 1;
const NOTE: &str =
    "connector secrets in plain text until Desk uses the OS keychain; readable by this user only";

#[derive(Debug, Default, Serialize, Deserialize)]
struct SecretsFile {
    version: u32,
    note: String,
    secrets: BTreeMap<String, Map<String, Value>>,
}

/// The secrets of every instance, by `<connector>/<instance>`, kept in a file or in memory.
#[derive(Debug, Default)]
pub(crate) struct Secrets {
    path: Option<PathBuf>,
    secrets: BTreeMap<String, Map<String, Value>>,
}

impl Secrets {
    /// The secrets in `path` (a missing or unreadable file holds none), or in memory only.
    pub(crate) fn new(path: Option<PathBuf>) -> Self {
        let secrets = path
            .as_deref()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<SecretsFile>(&text).ok())
            .filter(|file| file.version == VERSION)
            .map(|file| file.secrets)
            .unwrap_or_default();
        Self { path, secrets }
    }

    /// Keep `values` for the instance, replacing what it had. Nothing is written for no values.
    pub(crate) fn set(
        &mut self,
        connector: &str,
        instance: &str,
        values: Map<String, Value>,
    ) -> io::Result<()> {
        if values.is_empty() {
            return Ok(());
        }
        self.secrets.insert(key(connector, instance), values);
        self.save()
    }

    /// Forget the instance's secrets.
    pub(crate) fn remove(&mut self, connector: &str, instance: &str) -> io::Result<()> {
        if self.secrets.remove(&key(connector, instance)).is_none() {
            return Ok(());
        }
        self.save()
    }

    fn save(&self) -> io::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let file = SecretsFile {
            version: VERSION,
            note: NOTE.to_owned(),
            secrets: self.secrets.clone(),
        };
        let text = serde_json::to_vec_pretty(&file).map_err(io::Error::other)?;
        write_private(path, &text)
    }
}

fn key(connector: &str, instance: &str) -> String {
    format!("{connector}/{instance}")
}

/// Write `bytes` to a temp file only this user can read, then rename it over `path`.
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = parent.join(format!(".{name}.{}.tmp", std::process::id()));
    // A temp file left by a crash may be readable by others: start from a new one.
    let _ = fs::remove_file(&temp);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = options.open(&temp).and_then(|mut file| {
        file.write_all(bytes)?;
        file.sync_all()
    });
    let renamed = written.and_then(|()| fs::rename(&temp, path));
    if renamed.is_err() {
        let _ = fs::remove_file(&temp);
    }
    renamed
}
