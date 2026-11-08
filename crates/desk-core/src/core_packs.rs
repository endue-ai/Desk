//! Packs on the core's side (ADR 0108): a pack's nested plugins (`plugins/<folder>/` in its folder)
//! install with it, built in when it is, and go when it is removed; a plugin it names that is neither
//! nested nor on the desk fails it. From a market, a pack's nested code is held to the endue index and
//! its nested plugins get the permissions the person accepted that each asks.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use desk_bridge::{
    BridgeError, ConnectorBinding, ErrorCode, Permission, PluginInfo, PluginKind, PluginManifest,
    PluginStatus,
};

use crate::handler::{Core, error};
use crate::marketplace::missing;

impl Core {
    /// After `info` installed: when it is a ready pack, install what it brings and check what it
    /// names. Returns the pack as it stands then (failed when it names a plugin nobody has).
    pub(crate) fn install_pack(&self, info: PluginInfo, dir: &Path, built_in: bool) -> PluginInfo {
        let pack = info
            .manifest
            .as_ref()
            .filter(|m| m.kind == PluginKind::Pack);
        let Some(block) = pack.and_then(|m| m.pack.clone()) else {
            return info;
        };
        if info.status != PluginStatus::Ready {
            return info;
        }
        for nested in nested_dirs(dir) {
            self.install_plugin(&nested, built_in);
        }
        let installed = self.plugins();
        let absent: Vec<&String> = block
            .plugins
            .iter()
            .filter(|id| {
                !installed
                    .iter()
                    .any(|p| &&p.id == id && p.status == PluginStatus::Ready)
            })
            .collect();
        if absent.is_empty() {
            return info;
        }
        let names: Vec<&str> = absent.iter().map(|id| id.as_str()).collect();
        let why = format!(
            "{} brings {}, which is neither in its folder nor on this desk",
            info.id,
            names.join(", ")
        );
        self.registry().fail(&info.id, why).unwrap_or(info)
    }

    /// Before a pack goes: the plugins nested in its folder go first.
    pub(crate) fn remove_pack_plugins(&self, info: &PluginInfo) {
        if info
            .manifest
            .as_ref()
            .is_none_or(|m| m.kind != PluginKind::Pack)
        {
            return;
        }
        let Some(folder) = &info.folder else {
            return;
        };
        let nested = PathBuf::from(folder).join("plugins");
        let inside: Vec<String> = self
            .plugins()
            .into_iter()
            .filter(|p| {
                p.folder
                    .as_ref()
                    .is_some_and(|f| Path::new(f).starts_with(&nested))
            })
            .map(|p| p.id)
            .collect();
        for id in inside {
            self.remove_plugin(&id);
        }
    }

    /// Grant each plugin a market pack brought the permissions it declares that the person accepted.
    pub(crate) fn grant_pack(&self, pack: &str, accepted: &[Permission]) {
        let Some(folder) = self
            .plugins()
            .into_iter()
            .find(|p| p.id == pack)
            .and_then(|p| p.folder)
        else {
            return;
        };
        let nested = PathBuf::from(folder).join("plugins");
        for plugin in self.plugins() {
            let inside = plugin
                .folder
                .as_ref()
                .is_some_and(|f| Path::new(f).starts_with(&nested));
            let asked = plugin
                .manifest
                .and_then(|m| m.permissions)
                .unwrap_or_default();
            if !inside {
                continue;
            }
            for permission in asked {
                if missing(std::slice::from_ref(&permission), accepted).is_empty() {
                    self.grant(&plugin.id, permission);
                }
            }
        }
    }
}

/// A market pack's nested plugin manifests, by the files of its bundle.
pub(crate) fn nested_manifests(files: &BTreeMap<String, Vec<u8>>) -> Vec<PluginManifest> {
    files
        .iter()
        .filter(|(path, _)| {
            let parts: Vec<&str> = path.split('/').collect();
            parts.len() == 3 && parts[0] == "plugins" && parts[2] == "plugin.json"
        })
        .filter_map(|(_, bytes)| serde_json::from_slice(bytes).ok())
        .collect()
}

/// Refused unless every nested plugin runs no code, when the pack is not from the endue index.
pub(crate) fn check_nested_code(
    pack: &str,
    market: &str,
    verified: bool,
    nested: &[PluginManifest],
) -> Result<(), BridgeError> {
    if verified {
        return Ok(());
    }
    let code = nested.iter().find(|m| runs_code(m));
    match code {
        None => Ok(()),
        Some(m) => Err(error(
            ErrorCode::PermissionDenied,
            format!(
                "{pack} brings {}, which runs code, from {market}, which is not verified: code installs only from the endue index",
                m.id
            ),
        )),
    }
}

/// Whether a plugin runs code of its own: ui, logic and tool plugins, and connectors that are not
/// http blocks.
fn runs_code(manifest: &PluginManifest) -> bool {
    match manifest.kind {
        PluginKind::Ui | PluginKind::Logic | PluginKind::Tool => true,
        PluginKind::Connector => manifest
            .connector
            .as_ref()
            .is_none_or(|c| c.binding != ConnectorBinding::Http),
        _ => false,
    }
}

/// The plugin folders nested in a pack folder: `plugins/<folder>/plugin.json`.
fn nested_dirs(dir: &Path) -> Vec<PathBuf> {
    crate::plugins::plugin_dirs(&dir.join("plugins"))
}
