//! The SSH host keys each plugin trusts for its db.open tunnels (ADR 0359): trust on first use, by
//! the person's yes in the plugin. `db-ssh-hosts.json` in the data folder holds them, rewritten
//! whole and readable by this user only; without a file they are kept for this run of the desk:
//!
//! ```json
//! { "version": 1, "note": "...", "hosts": { "<plugin>": { "bastion.example.test:22": {
//!   "algorithm": "ssh-ed25519", "fingerprint": "SHA256:..." } } } }
//! ```

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::secrets::write_private;

/// How many host keys one plugin trusts; past it, the oldest name in order goes.
pub(crate) const MAX_TRUSTED: usize = 1024;
const VERSION: u32 = 1;
const NOTE: &str = "the SSH host keys each plugin trusts for its database tunnels";

/// A trusted key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Trusted {
    pub algorithm: String,
    pub fingerprint: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    version: u32,
    #[serde(default)]
    note: String,
    #[serde(default)]
    hosts: BTreeMap<String, BTreeMap<String, Trusted>>,
}

#[derive(Default)]
pub(crate) struct DbSshHosts {
    file: Option<PathBuf>,
    hosts: BTreeMap<String, BTreeMap<String, Trusted>>,
}

fn at(host: &str, port: u16) -> String {
    format!("{}:{port}", host.to_ascii_lowercase())
}

impl DbSshHosts {
    /// The keys `file` says are trusted (none for a missing or unreadable one).
    pub(crate) fn new(file: Option<PathBuf>) -> Self {
        let hosts = file
            .as_deref()
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Index>(&bytes).ok())
            .filter(|index| index.version == VERSION)
            .map(|index| index.hosts)
            .unwrap_or_default();
        Self { file, hosts }
    }

    /// The fingerprint the plugin trusts for `host:port`.
    pub(crate) fn known(&self, plugin: &str, host: &str, port: u16) -> Option<String> {
        let trusted = self.hosts.get(plugin)?.get(&at(host, port))?;
        Some(trusted.fingerprint.clone())
    }

    /// Trust `key` for `host:port` from now on.
    pub(crate) fn trust(&mut self, plugin: &str, host: &str, port: u16, key: Trusted) {
        let mine = self.hosts.entry(plugin.to_owned()).or_default();
        if mine.get(&at(host, port)) == Some(&key) {
            return;
        }
        if mine.len() >= MAX_TRUSTED
            && let Some(first) = mine.keys().next().cloned()
        {
            mine.remove(&first);
        }
        mine.insert(at(host, port), key);
        self.save();
    }

    /// Forget the key trusted for `host:port`; nothing trusted is fine.
    pub(crate) fn forget(&mut self, plugin: &str, host: &str, port: u16) {
        let Some(mine) = self.hosts.get_mut(plugin) else {
            return;
        };
        if mine.remove(&at(host, port)).is_none() {
            return;
        }
        if mine.is_empty() {
            self.hosts.remove(plugin);
        }
        self.save();
    }

    /// The plugin was removed: every key it trusted goes.
    pub(crate) fn forget_plugin(&mut self, plugin: &str) {
        if self.hosts.remove(plugin).is_some() {
            self.save();
        }
    }

    fn save(&self) {
        let Some(path) = &self.file else {
            return;
        };
        let index = Index {
            version: VERSION,
            note: NOTE.to_owned(),
            hosts: self.hosts.clone(),
        };
        let written = serde_json::to_vec_pretty(&index)
            .map_err(std::io::Error::other)
            .and_then(|bytes| write_private(path, &bytes));
        if let Err(why) = written {
            eprintln!("desk: db-ssh-hosts.json was not written: {why}");
        }
    }
}
