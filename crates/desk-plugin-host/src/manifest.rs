//! Reading a logic plugin folder: plugin.json and the component its `entry` names.

use std::fs;
use std::path::{Component, Path, PathBuf};

use desk_bridge::{PluginKind, PluginManifest};

use crate::logic::PluginError;

/// The manifest of the logic plugin in `dir` and the bytes of its entry. `desk plugin validate`
/// checks the full schema; this checks what running the plugin depends on.
pub(crate) fn read(dir: &Path) -> Result<(PluginManifest, Vec<u8>), PluginError> {
    let text = fs::read_to_string(dir.join("plugin.json"))
        .map_err(|e| PluginError::Manifest(format!("plugin.json cannot be read: {e}")))?;
    let manifest: PluginManifest = serde_json::from_str(&text)
        .map_err(|e| PluginError::Manifest(format!("plugin.json: {e}")))?;
    if manifest.kind != PluginKind::Logic {
        return Err(PluginError::Manifest(format!(
            "{} is not a logic plugin",
            manifest.id
        )));
    }
    let entry = inside(dir, &manifest.entry).ok_or_else(|| {
        PluginError::Manifest(format!("entry {} leaves the plugin folder", manifest.entry))
    })?;
    let bytes = fs::read(&entry).map_err(|e| {
        PluginError::Manifest(format!("entry {} cannot be read: {e}", manifest.entry))
    })?;
    Ok((manifest, bytes))
}

/// `entry` joined to `dir`, or `None` when it is absolute or climbs out with `..`.
fn inside(dir: &Path, entry: &str) -> Option<PathBuf> {
    let relative = Path::new(entry);
    let plain = relative
        .components()
        .all(|part| matches!(part, Component::Normal(_) | Component::CurDir));
    plain.then(|| dir.join(relative))
}
