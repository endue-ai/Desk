//! Plugin folders the core writes itself (user themes, ADR 0058; what a market installs, ADR
//! 0107): written beside their place, checked, and only then put in it; and the fingerprint by
//! which a watcher tells someone's edit from the core's own write. `plugins` re-exports them.

use std::collections::BTreeMap;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use desk_bridge::PluginManifest;

use crate::manifest::{inside, validate_dir};

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
