//! One plugin's imports: each checks that the manifest declares the permission it needs, then
//! calls the `Host` as that plugin.

use std::collections::BTreeSet;
use std::sync::Arc;

use desk_bridge::{Permission, PluginManifest};

use crate::bindings::{DirEntry, Error, ErrorCode, Grant, NotifyLevel, Request, Response};
use crate::host::Host;

/// The imports of one plugin instance. The Wasmtime glue calls these; so can tests, without Wasm.
pub struct Imports {
    plugin: String,
    declared: BTreeSet<&'static str>,
    host: Arc<dyn Host>,
}

impl Imports {
    pub fn new(manifest: &PluginManifest, host: Arc<dyn Host>) -> Self {
        let declared = manifest.permissions.iter().flatten().map(kind).collect();
        Self {
            plugin: manifest.id.clone(),
            declared,
            host,
        }
    }

    /// The plugin these imports call as.
    pub fn plugin(&self) -> &str {
        &self.plugin
    }

    pub fn fs_read(&self, path: &str) -> Result<Vec<u8>, Error> {
        self.needs("fs.read", "fs:read")?;
        self.host.fs_read(&self.plugin, path)
    }

    pub fn fs_list(&self, path: &str) -> Result<Vec<DirEntry>, Error> {
        self.needs("fs.list", "fs:read")?;
        self.host.fs_list(&self.plugin, path)
    }

    pub fn fs_write(&self, path: &str, contents: &[u8], create_dirs: bool) -> Result<u64, Error> {
        self.needs("fs.write", "fs:write")?;
        self.host
            .fs_write(&self.plugin, path, contents, create_dirs)
    }

    pub fn net_fetch(&self, request: Request) -> Result<Response, Error> {
        self.needs("net.fetch", "net:fetch")?;
        self.host.net_fetch(&self.plugin, request)
    }

    pub fn ui_notify(
        &self,
        title: &str,
        body: Option<&str>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        self.needs("ui.notify", "ui:notify")?;
        self.host.ui_notify(&self.plugin, title, body, level)
    }

    /// Needs no permission, as on the bridge.
    pub fn perm_query(&self) -> Vec<Grant> {
        self.host.perm_query(&self.plugin)
    }

    /// Needs no permission: every plugin has its own namespace. The value comes back as JSON text.
    pub fn store_get(&self, key: &str) -> Result<Option<String>, Error> {
        let value = self.host.store_get(&self.plugin, key)?;
        Ok(value.map(|value| value.to_string()))
    }

    /// Needs no permission. `value` must be JSON text.
    pub fn store_set(&self, key: &str, value: &str) -> Result<(), Error> {
        let value = serde_json::from_str(value).map_err(|e| Error {
            code: ErrorCode::InvalidParams,
            message: format!("store.set takes JSON text: {e}"),
        })?;
        self.host.store_set(&self.plugin, key, value)
    }

    /// Refuse before the host sees the call when the manifest never asked for `permission`.
    fn needs(&self, method: &str, permission: &'static str) -> Result<(), Error> {
        if self.declared.contains(permission) {
            return Ok(());
        }
        Err(Error {
            code: ErrorCode::PermissionDenied,
            message: format!(
                "{method} needs the {permission} permission, which {} does not declare",
                self.plugin
            ),
        })
    }
}

fn kind(permission: &Permission) -> &'static str {
    match permission {
        Permission::FsRead(_) => "fs:read",
        Permission::FsWrite(_) => "fs:write",
        Permission::ProcSpawn(_) => "proc:spawn",
        Permission::NetFetch(_) => "net:fetch",
        Permission::AudioCapture(_) => "audio:capture",
        Permission::UiSurface(_) => "ui:surface",
        Permission::UiNotify(_) => "ui:notify",
        Permission::PluginManage(_) => "plugin:manage",
        Permission::BrainConverse(_) => "brain:converse",
    }
}
