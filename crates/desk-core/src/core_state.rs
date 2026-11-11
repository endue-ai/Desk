//! The start side of `Core` (ADR 0061): which state files were unreadable at start and are kept
//! broken, safe mode, and the plugins held off for this run because the runtime quarantined them.
//! Safe mode runs only the desk's own policy plugins (kind `policy`, id `desk.*`); every other
//! plugin, libraries included, is held off without touching plugins.json. A quarantined plugin is
//! held off while its installed version is the one listed in `desk`'s store key
//! `plugins.quarantined`. `plugin.setEnabled` ends either hold.

use std::path::Path;
use std::sync::MutexGuard;

use desk_bridge::{PluginHold, PluginInfo, PluginKind};
use serde_json::Value;

use crate::handler::Core;
use crate::state_file::{BrokenFile, keep_broken, screen};

/// The store key, in the runtime's (`desk`'s) namespace, where quarantined plugins are listed.
pub const QUARANTINED_KEY: &str = "plugins.quarantined";

/// Why this start is in safe mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeReason {
    /// `--safe` or `DESK_SAFE=1`.
    Asked,
    /// The two starts before this one did not reach ready.
    CrashLoop,
}

/// Safe mode, as this start runs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SafeMode {
    pub reason: SafeReason,
    /// The plugins that would have been on and are held off, in install order.
    pub held_off: Vec<String>,
}

#[derive(Debug, Default)]
pub(crate) struct StartState {
    safe: Option<SafeReason>,
    held_off: Vec<String>,
    broken: Vec<BrokenFile>,
    index_problem: Option<String>,
}

impl Core {
    /// Start in safe mode. Call it before installing plugins: they are held as they install.
    pub fn with_safe_mode(self, reason: SafeReason) -> Self {
        self.start_state().safe = Some(reason);
        self
    }

    /// Safe mode, when this start runs in it.
    pub fn safe_mode(&self) -> Option<SafeMode> {
        let state = self.start_state();
        state.safe.map(|reason| SafeMode {
            reason,
            held_off: state.held_off.clone(),
        })
    }

    /// The state files found unreadable at this start, each once, in the order they were found.
    pub fn broken_files(&self) -> Vec<BrokenFile> {
        self.start_state().broken.clone()
    }

    /// Report a state file the app keeps itself (last-start.json) that was kept broken.
    pub fn report_broken(&self, file: BrokenFile) {
        let mut state = self.start_state();
        if !state.broken.contains(&file) {
            state.broken.push(file);
        }
    }

    /// Why the item index could not be opened, even fresh (`with_index_file`).
    pub fn index_problem(&self) -> Option<String> {
        self.start_state().index_problem.clone()
    }

    /// Keep broken every view file in `~/.desk/views` that is not YAML at all, at start. A file that
    /// parses but is not a valid view stays: it is a view problem the person can fix in place.
    pub fn keep_broken_views(&self) -> Vec<BrokenFile> {
        let mut kept = Vec::new();
        let Ok(entries) = std::fs::read_dir(self.views_folder()) else {
            return kept;
        };
        let mut paths: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
        paths.sort();
        for path in paths {
            let yaml = path
                .extension()
                .is_some_and(|extension| extension == "yaml");
            if yaml
                && path.is_file()
                && let Some(file) = screen(&path, parses_as_yaml)
            {
                self.report_broken(file.clone());
                kept.push(file);
            }
        }
        kept
    }

    /// Open the item index in `path`; one that cannot be opened is kept broken (with its WAL files)
    /// and a fresh one is opened in its place.
    pub fn with_index_file(self, path: std::path::PathBuf) -> Self {
        let opened = desk_index::Index::open(&path).or_else(|first| {
            let Some(file) = keep_broken(&path) else {
                return Err(first);
            };
            for side in ["-wal", "-shm"] {
                let mut name = path.clone().into_os_string();
                name.push(side);
                let _ = keep_broken(Path::new(&name));
            }
            self.report_broken(file);
            desk_index::Index::open(&path)
        });
        match opened {
            Ok(index) => self.with_index(std::sync::Arc::new(index)),
            Err(why) => {
                self.start_state().index_problem = Some(why.to_string());
                self
            }
        }
    }

    /// Keep the state file at `path` broken when `readable` refuses it, before its holder loads it.
    pub(crate) fn screen_state(&self, path: &Path, readable: fn(&[u8]) -> bool) {
        if let Some(file) = screen(path, readable) {
            self.report_broken(file);
        }
    }

    /// Hold a plugin that just installed off for this run: every plugin but the desk's own policies
    /// in safe mode, and a quarantined plugin while its version is the one that failed.
    pub(crate) fn hold_for_start(&self, info: PluginInfo) -> PluginInfo {
        let safe = self.start_state().safe.is_some();
        if safe && !desk_policy(&info) {
            let held = self
                .registry()
                .hold_for_safe_mode(&info.id)
                .unwrap_or(info.clone());
            let mut state = self.start_state();
            if info.enabled && !state.held_off.contains(&info.id) {
                state.held_off.push(info.id.clone());
            }
            return held;
        }
        if self.quarantined(&info) {
            let held = self.registry().hold_off(&info.id, PluginHold::Quarantine);
            return held.unwrap_or(info);
        }
        info
    }

    /// Whether the runtime listed this plugin, at its installed version, as quarantined.
    fn quarantined(&self, info: &PluginInfo) -> bool {
        let Some(version) = info.manifest.as_ref().map(|m| m.version.as_str()) else {
            return false;
        };
        let listed = self.stored("desk", QUARANTINED_KEY);
        let entries = listed.as_ref().and_then(Value::as_array);
        entries.into_iter().flatten().any(|entry| {
            entry["id"].as_str() == Some(info.id.as_str())
                && entry["version"].as_str() == Some(version)
        })
    }

    fn start_state(&self) -> MutexGuard<'_, StartState> {
        self.start
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The desk's own policy plugins: kind `policy` with an id starting `desk.`.
fn desk_policy(info: &PluginInfo) -> bool {
    info.id.starts_with("desk.")
        && info
            .manifest
            .as_ref()
            .is_some_and(|manifest| manifest.kind == PluginKind::Policy)
}

fn parses_as_yaml(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok_and(|text| yaml_serde::from_str::<Value>(text).is_ok())
}
