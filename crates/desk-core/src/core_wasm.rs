//! Wasm connectors on the connector host (desk-plugin-host, ADR 0034): every ready plugin of kind
//! `connector` with `binding: wasm` is installed when connectors start or when it installs later,
//! reloaded on hot reload, and its instances paused while the plugin is off. Instances and cursors
//! live in the plugin's own store (`desk.connector/…`); titles beside them; secret settings in the
//! secrets file, never in the host. An `mcp` connector is listed without instances until the VM
//! runs. A connector plugin claiming a built-in's id is not run.

use std::sync::Arc;

use desk_bridge::{
    ConnectorBinding, ConnectorConnectParams, ConnectorConnectResult, ConnectorDisconnectResult,
    ConnectorInfo, ConnectorManifest, ConnectorState, ConnectorSyncNowResult, ErrorCode,
    PluginInfo, PluginKind, PluginStatus, True,
};
use desk_plugin_host::{ConnectorHost, Limits};
use serde_json::{Map, Value};

use crate::calendar_items::{CALENDAR, REMINDERS};
use crate::core_connectors::plugin_error;
use crate::core_host::CoreHost;
use crate::handler::{Answer, Core, error, io_error, json};

impl Core {
    /// The connector host, once a Wasm connector made one.
    pub(crate) fn connector_host(&self) -> Option<Arc<ConnectorHost>> {
        self.connectors
            .host
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Install the plugin into the connector host when it is a ready Wasm connector and the
    /// connectors have started; its instances then follow the plugin, paused while it is off.
    pub(crate) fn install_connector(&self, info: &PluginInfo) {
        if self.connectors.me.get().is_none() || wasm(info).is_none() {
            return;
        }
        let folders = self.plugin_folders();
        let Some((_, dir)) = folders.iter().find(|(id, _)| *id == info.id) else {
            return;
        };
        let Some(host) = self.ensure_host() else {
            return;
        };
        // One that does not install is listed without instances.
        if host.install(dir).is_ok() {
            self.follow_plugin(&host, &info.id);
        }
        self.drain_statuses();
    }

    /// The plugin's files changed: build the connector again from them.
    pub(crate) fn reload_connector(&self, id: &str) {
        let Some(host) = self.connector_host() else {
            if let Some(info) = self.plugins().into_iter().find(|p| p.id == id) {
                self.install_connector(&info);
            }
            return;
        };
        if host.installed().iter().any(|installed| installed == id) {
            let _ = host.reload(id);
            self.drain_statuses();
        } else if let Some(info) = self.plugins().into_iter().find(|p| p.id == id) {
            self.install_connector(&info);
        }
    }

    /// The plugin was turned on or off: its instances resume or pause.
    pub(crate) fn connector_toggled(&self, id: &str) {
        let Some(host) = self.connector_host() else {
            return;
        };
        if host.installed().iter().any(|installed| installed == id) {
            self.follow_plugin(&host, id);
            self.drain_statuses();
        }
    }

    /// The connector plugins as connector.list lists them.
    pub(crate) fn plugin_connector_infos(&self) -> Vec<ConnectorInfo> {
        let host = self.connector_host();
        let mut infos = Vec::new();
        for info in self.plugins() {
            let Some(connector) = listed(&info) else {
                continue;
            };
            let mut instances = match (&host, connector.binding) {
                (Some(host), ConnectorBinding::Wasm) => {
                    host.instances(&info.id).unwrap_or_default()
                }
                _ => Vec::new(),
            };
            for instance in &mut instances {
                instance.title = self.title(&info.id, &instance.instance);
            }
            let resources = connector.resources.clone();
            infos.push(ConnectorInfo {
                id: info.id.clone(),
                instances,
                resources,
            });
        }
        infos
    }

    /// connector.connect of a plugin's connector. Its settings are checked by the host, which never
    /// keeps the secret ones; those go to the secrets file. Grants nothing.
    pub(crate) fn connect_wasm(&self, params: ConnectorConnectParams) -> Answer {
        let id = params.connector.as_str();
        let info = self.plugins().into_iter().find(|p| p.id == id);
        let connector = info.as_ref().and_then(listed).cloned();
        let connector =
            connector.ok_or_else(|| error(ErrorCode::NotFound, format!("no connector {id}")))?;
        if connector.binding == ConnectorBinding::Mcp {
            let why =
                format!("{id} is an MCP connector, which runs in the VM; this desk runs none yet");
            return Err(error(ErrorCode::Unsupported, why));
        }
        let host = self.installed_host(id)?;
        let instance = params.instance.as_deref().unwrap_or("default");
        let given = params.settings.clone().unwrap_or_default();
        let declared = connector.instance_settings.unwrap_or_default();
        let secret: Map<String, Value> = given
            .iter()
            .filter(|(key, _)| declared.get(*key).is_some_and(|s| s.secret == Some(true)))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        self.connecting(id, instance);
        let created = host.create_instance(id, instance, Value::Object(given));
        let status = match created {
            Ok(status) => status,
            Err(failure) => {
                self.connect_failed(id, instance);
                return Err(plugin_error(failure));
            }
        };
        if let Err(why) = self.lock_secrets().set(id, instance, secret) {
            let _ = host.remove_instance(id, instance);
            // What the host said about the instance it no longer has goes nowhere.
            self.drain_statuses();
            self.connect_failed(id, instance);
            return Err(io_error(why));
        }
        self.set_title(id, instance, params.title);
        self.announce_connected(id, instance, status);
        self.follow_plugin(&host, id);
        self.drain_statuses();
        json(ConnectorConnectResult {
            instance: instance.to_owned(),
        })
    }

    /// connector.disconnect of a plugin's connector: its items, record, cursor, title and secrets.
    pub(crate) fn disconnect_wasm(&self, id: &str, instance: &str) -> Answer {
        let host = self.installed_host(id)?;
        host.remove_instance(id, instance).map_err(plugin_error)?;
        // The instance is gone either way; a secret the file kept is overwritten on the next write.
        let _ = self.lock_secrets().remove(id, instance);
        self.set_title(id, instance, None);
        self.announce_disconnected(id, instance);
        self.drain_statuses();
        json(ConnectorDisconnectResult {})
    }

    /// connector.sync of a plugin's connector: the sync runs now, before this answers.
    pub(crate) fn sync_wasm(&self, id: &str, instance: &str) -> Answer {
        let host = self.installed_host(id)?;
        let synced = host.sync_now(id, instance);
        self.drain_statuses();
        synced.map_err(plugin_error)?;
        json(ConnectorSyncNowResult { started: True })
    }

    /// Pause the connector's instances while its plugin is off, resume them while it is on.
    fn follow_plugin(&self, host: &ConnectorHost, id: &str) {
        let running = self.running(id);
        for instance in host.instances(id).unwrap_or_default() {
            let paused = instance.status.state == ConnectorState::Paused;
            let _ = match (running, paused) {
                (false, false) => host.pause(id, &instance.instance),
                (true, true) => host.resume(id, &instance.instance),
                _ => Ok(()),
            };
        }
    }

    fn installed_host(&self, id: &str) -> Result<Arc<ConnectorHost>, desk_bridge::BridgeError> {
        let host = self.connector_host();
        let host = host.filter(|host| host.installed().iter().any(|installed| installed == id));
        host.ok_or_else(|| error(ErrorCode::NotFound, format!("no connector {id} is running")))
    }

    /// The connector host, made the first time a Wasm connector needs it.
    fn ensure_host(&self) -> Option<Arc<ConnectorHost>> {
        let me = self.connectors.me.get()?.clone();
        let mut slot = self
            .connectors
            .host
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(host) = slot.as_ref() {
            return Some(host.clone());
        }
        let adapter = Arc::new(CoreHost::new(me));
        let made = ConnectorHost::new(
            adapter.clone(),
            adapter,
            self.clock.clone(),
            Limits::default(),
        );
        let host = Arc::new(made.ok()?);
        self.feed().host = Some(host.watch_status());
        *slot = Some(host.clone());
        Some(host)
    }
}

/// A ready connector plugin that is not a built-in's: its connector block.
fn listed(info: &PluginInfo) -> Option<&ConnectorManifest> {
    let manifest = info.manifest.as_ref()?;
    let reserved = info.id == CALENDAR || info.id == REMINDERS;
    let ready = info.status == PluginStatus::Ready && manifest.kind == PluginKind::Connector;
    (ready && !reserved).then_some(manifest.connector.as_ref()?)
}

/// A ready Wasm connector plugin: its connector block.
fn wasm(info: &PluginInfo) -> Option<&ConnectorManifest> {
    listed(info).filter(|connector| connector.binding == ConnectorBinding::Wasm)
}
