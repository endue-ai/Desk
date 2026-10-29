//! What backs every `desk:host` import. desk-core implements it; tests mock it.

use serde_json::Value;

use crate::bindings::{DirEntry, Error, Grant, NotifyLevel, Request, Response};

/// The desk side of a logic plugin's imports, one method per bridge method in the WIT. Every call
/// names the calling plugin; the implementation attaches that plugin's grant and scope, as the
/// bridge does for any caller, and answers `permission-denied` for anything not granted.
///
/// Calls come from the thread that runs the plugin, so implementations must be `Send + Sync`.
pub trait Host: Send + Sync + 'static {
    /// bridge: fs.read
    fn fs_read(&self, plugin: &str, path: &str) -> Result<Vec<u8>, Error>;
    /// bridge: fs.list
    fn fs_list(&self, plugin: &str, path: &str) -> Result<Vec<DirEntry>, Error>;
    /// bridge: fs.write. Returns the bytes written.
    fn fs_write(
        &self,
        plugin: &str,
        path: &str,
        contents: &[u8],
        create_dirs: bool,
    ) -> Result<u64, Error>;
    /// bridge: net.fetch
    fn net_fetch(&self, plugin: &str, request: Request) -> Result<Response, Error>;
    /// bridge: ui.notify
    fn ui_notify(
        &self,
        plugin: &str,
        title: &str,
        body: Option<&str>,
        level: NotifyLevel,
    ) -> Result<(), Error>;
    /// bridge: perm.query. The plugin's own grants.
    fn perm_query(&self, plugin: &str) -> Vec<Grant>;
    /// bridge: store.get. `None` when the key was never set.
    fn store_get(&self, plugin: &str, key: &str) -> Result<Option<Value>, Error>;
    /// bridge: store.set
    fn store_set(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error>;
}
