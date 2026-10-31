//! Reading a Wasm plugin folder (a logic plugin, or a connector with `binding: wasm`): plugin.json
//! and the component its `entry` names.

use std::fs;
use std::path::{Component, Path, PathBuf};

use desk_bridge::{ConnectorBinding, PluginKind, PluginManifest};

use crate::logic::PluginError;

/// The manifest of the plugin of `kind` in `dir` and the bytes of its entry. `desk plugin validate`
/// checks the full schema; this checks what running the plugin depends on. A connector must declare
/// its `connector` block with `binding: wasm`: an MCP connector runs in the VM, not here.
pub(crate) fn read(dir: &Path, kind: PluginKind) -> Result<(PluginManifest, Vec<u8>), PluginError> {
    let text = fs::read_to_string(dir.join("plugin.json"))
        .map_err(|e| PluginError::Manifest(format!("plugin.json cannot be read: {e}")))?;
    let manifest: PluginManifest = serde_json::from_str(&text)
        .map_err(|e| PluginError::Manifest(format!("plugin.json: {e}")))?;
    let id = &manifest.id;
    match kind {
        _ if manifest.kind != kind => {
            let kind = if kind == PluginKind::Logic {
                "logic plugin"
            } else {
                "connector"
            };
            return Err(PluginError::Manifest(format!("{id} is not a {kind}")));
        }
        PluginKind::Connector => match &manifest.connector {
            None => {
                let why = format!("{id} declares no connector block");
                return Err(PluginError::Manifest(why));
            }
            Some(connector) if connector.binding != ConnectorBinding::Wasm => {
                let why = format!("{id} is not a Wasm connector (binding: wasm)");
                return Err(PluginError::Manifest(why));
            }
            Some(_) => {}
        },
        _ => {}
    }
    // The schema requires `entry` for every kind but policy and view, so one without it is broken.
    let name = manifest
        .entry
        .as_deref()
        .ok_or_else(|| PluginError::Manifest(format!("{} names no entry", manifest.id)))?;
    let entry = inside(dir, name)
        .ok_or_else(|| PluginError::Manifest(format!("entry {name} leaves the plugin folder")))?;
    let bytes = fs::read(&entry)
        .map_err(|e| PluginError::Manifest(format!("entry {name} cannot be read: {e}")))?;
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
