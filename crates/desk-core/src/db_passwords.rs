//! Database passwords kept in the OS keychain for `db.open` (ADR 0311). Each one is an entry of the
//! desk's keychain service, account `db/<plugin>/<name>`, whose secret is the password with the
//! host, port and user it was kept for, so the binding is checked against what the keychain holds.
//! `db-passwords.json` in the data folder says what each plugin keeps, without the password, so a
//! list never reads the keychain; it is rewritten whole and readable by this user only:
//!
//! ```json
//! { "version": 1, "note": "...", "passwords": { "<plugin>": { "<name>": { "host": "db.example.test",
//!   "port": 5432, "user": "reader" } } } }
//! ```
//!
//! Nothing here hands a password out but `secret_for`, which `db.open` alone calls.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use desk_bridge::ErrorCode;
use desk_sys::Error;
use desk_sys::keychain::Keychain;
use serde::{Deserialize, Serialize};

use crate::secrets::write_private;

/// How many passwords one plugin keeps.
pub(crate) const MAX_KEPT: usize = 256;
const VERSION: u32 = 1;
const NOTE: &str =
    "which database passwords each plugin keeps in the OS keychain; no password is here";

/// What a password is kept for: the session's host, port and user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Bound {
    pub host: String,
    pub port: u16,
    pub user: String,
}

/// The keychain entry's secret.
#[derive(Serialize, Deserialize)]
struct Secret {
    host: String,
    port: u16,
    user: String,
    password: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    version: u32,
    #[serde(default)]
    note: String,
    #[serde(default)]
    passwords: BTreeMap<String, BTreeMap<String, Bound>>,
}

/// The kept passwords' index, and the keychain that holds them.
#[derive(Default)]
pub(crate) struct DbPasswords {
    keychain: Option<Arc<dyn Keychain>>,
    file: Option<PathBuf>,
    kept: BTreeMap<String, BTreeMap<String, Bound>>,
}

impl DbPasswords {
    /// The passwords `file` says are kept (none for a missing or unreadable one), in `keychain`.
    pub(crate) fn new(keychain: Option<Arc<dyn Keychain>>, file: Option<PathBuf>) -> Self {
        let kept = file
            .as_deref()
            .and_then(|path| fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Index>(&bytes).ok())
            .filter(|index| index.version == VERSION)
            .map(|index| index.passwords)
            .unwrap_or_default();
        Self {
            keychain,
            file,
            kept,
        }
    }

    /// Keep `password` for `bound` under the plugin's `name`, replacing what the name kept.
    pub(crate) fn set(
        &mut self,
        plugin: &str,
        name: &str,
        bound: Bound,
        password: String,
    ) -> Result<(), Error> {
        let keychain = self.keychain()?;
        let mine = self.kept.get(plugin);
        if mine.is_some_and(|m| m.len() >= MAX_KEPT && !m.contains_key(name)) {
            let why = format!("{plugin} already keeps {MAX_KEPT} database passwords");
            return Err(Error::new(ErrorCode::InvalidValue, why));
        }
        let secret = Secret {
            host: bound.host.clone(),
            port: bound.port,
            user: bound.user.clone(),
            password,
        };
        let text = serde_json::to_string(&secret)
            .map_err(|e| Error::new(ErrorCode::Internal, e.to_string()))?;
        keychain.set(&account(plugin, name), &text)?;
        let mine = self.kept.entry(plugin.to_owned()).or_default();
        mine.insert(name.to_owned(), bound);
        self.save();
        Ok(())
    }

    /// Forget the plugin's `name`: its keychain entry and its line. Nothing kept is fine.
    pub(crate) fn delete(&mut self, plugin: &str, name: &str) -> Result<(), Error> {
        if let Some(keychain) = &self.keychain {
            keychain.delete(&account(plugin, name))?;
        }
        self.drop_entry(plugin, name);
        Ok(())
    }

    /// What the plugin keeps, by name.
    pub(crate) fn list(&self, plugin: &str) -> Vec<(String, Bound)> {
        let mine = self.kept.get(plugin).into_iter().flatten();
        mine.map(|(name, bound)| (name.clone(), bound.clone()))
            .collect()
    }

    /// Forget everything the plugin kept: it was removed.
    pub(crate) fn forget_plugin(&mut self, plugin: &str) {
        let names: Vec<String> = self.list(plugin).into_iter().map(|(n, _)| n).collect();
        for name in names {
            if let Some(keychain) = &self.keychain {
                let _ = keychain.delete(&account(plugin, &name));
            }
        }
        if self.kept.remove(plugin).is_some() {
            self.save();
        }
    }

    /// The keychain and the account a lookup of the plugin's `name` for `bound` reads, when the
    /// index says it is kept for exactly that server and user.
    pub(crate) fn lookup(
        &self,
        plugin: &str,
        name: &str,
        bound: &Bound,
    ) -> Option<(Arc<dyn Keychain>, String)> {
        let kept = self.kept.get(plugin)?.get(name)?;
        (kept == bound).then_some(())?;
        Some((self.keychain.clone()?, account(plugin, name)))
    }

    /// The line for a name whose keychain entry is gone.
    pub(crate) fn drop_entry(&mut self, plugin: &str, name: &str) {
        let Some(mine) = self.kept.get_mut(plugin) else {
            return;
        };
        if mine.remove(name).is_none() {
            return;
        }
        if mine.is_empty() {
            self.kept.remove(plugin);
        }
        self.save();
    }

    fn keychain(&self) -> Result<Arc<dyn Keychain>, Error> {
        self.keychain.clone().ok_or_else(|| {
            let why = "this desk has no OS keychain to keep the password in";
            Error::new(ErrorCode::Unsupported, why)
        })
    }

    fn save(&self) {
        let Some(path) = &self.file else {
            return;
        };
        let index = Index {
            version: VERSION,
            note: NOTE.to_owned(),
            passwords: self.kept.clone(),
        };
        let written = serde_json::to_vec_pretty(&index)
            .map_err(std::io::Error::other)
            .and_then(|bytes| write_private(path, &bytes));
        if let Err(why) = written {
            eprintln!("desk: db-passwords.json was not written: {why}");
        }
    }
}

/// The password a keychain entry holds, when it was kept for `bound`.
pub(crate) fn secret_for(text: &str, bound: &Bound) -> Option<String> {
    let secret: Secret = serde_json::from_str(text).ok()?;
    let kept = Bound {
        host: secret.host,
        port: secret.port,
        user: secret.user,
    };
    (kept == *bound).then_some(secret.password)
}

/// The keychain account of a plugin's kept password.
fn account(plugin: &str, name: &str) -> String {
    format!("db/{plugin}/{name}")
}
