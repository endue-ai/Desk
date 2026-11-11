//! plugins.lock without the core (specs/init/v0/lock.schema.json, ADR 0079): the folder digest a
//! line pins, the YAML the core writes (one flow mapping per plugin, sorted by id, so each plugin is
//! one line in a diff), reading it back, and the plan `desk plugin sync` follows.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use desk_bridge::{LockedPlugin, PluginInfo, PluginStatus, PluginsLock};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// The format version this desk writes and reads.
pub const LOCK_VERSION: u64 = 0;

const HEADER: &str = "# plugins.lock: the plugins of this desk, one line each, written by Desk on every install,\n# removal, version change and turn on or off. `desk plugin sync` turns plugins on and off as it\n# says (specs/init/v0/lock.schema.json).\n";

/// The folder digest: every regular file under `dir` whose path has no part starting with `.`, in
/// byte order of its path relative to `dir` (forward slashes), each fed as path, NUL, decimal length,
/// NUL, bytes; lowercase hex.
pub fn folder_sha256(dir: &Path) -> io::Result<String> {
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    collect(dir, "", &mut files)?;
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut hasher = Sha256::new();
    for (path, file) in files {
        let bytes = fs::read(&file)?;
        hasher.update(path.as_bytes());
        hasher.update([0]);
        hasher.update(bytes.len().to_string().as_bytes());
        hasher.update([0]);
        hasher.update(&bytes);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn collect(dir: &Path, prefix: &str, files: &mut Vec<(String, PathBuf)>) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = format!("{prefix}{name}");
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect(&entry.path(), &format!("{path}/"), files)?;
        } else if kind.is_file() {
            files.push((path, entry.path()));
        }
    }
    Ok(())
}

/// The lock's text: the header, `version: 0` and one line per plugin, sorted by id.
pub fn render(lock: &PluginsLock) -> String {
    let mut plugins: Vec<&LockedPlugin> = lock.plugins.iter().collect();
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    let mut text = format!("{HEADER}version: {}\n", lock.version);
    if plugins.is_empty() {
        text.push_str("plugins: []\n");
        return text;
    }
    text.push_str("plugins:\n");
    for p in plugins {
        text.push_str(&format!(
            "  - {{ id: {}, version: {}, source: {}, sha256: {}, enabled: {} }}\n",
            scalar(&p.id),
            scalar(&p.version),
            scalar(&p.source),
            p.sha256,
            p.enabled
        ));
    }
    text
}

/// A plain YAML scalar when the text is safe as one in a flow mapping, else a JSON string (which
/// YAML reads as a double-quoted one).
fn scalar(text: &str) -> String {
    let plain = !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-+".contains(c))
        && text.starts_with(|c: char| c.is_ascii_alphanumeric());
    if plain {
        text.to_owned()
    } else {
        Value::String(text.to_owned()).to_string()
    }
}

/// The lock in `text`, or why it cannot be read: not YAML, a version newer than this desk reads, or
/// not the schema's shape.
pub fn parse(text: &str) -> Result<PluginsLock, String> {
    let value: Value = yaml_serde::from_str::<Option<Value>>(text)
        .map_err(|e| format!("plugins.lock is not YAML: {e}"))?
        .unwrap_or(Value::Null);
    if let Some(version) = value.get("version").and_then(Value::as_u64)
        && version > LOCK_VERSION
    {
        return Err(format!(
            "plugins.lock is version {version}, newer than this Desk reads ({LOCK_VERSION})"
        ));
    }
    serde_json::from_value(value).map_err(|e| format!("plugins.lock does not read as v0: {e}"))
}

/// What `desk plugin sync` does with a lock against the installed plugins.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Plan {
    /// Installed and off, on in the lock.
    pub enable: Vec<String>,
    /// Installed and on, off in the lock.
    pub disable: Vec<String>,
    /// In the lock and not installed (installing them is the market's, later).
    pub missing: Vec<String>,
    /// (id, the lock's version, the installed one) where they differ: noted, never changed.
    pub versions: Vec<(String, String, String)>,
}

/// The plan for `lock` against `plugins`: plugins the lock does not name are left alone, and so is
/// one held off for this run (init.yaml, safe mode, a quarantine): the lock keeps its remembered
/// choice, holds aside, so a plugin it says is on is not turned on against the hold.
pub fn plan(lock: &PluginsLock, plugins: &[PluginInfo]) -> Plan {
    let mut plan = Plan::default();
    let mut locked: Vec<&LockedPlugin> = lock.plugins.iter().collect();
    locked.sort_by(|a, b| a.id.cmp(&b.id));
    for line in locked {
        let Some(installed) = plugins.iter().find(|p| p.id == line.id) else {
            plan.missing.push(line.id.clone());
            continue;
        };
        let held = installed.held_off.is_some() && !installed.enabled;
        if installed.enabled != line.enabled && !held {
            let list = if line.enabled {
                &mut plan.enable
            } else {
                &mut plan.disable
            };
            list.push(line.id.clone());
        }
        let version = installed.manifest.as_ref().map(|m| m.version.clone());
        if let Some(version) = version.filter(|v| *v != line.version)
            && installed.status == PluginStatus::Ready
        {
            plan.versions
                .push((line.id.clone(), line.version.clone(), version));
        }
    }
    plan
}

/// `folder:<path>` for a plugin folder, with `~` for `home` when it is under it.
pub fn folder_source(dir: &Path, home: &Path) -> String {
    let absolute = std::path::absolute(dir).unwrap_or_else(|_| dir.to_path_buf());
    let path = match absolute.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.to_string_lossy()),
        Err(_) => absolute.to_string_lossy().into_owned(),
    };
    format!("folder:{}", path.replace('\\', "/"))
}
