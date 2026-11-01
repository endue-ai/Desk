//! desk-core storage for store.get and store.set: one JSON value per caller and key, in one file.
//! settings.set keeps its values the same way, in a file of its own (`core_settings`).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;

/// The largest value one key may hold, as serialised JSON.
pub const MAX_VALUE_BYTES: usize = 64 * 1024;

#[derive(Debug, Default)]
pub struct Store {
    path: Option<PathBuf>,
    data: BTreeMap<String, BTreeMap<String, Value>>,
}

impl Store {
    /// A store backed by `path` (loaded now, written on every set), or by memory only.
    pub fn new(path: Option<PathBuf>) -> Self {
        let data = path
            .as_deref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self { path, data }
    }

    pub fn get(&self, caller: &str, key: &str) -> Option<Value> {
        self.data.get(caller)?.get(key).cloned()
    }

    /// Every value as (caller, key, value), by caller and then key.
    pub fn all(&self) -> impl Iterator<Item = (&str, &str, &Value)> {
        self.data.iter().flat_map(|(caller, values)| {
            values
                .iter()
                .map(move |(key, value)| (caller.as_str(), key.as_str(), value))
        })
    }

    /// Set a value. Fails when it is larger than `MAX_VALUE_BYTES`.
    pub fn set(&mut self, caller: &str, key: &str, value: Value) -> Result<(), String> {
        self.set_bounded(caller, key, value, MAX_VALUE_BYTES)
    }

    /// Internal namespaces can have their own aggregate budget, independent of store.set.
    pub(crate) fn set_bounded(
        &mut self,
        caller: &str,
        key: &str,
        value: Value,
        limit: usize,
    ) -> Result<(), String> {
        let size = serde_json::to_vec(&value).map(|v| v.len()).unwrap_or(0);
        if size > limit {
            return Err(format!("value is {size} bytes; the limit is {limit}"));
        }
        self.data
            .entry(caller.to_owned())
            .or_default()
            .insert(key.to_owned(), value);
        self.save();
        Ok(())
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.data) {
            let _ = fs::write(path, text);
        }
    }
}
