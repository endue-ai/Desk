//! One plugin's imports: each checks that the manifest declares the permission it needs, then
//! calls the `Host` as that plugin.

use std::sync::Arc;

use desk_bridge::{Permission, PluginManifest};

use crate::bindings::{DirEntry, Error, ErrorCode, Grant, NotifyLevel, Request, Response};
use crate::host::Host;

/// The permissions `desk:host` imports need. The imports are the closed set here, not the
/// vocabulary: a permission the vocabulary gains later authorises no import until one names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Needs {
    FsRead,
    FsWrite,
    NetFetch,
    UiNotify,
}

impl Needs {
    fn name(self) -> &'static str {
        match self {
            Self::FsRead => "fs:read",
            Self::FsWrite => "fs:write",
            Self::NetFetch => "net:fetch",
            Self::UiNotify => "ui:notify",
        }
    }

    fn granted_by(self, permission: &Permission) -> bool {
        match self {
            Self::FsRead => matches!(permission, Permission::FsRead(_)),
            Self::FsWrite => matches!(permission, Permission::FsWrite(_)),
            Self::NetFetch => matches!(permission, Permission::NetFetch(_)),
            Self::UiNotify => matches!(permission, Permission::UiNotify(_)),
        }
    }
}

/// The imports of one plugin instance. The Wasmtime glue calls these; so can tests, without Wasm.
pub struct Imports {
    plugin: String,
    declared: Vec<Permission>,
    host: Arc<dyn Host>,
}

impl Imports {
    pub fn new(manifest: &PluginManifest, host: Arc<dyn Host>) -> Self {
        Self {
            plugin: manifest.id.clone(),
            declared: manifest.permissions.clone().unwrap_or_default(),
            host,
        }
    }

    /// The plugin these imports call as.
    pub fn plugin(&self) -> &str {
        &self.plugin
    }

    pub fn fs_read(&self, path: &str) -> Result<Vec<u8>, Error> {
        self.needs("fs.read", Needs::FsRead)?;
        self.host.fs_read(&self.plugin, path)
    }

    pub fn fs_list(&self, path: &str) -> Result<Vec<DirEntry>, Error> {
        self.needs("fs.list", Needs::FsRead)?;
        self.host.fs_list(&self.plugin, path)
    }

    pub fn fs_write(&self, path: &str, contents: &[u8], create_dirs: bool) -> Result<u64, Error> {
        self.needs("fs.write", Needs::FsWrite)?;
        self.host
            .fs_write(&self.plugin, path, contents, create_dirs)
    }

    pub fn net_fetch(&self, request: Request) -> Result<Response, Error> {
        self.needs("net.fetch", Needs::NetFetch)?;
        self.host.net_fetch(&self.plugin, request)
    }

    pub fn ui_notify(
        &self,
        title: &str,
        body: Option<&str>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        self.needs("ui.notify", Needs::UiNotify)?;
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

    /// Refuse before the host sees the call when the manifest never asked for the permission.
    fn needs(&self, method: &str, needs: Needs) -> Result<(), Error> {
        if self.declared.iter().any(|p| needs.granted_by(p)) {
            return Ok(());
        }
        Err(Error {
            code: ErrorCode::PermissionDenied,
            message: format!(
                "{method} needs the {} permission, which {} does not declare",
                needs.name(),
                self.plugin
            ),
        })
    }
}
