//! What backs every `desk:host` import. desk-core implements it; tests mock it.

use serde_json::Value;

use crate::bindings::{Command, CommandInfo, Decision, DirEntry, Duration, Error, Failure, Grant};
use crate::bindings::{LogEntry, LogLevel, NotifyLevel, Request, Response, Setting};

/// The desk side of a logic plugin's imports, one method per bridge method in the WIT. Every call
/// names the calling plugin; the implementation attaches that plugin's grant and scope, as the
/// bridge does for any caller, and answers `permission-denied` for anything not granted. JSON that
/// crosses the WIT as text arrives here parsed.
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
    /// bridge: perm.request. Asks the person; `None` means `session`. A refusal is a decision.
    fn perm_request(
        &self,
        plugin: &str,
        permission: Value,
        reason: &str,
        duration: Option<Duration>,
    ) -> Result<Decision, Error>;
    /// bridge: store.get. `None` when the key was never set.
    fn store_get(&self, plugin: &str, key: &str) -> Result<Option<Value>, Error>;
    /// bridge: store.set
    fn store_set(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error>;
    /// bridge: cmd.register. `args_schema` is JSON text the plugin host has checked.
    fn cmd_register(&self, plugin: &str, command: Command) -> Result<(), Error>;
    /// bridge: cmd.unregister
    fn cmd_unregister(&self, plugin: &str, id: &str) -> Result<(), Error>;
    /// bridge: cmd.list. Coverage by the plugin's `cmd:invoke` grant is the host's to check.
    fn cmd_list(&self, plugin: &str) -> Result<Vec<CommandInfo>, Error>;
    /// bridge: cmd.invoke. Returns the invocation id.
    fn cmd_invoke(&self, plugin: &str, id: &str, args: Option<Value>) -> Result<String, Error>;
    /// bridge: cmd.answer
    fn cmd_answer(
        &self,
        plugin: &str,
        invocation_id: &str,
        outcome: Result<Value, Failure>,
    ) -> Result<(), Error>;
    /// bridge: events.subscribe. Returns the subscription id.
    fn events_subscribe(&self, plugin: &str, names: &[String]) -> Result<String, Error>;
    /// bridge: events.unsubscribe
    fn events_unsubscribe(&self, plugin: &str, subscription_id: &str) -> Result<(), Error>;
    /// bridge: settings.get. `owner` `None` is the plugin's own; `None` when the key was never set.
    fn settings_get(
        &self,
        plugin: &str,
        key: &str,
        owner: Option<&str>,
    ) -> Result<Option<Value>, Error>;
    /// bridge: settings.set
    fn settings_set(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error>;
    /// bridge: settings.list. `others` false: the plugin's own; true: what `settings:read` covers.
    fn settings_list(&self, plugin: &str, others: bool) -> Result<Vec<Setting>, Error>;
    /// bridge: log.write
    fn log_write(
        &self,
        plugin: &str,
        level: LogLevel,
        message: &str,
        fields: Option<Value>,
    ) -> Result<(), Error>;
    /// bridge: log.tail. `channel` `None` merges every channel; `count` `None` means 100.
    fn log_tail(
        &self,
        plugin: &str,
        channel: Option<&str>,
        count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error>;
}
