//! The plugin registry: installed plugin folders, their validation status, revisions and the
//! enabled flags, which are persisted in a small JSON store. init.yaml can hold plugins off at
//! start without touching the persisted flags. A plugin with no stored flag starts on, unless its
//! manifest says `autoload`: then it is off until the desk turns it on (ADR 0046). A library (files
//! other plugins import) is always on: no flag or hold turns it off.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use desk_bridge::{PluginInfo, PluginKind, PluginManifest, PluginStatus};
use serde::{Deserialize, Serialize};

use crate::manifest::{fallback_id, inside, validate_dir};

#[derive(Debug, Clone)]
struct Entry {
    id: String,
    dir: PathBuf,
    built_in: bool,
    revision: u64,
    manifest: Option<PluginManifest>,
    error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    enabled: BTreeMap<String, bool>,
}

#[derive(Debug, Default)]
pub struct PluginRegistry {
    entries: Vec<Entry>,
    store_path: Option<PathBuf>,
    store: Store,
    /// Held off for this run by init.yaml, until set_enabled says otherwise.
    held_off: BTreeSet<String>,
}

impl PluginRegistry {
    /// A registry that remembers enabled flags in `store` (a JSON file), or nowhere.
    pub fn new(store: Option<PathBuf>) -> Self {
        let loaded = store
            .as_deref()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self {
            entries: Vec::new(),
            store_path: store,
            store: loaded,
            held_off: BTreeSet::new(),
        }
    }

    /// Install (or reinstall) the plugin in `dir`. Invalid plugins are recorded as failed.
    pub fn install(&mut self, dir: &Path, built_in: bool) -> PluginInfo {
        let (id, manifest, error) = load(dir);
        let revision = match self.entries.iter().position(|e| e.id == id) {
            Some(index) => self.entries.remove(index).revision + 1,
            None => 1,
        };
        self.entries.push(Entry {
            id,
            dir: dir.to_path_buf(),
            built_in,
            revision,
            manifest,
            error,
        });
        self.info(self.entries.len() - 1)
    }

    /// Install every sub-folder of `parent` that has a plugin.json, in name order.
    pub fn install_children(&mut self, parent: &Path, built_in: bool) -> Vec<PluginInfo> {
        let mut dirs: Vec<PathBuf> = fs::read_dir(parent)
            .map(|read| read.flatten().map(|entry| entry.path()).collect())
            .unwrap_or_default();
        dirs.retain(|dir| dir.join("plugin.json").is_file());
        dirs.sort();
        dirs.iter().map(|dir| self.install(dir, built_in)).collect()
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        self.entries.len() != before
    }

    /// Re-read a plugin after its files changed: validation runs again and the revision goes up.
    pub fn refresh(&mut self, id: &str) -> Option<PluginInfo> {
        let entry = self.entries.iter().find(|e| e.id == id)?.clone();
        let (_, manifest, error) = load(&entry.dir);
        let index = self.entries.iter().position(|e| e.id == id)?;
        let slot = &mut self.entries[index];
        slot.revision += 1;
        slot.manifest = manifest;
        slot.error = error;
        Some(self.info(index))
    }

    /// Turn a plugin on or off and remember it. A library stays on and nothing is remembered.
    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        if library(&self.entries[index]) {
            return Some(self.info(index));
        }
        self.held_off.remove(id);
        self.store.enabled.insert(id.to_owned(), enabled);
        self.save();
        Some(self.info(index))
    }

    /// Keep a plugin disabled for this run without changing its persisted flag (init.yaml's
    /// `plugins.disabled`). A later set_enabled overrides it. A library is never held off.
    pub fn hold_off(&mut self, id: &str) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        if !library(&self.entries[index]) {
            self.held_off.insert(id.to_owned());
        }
        Some(self.info(index))
    }

    pub fn list(&self) -> Vec<PluginInfo> {
        (0..self.entries.len()).map(|i| self.info(i)).collect()
    }

    pub fn get(&self, id: &str) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        Some(self.info(index))
    }

    /// Every installed plugin folder, for watching.
    pub fn folders(&self) -> Vec<(String, PathBuf)> {
        self.entries
            .iter()
            .map(|e| (e.id.clone(), e.dir.clone()))
            .collect()
    }

    /// A file of an installed plugin, by relative path. Paths that leave the folder are refused.
    pub fn file(&self, id: &str, path: &str) -> io::Result<Vec<u8>> {
        let entry =
            self.entries.iter().find(|e| e.id == id).ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, format!("no plugin {id}"))
            })?;
        let file = inside(&entry.dir, path).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                "path leaves the plugin folder",
            )
        })?;
        desk_sys::fs::read(&file)
    }

    fn info(&self, index: usize) -> PluginInfo {
        let entry = &self.entries[index];
        PluginInfo {
            id: entry.id.clone(),
            status: if entry.error.is_none() {
                PluginStatus::Ready
            } else {
                PluginStatus::Failed
            },
            enabled: library(entry)
                || (!self.held_off.contains(&entry.id)
                    && self
                        .store
                        .enabled
                        .get(&entry.id)
                        .copied()
                        .unwrap_or(!autoload(entry))),
            built_in: entry.built_in,
            revision: entry.revision,
            manifest: entry.manifest.clone(),
            error: entry.error.clone(),
        }
    }

    fn save(&self) {
        if let Some(path) = &self.store_path {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(text) = serde_json::to_string_pretty(&self.store) {
                let _ = fs::write(path, text);
            }
        }
    }
}

/// Whether the plugin is always on: a library (files other plugins import) or a theme (values the
/// desk.theme.active setting picks, not the enabled flag). Neither runs code, so neither is turned off.
fn library(entry: &Entry) -> bool {
    entry
        .manifest
        .as_ref()
        .is_some_and(|manifest| matches!(manifest.kind, PluginKind::Library | PluginKind::Theme))
}

/// Whether a plugin's manifest asks to stay off until the desk needs it.
fn autoload(entry: &Entry) -> bool {
    entry
        .manifest
        .as_ref()
        .and_then(|manifest| manifest.autoload)
        .unwrap_or(false)
}

/// Validate a folder: (id, manifest when valid, error when not).
fn load(dir: &Path) -> (String, Option<PluginManifest>, Option<String>) {
    match validate_dir(dir) {
        Ok(manifest) => (manifest.id.clone(), Some(manifest), None),
        Err(problems) => (declared_id(dir), None, Some(problems.join("; "))),
    }
}

/// The id a broken manifest declares, when it has a usable one; otherwise one from the folder name.
fn declared_id(dir: &Path) -> String {
    fs::read_to_string(dir.join("plugin.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value["id"].as_str().map(str::to_owned))
        .filter(|id| {
            id.contains('.')
                && id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
        })
        .unwrap_or_else(|| fallback_id(dir))
}
