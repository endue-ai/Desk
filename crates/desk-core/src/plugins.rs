//! The plugin registry: installed plugin folders, their validation status, revisions and the
//! enabled flags, which are persisted in a small JSON store. init.yaml can hold plugins off at
//! start without touching the persisted flags (plugin.list's `heldOff`). A plugin with no stored flag
//! starts on, unless its manifest says `autoload`: then it is off until the desk turns it on (ADR
//! 0046). A library (files other plugins import) is always on: no flag or hold turns it off. Folders
//! the core writes itself (user themes, ADR 0058) are written beside their place, checked, and only
//! then put in it (`plugin_landing`, re-exported here).

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use desk_bridge::{PluginHold, PluginInfo, PluginKind, PluginManifest, PluginStatus};
use serde::{Deserialize, Serialize};

use crate::manifest::{fallback_id, inside, validate_dir};
pub use crate::plugin_landing::{Landing, fingerprint, land_folder};

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

/// Whether `bytes` are a plugin store file (plugins.json).
pub(crate) fn readable(bytes: &[u8]) -> bool {
    crate::state_file::json_as::<Store>(bytes)
}

#[derive(Debug, Default)]
pub struct PluginRegistry {
    entries: Vec<Entry>,
    store_path: Option<PathBuf>,
    store: Store,
    /// Held off for this run (init.yaml, safe mode, a quarantine), until set_enabled says otherwise.
    held_off: BTreeMap<String, PluginHold>,
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
            held_off: BTreeMap::new(),
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
        self.held_off.remove(id);
        if library(&self.entries[index]) {
            return Some(self.info(index));
        }
        self.store.enabled.insert(id.to_owned(), enabled);
        self.save();
        Some(self.info(index))
    }

    /// Keep a plugin disabled for this run without changing its persisted flag, for `hold`'s reason.
    /// A later set_enabled overrides it. A library is never held off.
    pub fn hold_off(&mut self, id: &str, hold: PluginHold) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        if !library(&self.entries[index]) {
            self.held_off.entry(id.to_owned()).or_insert(hold);
        }
        Some(self.info(index))
    }

    /// Keep a plugin off for this run in safe mode, a library too (ADR 0061). set_enabled ends it.
    pub fn hold_for_safe_mode(&mut self, id: &str) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        self.held_off.insert(id.to_owned(), PluginHold::SafeMode);
        Some(self.info(index))
    }

    /// Mark an installed plugin failed with `why` (a pack that names a plugin nobody has).
    pub(crate) fn fail(&mut self, id: &str, why: String) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        self.entries[index].error = Some(why);
        Some(self.info(index))
    }

    /// On or off as the persisted flag says, this run's holds aside (plugins.lock, ADR 0079).
    pub(crate) fn kept_enabled(&self, id: &str) -> Option<bool> {
        let entry = self.entries.iter().find(|e| e.id == id)?;
        let flag = self.store.enabled.get(id).copied();
        Some(library(entry) || flag.unwrap_or(!autoload(entry)))
    }

    pub fn list(&self) -> Vec<PluginInfo> {
        (0..self.entries.len()).map(|i| self.info(i)).collect()
    }

    pub fn get(&self, id: &str) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        Some(self.info(index))
    }

    /// The installed plugins that are not built in and whose folder is directly in `parent`.
    pub fn in_folder(&self, parent: &Path) -> Vec<(String, PathBuf)> {
        let inside = |e: &&Entry| !e.built_in && e.dir.parent() == Some(parent);
        let entries = self.entries.iter().filter(inside);
        entries.map(|e| (e.id.clone(), e.dir.clone())).collect()
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
            enabled: !self.held_off.contains_key(&entry.id)
                && (library(entry)
                    || self
                        .store
                        .enabled
                        .get(&entry.id)
                        .copied()
                        .unwrap_or(!autoload(entry))),
            built_in: entry.built_in,
            revision: entry.revision,
            manifest: entry.manifest.clone(),
            error: entry.error.clone(),
            folder: Some(folder(&entry.dir)),
            held_off: self.held_off.get(&entry.id).copied(),
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

/// The folder as plugin.list names it: absolute, with forward slashes (a bridge `Path`).
fn folder(dir: &Path) -> String {
    let absolute = std::path::absolute(dir).unwrap_or_else(|_| dir.to_path_buf());
    absolute.to_string_lossy().replace('\\', "/")
}

/// Whether the plugin is always on: a library (files other plugins import), a theme or a design system
/// (values desk.theme.active and desk.design.active pick, not the enabled flag). None runs code, so none
/// is turned off.
fn library(entry: &Entry) -> bool {
    entry
        .manifest
        .as_ref()
        .is_some_and(|manifest| manifest.kind == PluginKind::Library || is_look(manifest.kind))
}

/// Whether a kind is one of the desk's looks (ADR 0091): a theme or a design system, both data the
/// theme pipeline saves, bundles and installs.
pub fn is_look(kind: PluginKind) -> bool {
    matches!(kind, PluginKind::Theme | PluginKind::DesignSystem)
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

/// The sub-folders of `parent` with a plugin.json, in name order, hidden ones (`.name`) left out.
pub fn plugin_dirs(parent: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = fs::read_dir(parent)
        .map(|read| read.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    dirs.retain(|dir| folder_in(parent, dir).is_some() && dir.join("plugin.json").is_file());
    dirs.sort();
    dirs
}

/// The folder of `parent` that `path` is in, unless it is hidden (`.name`).
pub fn folder_in(parent: &Path, path: &Path) -> Option<PathBuf> {
    let name = path
        .strip_prefix(parent)
        .ok()?
        .components()
        .next()?
        .as_os_str();
    (!name.to_string_lossy().starts_with('.')).then(|| parent.join(name))
}

/// The id and kind a folder's plugin.json declares, valid or not.
pub fn declared(dir: &Path) -> Option<(String, String)> {
    let text = fs::read_to_string(dir.join("plugin.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let field = |name: &str| value[name].as_str().map(str::to_owned);
    Some((field("id")?, field("kind")?))
}

/// The font and image files a theme plugin's block names, each once.
pub fn theme_files(manifest: &PluginManifest) -> BTreeSet<String> {
    let Some(theme) = &manifest.theme else {
        return BTreeSet::new();
    };
    let fonts = theme.r#type.iter().flat_map(|t| t.fonts.iter().flatten());
    let variants = [&theme.light, &theme.dark].into_iter().flatten();
    let images = variants.filter_map(|v| v.backdrop.as_ref()?.image.clone());
    fonts.map(|font| font.src.clone()).chain(images).collect()
}

/// An id inside `local.` from a name, else from `id`'s last part: `Paper & Ink` is `local.paper-ink`.
pub fn local_id(name: &str, id: &str) -> String {
    let clean = |text: &str| {
        let words = text.split(|c: char| !c.is_ascii_alphanumeric());
        let words: Vec<&str> = words.filter(|word| !word.is_empty()).collect();
        let slug: String = words
            .join("-")
            .to_ascii_lowercase()
            .chars()
            .take(64)
            .collect();
        slug.trim_end_matches('-').to_owned()
    };
    let slug = Some(clean(name)).filter(|slug| !slug.is_empty());
    let slug = slug.unwrap_or_else(|| clean(id.rsplit('.').next().unwrap_or_default()));
    match slug.chars().next() {
        None => "local.theme".to_owned(),
        Some(c) if c.is_ascii_digit() => format!("local.theme-{slug}"),
        Some(_) => format!("local.{slug}"),
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
