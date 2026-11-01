//! One plugin's imports: each checks that the manifest declares the permission it needs and that
//! JSON text is JSON, then calls the `Host` as that plugin.

use std::sync::Arc;

use desk_bridge::{Permission, PluginManifest};
use serde_json::Value;

use crate::bindings::{Command, CommandInfo, Decision, DirEntry, Duration, Error, ErrorCode};
use crate::bindings::{
    Failure, Grant, LogEntry, LogLevel, NotifyLevel, Request, Response, Setting,
};
use crate::host::Host;

/// The prefix of the store keys the host keeps in a plugin's own store (a connector's instances
/// and cursors); a guest can neither read nor write them.
pub(crate) const RESERVED: &str = "desk.";

/// The permissions `desk:host` imports need. The imports are the closed set here, not the
/// vocabulary: a permission the vocabulary gains later authorises no import until one names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Needs {
    FsRead,
    FsWrite,
    NetFetch,
    UiNotify,
    CmdInvoke,
    EventsSubscribe,
    SettingsRead,
    LogRead,
}

impl Needs {
    fn name(self) -> &'static str {
        match self {
            Self::FsRead => "fs:read",
            Self::FsWrite => "fs:write",
            Self::NetFetch => "net:fetch",
            Self::UiNotify => "ui:notify",
            Self::CmdInvoke => "cmd:invoke",
            Self::EventsSubscribe => "events:subscribe",
            Self::SettingsRead => "settings:read",
            Self::LogRead => "log:read",
        }
    }

    fn granted_by(self, permission: &Permission) -> bool {
        match self {
            Self::FsRead => matches!(permission, Permission::FsRead(_)),
            Self::FsWrite => matches!(permission, Permission::FsWrite(_)),
            Self::NetFetch => matches!(permission, Permission::NetFetch(_)),
            Self::UiNotify => matches!(permission, Permission::UiNotify(_)),
            Self::CmdInvoke => matches!(permission, Permission::CmdInvoke(_)),
            Self::EventsSubscribe => matches!(permission, Permission::EventsSubscribe(_)),
            Self::SettingsRead => matches!(permission, Permission::SettingsRead(_)),
            Self::LogRead => matches!(permission, Permission::LogRead(_)),
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

    /// Needs no permission: asking is how a plugin gets one. `permission` must be JSON text.
    pub fn perm_request(
        &self,
        permission: &str,
        reason: &str,
        duration: Option<Duration>,
    ) -> Result<Decision, Error> {
        let permission = json("perm.request", "permission", permission)?;
        self.host
            .perm_request(&self.plugin, permission, reason, duration)
    }

    /// Needs no permission: every plugin has its own namespace. The value comes back as JSON text.
    /// Keys under `desk.` are the host's (a connector's instances and cursors): permission-denied.
    pub fn store_get(&self, key: &str) -> Result<Option<String>, Error> {
        self.own_key("store.get", key)?;
        let value = self.host.store_get(&self.plugin, key)?;
        Ok(value.map(|value| value.to_string()))
    }

    /// Needs no permission, but not under `desk.`, as `store_get`. `value` must be JSON text.
    pub fn store_set(&self, key: &str, value: &str) -> Result<(), Error> {
        self.own_key("store.set", key)?;
        let value = json("store.set", "value", value)?;
        self.host.store_set(&self.plugin, key, value)
    }

    /// Needs no permission: the plugin becomes the provider. `args_schema` must be JSON text.
    pub fn cmd_register(&self, command: Command) -> Result<(), Error> {
        if let Some(schema) = &command.args_schema {
            json("cmd.register", "args-schema", schema)?;
        }
        self.host.cmd_register(&self.plugin, command)
    }

    /// Needs no permission: only the plugin's own commands.
    pub fn cmd_unregister(&self, id: &str) -> Result<(), Error> {
        self.host.cmd_unregister(&self.plugin, id)
    }

    pub fn cmd_list(&self) -> Result<Vec<CommandInfo>, Error> {
        self.needs("cmd.list", Needs::CmdInvoke)?;
        self.host.cmd_list(&self.plugin)
    }

    /// `args` must be JSON text. Returns the invocation id.
    pub fn cmd_invoke(&self, id: &str, args: Option<&str>) -> Result<String, Error> {
        self.needs("cmd.invoke", Needs::CmdInvoke)?;
        let args = args
            .map(|args| json("cmd.invoke", "args", args))
            .transpose()?;
        self.host.cmd_invoke(&self.plugin, id, args)
    }

    /// Needs no permission: only invocations of the plugin's own commands. An `ok` outcome must be
    /// JSON text.
    pub fn cmd_answer(
        &self,
        invocation_id: &str,
        outcome: Result<&str, Failure>,
    ) -> Result<(), Error> {
        let outcome = match outcome {
            Ok(result) => Ok(json("cmd.answer", "result", result)?),
            Err(failure) => Err(failure),
        };
        self.host.cmd_answer(&self.plugin, invocation_id, outcome)
    }

    /// Returns the subscription id.
    pub fn events_subscribe(&self, names: &[String]) -> Result<String, Error> {
        self.needs("events.subscribe", Needs::EventsSubscribe)?;
        self.host.events_subscribe(&self.plugin, names)
    }

    /// Needs no permission: only the plugin's own subscriptions.
    pub fn events_unsubscribe(&self, subscription_id: &str) -> Result<(), Error> {
        self.host.events_unsubscribe(&self.plugin, subscription_id)
    }

    /// The plugin's own setting needs no permission; another `owner`'s needs `settings:read`. The
    /// value comes back as JSON text.
    pub fn settings_get(&self, key: &str, owner: Option<&str>) -> Result<Option<String>, Error> {
        if owner.is_some_and(|owner| owner != self.plugin) {
            self.needs("settings.get", Needs::SettingsRead)?;
        }
        let value = self.host.settings_get(&self.plugin, key, owner)?;
        Ok(value.map(|value| value.to_string()))
    }

    /// Needs no permission: only the plugin's own settings. `value` must be JSON text.
    pub fn settings_set(&self, key: &str, value: &str) -> Result<(), Error> {
        let value = json("settings.set", "value", value)?;
        self.host.settings_set(&self.plugin, key, value)
    }

    /// The plugin's own settings need no permission; `others` needs `settings:read`.
    pub fn settings_list(&self, others: bool) -> Result<Vec<Setting>, Error> {
        if others {
            self.needs("settings.list", Needs::SettingsRead)?;
        }
        self.host.settings_list(&self.plugin, others)
    }

    /// Needs no permission: the plugin's own channel. `fields` must be JSON text.
    pub fn log_write(
        &self,
        level: LogLevel,
        message: &str,
        fields: Option<&str>,
    ) -> Result<(), Error> {
        let fields = fields
            .map(|fields| json("log.write", "fields", fields))
            .transpose()?;
        self.host.log_write(&self.plugin, level, message, fields)
    }

    pub fn log_tail(
        &self,
        channel: Option<&str>,
        count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error> {
        self.needs("log.tail", Needs::LogRead)?;
        self.host.log_tail(&self.plugin, channel, count)
    }

    /// Refuse a store key the host keeps for itself (`RESERVED`).
    fn own_key(&self, method: &str, key: &str) -> Result<(), Error> {
        if !key.starts_with(RESERVED) {
            return Ok(());
        }
        Err(Error {
            code: ErrorCode::PermissionDenied,
            message: format!(
                "{method}: keys under {RESERVED} belong to the desk, not to {}",
                self.plugin
            ),
        })
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

/// Parse JSON text that crossed the WIT, or answer invalid-params before the host sees the call.
fn json(method: &str, what: &str, text: &str) -> Result<Value, Error> {
    serde_json::from_str(text).map_err(|e| Error {
        code: ErrorCode::InvalidParams,
        message: format!("{method} takes {what} as JSON text: {e}"),
    })
}
