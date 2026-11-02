//! User themes (ADR 0058, docs/ko/theme-requirements.md TC-01 to TC-03): theme plugins in a folder the
//! app hands the core (`<data>/themes`), one folder per theme, installed at start but not built in, and
//! watched. theme.save and theme.import write a folder beside the others, check it with `validate_dir`
//! and only then put it in place; theme.export makes a `.desk-theme` bundle of any installed theme;
//! theme.remove deletes a user theme. Every call needs theme:manage; built-in ids and plugins outside
//! the folder are never replaced.

use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, LogLevel, Permission, PluginInfo, PluginKind,
    PluginManifest, ThemeBundle, ThemeExportParams, ThemeImportParams, ThemeManagePermission,
    ThemeRemoveParams, ThemeSaveParams,
};
use desk_sys::fs::{WatchOptions, watch_debounced};
use desk_update::verify::sha256_hex;
use serde_json::json;

use crate::handler::{Answer, Core, error, io_error};
use crate::manifest::THEME_ASSET_MAX;
use crate::perm::Target;
use crate::plugins::{
    Landing, declared, fingerprint, folder_in, land_folder, local_id, plugin_dirs, theme_files,
};

/// The largest `.desk-theme` bundle, in bytes.
const BUNDLE_MAX: usize = 16 << 20;
const SOURCES: &str = "theme.import takes one of bundle, path and url, and sha256 with url";

/// Downloads a bundle by its https URL for theme.import: desk-sys `net` unless
/// `Core::with_theme_fetch` gives another (tests).
pub type ThemeFetch = dyn Fn(&str) -> Result<Vec<u8>, String> + Send + Sync;

/// The user themes folder, the download, and one change of the folder at a time.
#[derive(Default)]
pub(crate) struct Themes {
    dir: Option<PathBuf>,
    fetch: Option<Box<ThemeFetch>>,
    /// The one change at a time, and each user theme folder's fingerprint since the core last
    /// installed or refreshed it, so the watcher does not announce the core's own writes again.
    landing: Mutex<BTreeMap<PathBuf, u64>>,
}

/// Watches the user themes folder from when it started. Dropping it stops the watch.
pub struct ThemeWatcher {
    _watch: desk_sys::fs::Watch,
}

type Files = BTreeMap<String, Vec<u8>>;
type Failed<T> = Result<T, BridgeError>;

impl Core {
    /// Keep user themes in `dir` (created when missing) and install every theme folder in it, not
    /// built in: one whose plugin.json is a theme with an id inside `local.` or `market.`. Call it
    /// after `with_plugin_store`, which starts a fresh registry.
    pub fn with_themes_dir(mut self, dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            if entry.file_name().to_string_lossy().starts_with(".saving-") {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
        self.sync_themes(&dir, &BTreeSet::new());
        self.themes.dir = Some(dir);
        self
    }

    /// Download bundles for theme.import with `fetch` instead of the network.
    pub fn with_theme_fetch(mut self, fetch: Box<ThemeFetch>) -> Self {
        self.themes.fetch = Some(fetch);
        self
    }

    /// Watch the user themes folder until the watcher drops: a theme folder added, changed or deleted
    /// by hand is installed, refreshed or removed, with `plugin.changed`. `watch_plugins` leaves user
    /// themes to this watch.
    pub fn watch_themes(self: &Arc<Self>) -> io::Result<ThemeWatcher> {
        let none = || io::Error::new(io::ErrorKind::NotFound, "no user themes folder");
        let root = self.themes.dir.clone().ok_or_else(none)?;
        let (core, dir) = (Arc::downgrade(self), root.clone());
        let watch = watch_debounced(&dir, WatchOptions::default(), move |batch| {
            let Some(core) = core.upgrade() else { return };
            let folders = batch.iter().filter_map(|c| folder_in(&root, &c.path));
            core.sync_themes(&root, &folders.collect());
        })?;
        Ok(ThemeWatcher { _watch: watch })
    }

    pub(crate) fn theme_save(&self, caller: &str, params: ThemeSaveParams) -> Answer {
        self.check_theme(caller, params.scope)?;
        let manifest = params.manifest;
        let id = &manifest.id;
        if manifest.kind != PluginKind::Theme || !id.starts_with("local.") {
            return Err(invalid(format!("not a theme inside local.: {id}")));
        }
        let given = params.files.unwrap_or_default().into_iter();
        let mut files = decode(&manifest, given.map(|f| (f.path, f.base64)).collect())?;
        if let Some(from) = params.copy_from {
            self.installed_theme(&from)?;
            for path in theme_files(&manifest) {
                if !files.contains_key(&path)
                    && let Ok(bytes) = self.plugin_file(&from, &path)
                {
                    files.insert(path, bytes);
                }
            }
        }
        Ok(json!({ "plugin": self.land(manifest, files)? }))
    }

    pub(crate) fn theme_import(&self, caller: &str, params: ThemeImportParams) -> Answer {
        self.check_theme(caller, params.scope)?;
        let sha256 = params.sha256.as_deref();
        let bundle = match (params.bundle, params.path, params.url) {
            (Some(bundle), None, None) if sha256.is_none() => {
                let size = serde_json::to_vec(&bundle).map_or(0, |b| b.len());
                too_big("the bundle", size)?;
                bundle
            }
            (None, Some(path), None) if sha256.is_none() => {
                let file = self.resolve(&path)?;
                too_big(&path, fs::metadata(&file).map_err(io_error)?.len() as usize)?;
                parse(&fs::read(&file).map_err(io_error)?)?
            }
            (None, None, Some(url)) => parse(&self.download(&url, sha256)?)?,
            _ => return Err(invalid(SOURCES.into())),
        };
        let mut manifest = bundle.manifest;
        if manifest.kind != PluginKind::Theme {
            return Err(invalid(format!("{} is not a theme", manifest.id)));
        }
        if !user_id(&manifest.id) {
            let name = manifest.name.as_deref().unwrap_or_default();
            manifest.id = local_id(name, &manifest.id);
        }
        let files = decode(&manifest, bundle.files.into_iter().collect())?;
        Ok(json!({ "plugin": self.land(manifest, files)? }))
    }

    pub(crate) fn theme_export(&self, caller: &str, params: ThemeExportParams) -> Answer {
        self.check_theme(caller, params.scope)?;
        let (id, manifest) = (&params.theme, self.installed_theme(&params.theme)?);
        let mut files = BTreeMap::new();
        for path in theme_files(&manifest) {
            let bytes = self.plugin_file(id, &path).map_err(io_error)?;
            files.insert(path, STANDARD.encode(bytes));
        }
        let format = Default::default();
        let bundle = ThemeBundle {
            format,
            manifest,
            files,
        };
        let target = match (params.inline, params.path) {
            (Some(true), None) => return Ok(json!({ "bundle": bundle })),
            (Some(true), Some(_)) => return Err(invalid("inline takes no path".into())),
            (_, Some(path)) => self.resolve(&path)?,
            (_, None) => free_name(&self.home().join("Downloads"), id),
        };
        let mut text = serde_json::to_vec_pretty(&bundle).map_err(internal)?;
        text.push(b'\n');
        fs::create_dir_all(target.parent().unwrap_or(&target)).map_err(io_error)?;
        fs::write(&target, text).map_err(io_error)?;
        Ok(json!({ "path": target.to_string_lossy() }))
    }

    pub(crate) fn theme_remove(&self, caller: &str, params: ThemeRemoveParams) -> Answer {
        self.check_theme(caller, params.scope)?;
        self.themes_dir()?;
        let _landing = self.landing();
        let id = params.theme;
        let Some(folder) = self.user_theme_dir(&id) else {
            if self.plugins().iter().any(|plugin| plugin.id == id) {
                return Err(invalid(format!("{id} is not a user theme")));
            }
            return Err(error(ErrorCode::NotFound, format!("no plugin {id}")));
        };
        fs::remove_dir_all(&folder).map_err(io_error)?;
        self.forget_theme(&id);
        Ok(json!({}))
    }

    /// Write `manifest` and `files` as a folder beside the user themes, check it, and only then put
    /// it in place of the earlier user theme of its id (or as `<dir>/<id>`) and install it.
    fn land(&self, manifest: PluginManifest, files: Files) -> Failed<PluginInfo> {
        let dir = self.themes_dir()?;
        let mut landing = self.landing();
        let id = manifest.id.clone();
        let target = self.user_theme_dir(&id).unwrap_or_else(|| dir.join(&id));
        let folders = self.plugin_folders();
        let held = |(other, folder): &(String, PathBuf)| (*other == id) != (*folder == target);
        if folders.iter().any(held) {
            let why = format!("{id} is held by a plugin that is not a user theme");
            return Err(error(ErrorCode::AlreadyExists, why));
        }
        land_folder(&target, &manifest, &files).map_err(|landing| match landing {
            Landing::Invalid(problems) => invalid(problems.join("; ")),
            Landing::Io(why) => io_error(why),
        })?;
        landing.insert(target.clone(), fingerprint(&target));
        if !folders.iter().any(|(other, _)| *other == id) {
            return Ok(self.install_plugin(&target, false));
        }
        self.plugin_files_changed(&id);
        let info = self.plugins().into_iter().find(|plugin| plugin.id == id);
        info.ok_or_else(|| internal(format!("{id} left the registry")))
    }

    /// Bring the registry in line with the folder `dir`: user themes whose folder went are removed,
    /// the `touched` ones refreshed, and new theme folders installed.
    fn sync_themes(&self, dir: &Path, touched: &BTreeSet<PathBuf>) {
        let mut landing = self.landing();
        for (id, folder) in self.user_themes(dir) {
            let now = fingerprint(&folder);
            if !folder.join("plugin.json").is_file() {
                self.forget_theme(&id);
            } else if touched.contains(&folder) && landing.insert(folder, now) != Some(now) {
                self.plugin_files_changed(&id);
            }
        }
        let known = self.plugin_folders();
        for folder in plugin_dirs(dir) {
            if known.iter().any(|(_, installed)| *installed == folder) {
                continue;
            }
            let why = match declared(&folder) {
                Some((id, _)) if known.iter().any(|(other, _)| *other == id) => "its id is taken",
                Some((id, kind)) if kind == "theme" && user_id(&id) => {
                    landing.insert(folder.clone(), fingerprint(&folder));
                    self.install_plugin(&folder, false);
                    continue;
                }
                _ => "not a theme with an id inside local. or market.",
            };
            let message = format!("{} is not a user theme: {why}", folder.display());
            self.log(LogLevel::Warn, message, None);
        }
    }

    /// Installed user themes: plugins not built in whose folder is in the user themes folder `dir`.
    fn user_themes(&self, dir: &Path) -> Vec<(String, PathBuf)> {
        let registry = self.plugins.lock().unwrap_or_else(PoisonError::into_inner);
        registry.in_folder(dir)
    }

    fn user_theme_dir(&self, id: &str) -> Option<PathBuf> {
        let mut themes = self.user_themes(self.themes.dir.as_deref()?).into_iter();
        Some(themes.find(|(other, _)| other == id)?.1)
    }

    /// Take a user theme out of the registry, with `plugin.changed` `removed` for the plugin:manage
    /// holders and the callers subscribed to it.
    fn forget_theme(&self, id: &str) {
        let info = self.plugins().into_iter().find(|plugin| plugin.id == id);
        let revision = info.map_or(0, |plugin| plugin.revision);
        let mut registry = self.plugins.lock().unwrap_or_else(PoisonError::into_inner);
        registry.remove(id);
        drop(registry);
        let manage = serde_json::from_value(json!({ "permission": "plugin:manage" }));
        let managers = self.holders(&manage.expect("plugin:manage is a permission"));
        let to = self.recipients(desk_bridge::EventName::PluginChanged, managers);
        let data = json!({ "plugin": id, "change": "removed", "revision": revision });
        let event = json!({ "event": "plugin.changed", "data": data });
        let event: BridgeEvent = serde_json::from_value(event).expect("plugin.changed is an event");
        self.events().publish_to(to, event);
    }

    fn installed_theme(&self, id: &str) -> Failed<PluginManifest> {
        let info = self.plugins().into_iter().find(|plugin| plugin.id == id);
        let theme = info
            .and_then(|info| info.manifest)
            .filter(|m| m.kind == PluginKind::Theme);
        theme.ok_or_else(|| error(ErrorCode::NotFound, format!("no installed theme {id}")))
    }

    /// A bundle by its https URL, refused unless its bytes have `sha256`.
    fn download(&self, url: &str, sha256: Option<&str>) -> Failed<Vec<u8>> {
        let Some(sha256) = sha256.filter(|_| https_host(url).is_some()) else {
            return Err(invalid(format!("{url} needs https and a sha256")));
        };
        let fetched = match &self.themes.fetch {
            Some(fetch) => fetch(url),
            None => https_fetch(url),
        };
        let bytes = fetched.map_err(|why| error(ErrorCode::IoError, why))?;
        too_big(url, bytes.len())?;
        let actual = sha256_hex(&bytes);
        if !actual.eq_ignore_ascii_case(sha256) {
            return Err(invalid(format!("{url}: sha256 {actual}, not {sha256}")));
        }
        Ok(bytes)
    }

    fn check_theme(&self, caller: &str, scope: ThemeManagePermission) -> Failed<()> {
        self.check(caller, &Permission::ThemeManage(scope), &Target::None)
    }

    /// The user themes folder, or `unsupported` when this desk keeps none.
    pub(crate) fn themes_dir(&self) -> Failed<PathBuf> {
        let none = "this desk keeps no user themes";
        let dir = self.themes.dir.clone();
        dir.ok_or_else(|| error(ErrorCode::Unsupported, none.into()))
    }

    fn landing(&self) -> MutexGuard<'_, BTreeMap<PathBuf, u64>> {
        let lock = self.themes.landing.lock();
        lock.unwrap_or_else(PoisonError::into_inner)
    }
}

/// Files by path from base64: each one the theme names, once, and no larger than an asset may be.
fn decode(manifest: &PluginManifest, given: Vec<(String, String)>) -> Failed<Files> {
    let named = theme_files(manifest);
    let mut files = Files::new();
    for (path, base64) in given {
        let bytes = STANDARD.decode(&base64).ok();
        let bytes = bytes.filter(|b| b.len() as u64 <= THEME_ASSET_MAX);
        let why = match (named.contains(&path), bytes) {
            (false, _) => "is not a file the theme names",
            (true, None) => "is not base64 of at most 2 MiB",
            (true, Some(bytes)) => match files.entry(path.clone()) {
                Entry::Vacant(slot) => {
                    slot.insert(bytes);
                    continue;
                }
                Entry::Occupied(_) => "is given twice",
            },
        };
        return Err(invalid(format!("files: {path} {why}")));
    }
    Ok(files)
}

fn parse(bytes: &[u8]) -> Failed<ThemeBundle> {
    serde_json::from_slice(bytes).map_err(|e| invalid(format!("not a .desk-theme: {e}")))
}

fn too_big(what: &str, size: usize) -> Failed<()> {
    let why = format!("{what} is {size} bytes, over {BUNDLE_MAX}");
    (size <= BUNDLE_MAX)
        .then_some(())
        .ok_or_else(|| invalid(why))
}

/// Whether an id is a user theme's: inside `local.` (the person's) or `market.` (from a market).
fn user_id(id: &str) -> bool {
    id.starts_with("local.") || id.starts_with("market.")
}

/// `<dir>/<id>.desk-theme`, or `<id>-2.desk-theme` and on when that is taken.
fn free_name(dir: &Path, id: &str) -> PathBuf {
    let name = |n: u32| match n {
        1 => dir.join(format!("{id}.desk-theme")),
        n => dir.join(format!("{id}-{n}.desk-theme")),
    };
    let mut names = (1..).map(name);
    names.find(|path| !path.exists()).expect("a free name")
}

/// `host:port` of an https URL (443 when it names none): the only host its download may reach.
fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    let usable = !host.is_empty() && !host.contains(['@', '[', ' ']);
    let port = if host.contains(':') { "" } else { ":443" };
    usable.then(|| format!("{host}{port}"))
}

/// The desk's download: desk-sys `net`, to the URL's host only, for a 2xx answer, within a minute.
fn https_fetch(url: &str) -> Result<Vec<u8>, String> {
    let request = desk_sys::net::Request {
        url: url.to_owned(),
        allowed_hosts: https_host(url).into_iter().collect(),
        timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    };
    let response = desk_sys::net::fetch(&request).map_err(|e| e.message)?;
    match response.status {
        200..=299 => Ok(response.body),
        status => Err(format!("{url} answered {status}")),
    }
}

fn invalid(why: String) -> BridgeError {
    error(ErrorCode::InvalidParams, why)
}

fn internal(why: impl ToString) -> BridgeError {
    error(ErrorCode::Internal, why.to_string())
}
