//! The plugin registry: installed plugin folders, their validation status, revisions and the
//! enabled flags, which are persisted in a small JSON store. init.yaml can hold plugins off at
//! start without touching the persisted flags. A plugin with no stored flag starts on, unless its
//! manifest says `autoload`: then it is off until the desk turns it on (ADR 0046). A library (files
//! other plugins import) is always on: no flag or hold turns it off. Folders the core writes itself
//! (user themes, ADR 0058) are written beside their place, checked, and only then put in it.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

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

/// Whether `bytes` are a plugin store file (plugins.json).
pub(crate) fn readable(bytes: &[u8]) -> bool {
    crate::state_file::json_as::<Store>(bytes)
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
        self.held_off.remove(id);
        if library(&self.entries[index]) {
            return Some(self.info(index));
        }
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

    /// Keep a plugin off for this run in safe mode, a library too (ADR 0061). set_enabled ends it.
    pub fn hold_for_safe_mode(&mut self, id: &str) -> Option<PluginInfo> {
        let index = self.entries.iter().position(|e| e.id == id)?;
        self.held_off.insert(id.to_owned());
        Some(self.info(index))
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
            enabled: !self.held_off.contains(&entry.id)
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

/// Why a folder did not land: its check found problems, or the disk refused.
pub enum Landing {
    Invalid(Vec<String>),
    Io(io::Error),
}

/// Write a plugin folder (plugin.json from `manifest`, then `files` by relative path) beside
/// `target`, check it with `validate_dir`, and only then put it in place of `target`, whose earlier
/// folder goes. Nothing is left behind when a step fails.
pub fn land_folder(target: &Path, manifest: &PluginManifest, files: &Files) -> Result<(), Landing> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let parent = target.parent().unwrap_or(target);
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let aside = |what: &str| parent.join(format!(".{what}-{name}-{}-{n}", std::process::id()));
    let (staging, old) = (aside("saving"), aside("replaced"));
    let written = write_folder(&staging, manifest, files).map_err(Landing::Io);
    let landed = written
        .and_then(|()| validate_dir(&staging).map(drop).map_err(Landing::Invalid))
        .and_then(|()| replace_folder(&staging, target, &old).map_err(Landing::Io));
    if landed.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    landed
}

type Files = BTreeMap<String, Vec<u8>>;

fn write_folder(dir: &Path, manifest: &PluginManifest, files: &Files) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let mut text = serde_json::to_string_pretty(manifest).map_err(io::Error::other)?;
    text.push('\n');
    fs::write(dir.join("plugin.json"), text)?;
    for (path, bytes) in files {
        let leaves = io::Error::new(io::ErrorKind::InvalidInput, "a file leaves the folder");
        let file = inside(dir, path).ok_or(leaves)?;
        fs::create_dir_all(file.parent().unwrap_or(dir))?;
        fs::write(file, bytes)?;
    }
    Ok(())
}

/// Put `staging` where `target` is, moving an earlier folder to `old` first and back on failure.
fn replace_folder(staging: &Path, target: &Path, old: &Path) -> io::Result<()> {
    let had = target.exists();
    if had {
        fs::rename(target, old)?;
    }
    if let Err(why) = fs::rename(staging, target) {
        if had {
            let _ = fs::rename(old, target);
        }
        return Err(why);
    }
    if had {
        let _ = fs::remove_dir_all(old);
    }
    Ok(())
}

/// What a folder holds as one number, which changes when a file in it is added, removed, resized or
/// rewritten: how a watcher tells someone's edit from the core's own write.
pub fn fingerprint(dir: &Path) -> u64 {
    let (mut folders, mut files) = (vec![dir.to_path_buf()], Vec::new());
    while let Some(folder) = folders.pop() {
        for entry in fs::read_dir(&folder).into_iter().flatten().flatten() {
            match entry.metadata() {
                Ok(meta) if meta.is_dir() => folders.push(entry.path()),
                Ok(meta) => files.push((entry.path(), meta.len(), meta.modified().ok())),
                Err(_) => {}
            }
        }
    }
    files.sort();
    let mut hasher = DefaultHasher::new();
    files.hash(&mut hasher);
    hasher.finish()
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
