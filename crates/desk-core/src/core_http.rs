//! Http connectors (`binding: http`, ADR 0106): plugins whose connector is an http block the core
//! runs itself. The core keeps their instances (records in each plugin's store under
//! `desk.connector/instances`, the connector host's shape), reads the token from the secrets file,
//! checks the plugin's `net:fetch` grant for the base URL's host before each sync, and writes what a
//! sync brings: every page again, new and changed items written, the ones that left removed. The
//! connector host and guests never hold the token, and it never crosses the bridge.

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};

use desk_bridge::{
    ConnectorConnectParams, ConnectorConnectResult, ConnectorDisconnectResult, ConnectorInstance,
    ConnectorManifest, ConnectorState, ConnectorStatus, ConnectorSyncNowResult, ErrorCode,
    HttpBinding, ItemSource, True,
};
use desk_plugin_host::{check_instance_id, check_instance_settings};
use serde_json::{Map, Value, json};

use crate::core_connectors::{INSTANCES, status};
use crate::handler::{Answer, Core, error, io_error, json as answer};
use crate::time::parse_rfc3339;

/// Between syncs when the manifest names no interval.
const INTERVAL: u64 = 900;

/// One instance of an http connector.
pub(crate) struct HttpInstance {
    pub(crate) settings: Map<String, Value>,
    pub(crate) last_sync_at: Option<String>,
    pub(crate) status: ConnectorStatus,
    pub(crate) due: Option<SystemTime>,
    pub(crate) syncing: bool,
}

/// Every http connector's instances, by connector id and instance id.
#[derive(Default)]
pub(crate) struct HttpConnectors(pub(crate) BTreeMap<String, BTreeMap<String, HttpInstance>>);

impl Core {
    /// Whether `id` is an installed, valid plugin whose connector binding is http.
    pub(crate) fn is_http(&self, id: &str) -> bool {
        self.http_manifest(id).is_some()
    }

    /// Load the connector's instances from its store, once; each syncs at the next tick.
    pub(crate) fn load_http(&self, id: &str, connector: &ConnectorManifest) {
        if self.http().0.contains_key(id) {
            return;
        }
        let now = self.clock.now();
        let every = interval(connector);
        let mut loaded = BTreeMap::new();
        if let Some(Value::Array(records)) = self.stored(id, INSTANCES) {
            for record in records {
                let (Some(name), Some(Value::Object(settings))) =
                    (record["id"].as_str(), record.get("settings").cloned())
                else {
                    continue;
                };
                let last = record["lastSyncAt"].as_str().map(str::to_owned);
                let synced = last.as_deref().and_then(parse_rfc3339);
                let old = every.is_some_and(|e| {
                    let seconds = crate::calendar_items::seconds(now);
                    synced.is_some_and(|at| at < seconds - 2 * e.as_secs() as i64)
                });
                let state = if old {
                    ConnectorState::Stale
                } else {
                    ConnectorState::Connected
                };
                let instance = HttpInstance {
                    settings,
                    status: status(state, last.clone(), None),
                    last_sync_at: last,
                    due: every.map(|_| now),
                    syncing: false,
                };
                loaded.insert(name.to_owned(), instance);
            }
        }
        self.http().0.insert(id.to_owned(), loaded);
    }

    /// The connector's instances as connector.list lists them, without their titles; paused while
    /// its plugin is off.
    pub(crate) fn http_instances(&self, id: &str) -> Vec<ConnectorInstance> {
        let running = self.running(id);
        let http = self.http();
        let instances = http.0.get(id).into_iter().flatten();
        instances
            .map(|(name, instance)| self.http_listing(id, name, instance, running))
            .collect()
    }

    /// connector.connect of an http connector: settings checked, secret ones to the secrets file.
    pub(crate) fn connect_http(&self, params: ConnectorConnectParams) -> Answer {
        let id = params.connector.as_str();
        let connector = self.http_manifest(id).ok_or_else(|| missing(id))?.0;
        let name = params.instance.as_deref().unwrap_or("default");
        check_instance_id(name).map_err(host_error)?;
        self.load_http(id, &connector);
        if self.http().0.get(id).is_some_and(|i| i.contains_key(name)) {
            let why = format!("{id} already has an instance {name}");
            return Err(error(ErrorCode::AlreadyExists, why));
        }
        let given = params.settings.clone().unwrap_or_default();
        let declared = connector.instance_settings.as_ref();
        let kept = check_instance_settings(declared, &Value::Object(given.clone()));
        let kept = kept.map_err(host_error)?;
        let secret: Map<String, Value> = given
            .into_iter()
            .filter(|(key, _)| {
                declared
                    .and_then(|d| d.get(key))
                    .is_some_and(|s| s.secret == Some(true))
            })
            .collect();
        self.lock_secrets()
            .set(id, name, secret)
            .map_err(io_error)?;
        let instance = HttpInstance {
            settings: kept,
            last_sync_at: None,
            status: status(ConnectorState::Connected, None, None),
            due: interval(&connector).map(|_| self.clock.now()),
            syncing: false,
        };
        let listed = instance.status.clone();
        self.http()
            .0
            .entry(id.to_owned())
            .or_default()
            .insert(name.to_owned(), instance);
        self.persist_http(id);
        self.set_title(id, name, params.title);
        self.announce_connected(id, name, listed);
        answer(ConnectorConnectResult {
            instance: name.to_owned(),
        })
    }

    /// connector.disconnect of an http connector: its items, record, title and secrets go.
    pub(crate) fn disconnect_http(&self, id: &str, name: &str) -> Answer {
        let removed = self.http().0.get_mut(id).and_then(|i| i.remove(name));
        if removed.is_none() {
            return Err(no_instance(id, name));
        }
        let index = self.index()?;
        index
            .clear(&source(id, name))
            .map_err(crate::core_data::index_error)?;
        // The instance is gone either way; a secret the file kept is overwritten on the next write.
        let _ = self.lock_secrets().remove(id, name);
        self.persist_http(id);
        self.set_title(id, name, None);
        self.announce_disconnected(id, name);
        answer(ConnectorDisconnectResult {})
    }

    /// connector.sync of an http connector: the sync runs now, before this answers.
    pub(crate) fn sync_http_now(&self, id: &str, name: &str) -> Answer {
        if !self.http().0.get(id).is_some_and(|i| i.contains_key(name)) {
            return Err(no_instance(id, name));
        }
        if !self.running(id) {
            let why = format!("{id} is turned off; turn it on to sync {name}");
            return Err(error(ErrorCode::InvalidParams, why));
        }
        self.sync_http(id, name);
        answer(ConnectorSyncNowResult { started: True })
    }

    /// Every http sync that is due, of plugins that are on, in (connector, instance) order.
    pub(crate) fn tick_http(&self) -> Vec<(String, String)> {
        let now = self.clock.now();
        let due: Vec<(String, String)> = {
            let http = self.http();
            let all = http.0.iter().flat_map(|(id, instances)| {
                let due = instances
                    .iter()
                    .filter(|(_, i)| !i.syncing && i.due.is_some_and(|d| d <= now));
                due.map(move |(name, _)| (id.clone(), name.clone()))
            });
            all.collect()
        };
        let due: Vec<(String, String)> =
            due.into_iter().filter(|(id, _)| self.running(id)).collect();
        for (id, name) in &due {
            self.sync_http(id, name);
        }
        due
    }

    /// The plugin was turned on or off: its instances say `paused` or come back, due now.
    pub(crate) fn http_toggled(&self, id: &str) {
        let running = self.running(id);
        let now = self.clock.now();
        let changes: Vec<(String, ConnectorStatus)> = {
            let mut http = self.http();
            let instances = http.0.get_mut(id).into_iter().flatten();
            instances
                .map(|(name, instance)| {
                    if running {
                        instance.due = instance.due.map(|_| now);
                    }
                    (
                        name.clone(),
                        self.http_listing(id, name, instance, running).status,
                    )
                })
                .collect()
        };
        for (name, changed) in changes {
            self.report(id, &name, changed);
        }
    }

    /// The instances' records in the plugin's own store, as the connector host keeps a Wasm one's.
    pub(crate) fn persist_http(&self, id: &str) {
        let records: Vec<Value> = {
            let http = self.http();
            let instances = http.0.get(id).into_iter().flatten();
            instances
                .map(|(name, i)| {
                    json!({ "id": name, "settings": i.settings, "paused": false, "lastSyncAt": i.last_sync_at })
                })
                .collect()
        };
        // A refused write leaves the instances in memory for this run.
        let _ = self.store_put(id, INSTANCES, Value::Array(records));
    }

    fn http_listing(
        &self,
        id: &str,
        name: &str,
        i: &HttpInstance,
        running: bool,
    ) -> ConnectorInstance {
        let status = if running || i.syncing {
            i.status.clone()
        } else {
            status(ConnectorState::Paused, i.last_sync_at.clone(), None)
        };
        ConnectorInstance {
            connector: id.to_owned(),
            instance: name.to_owned(),
            title: None,
            settings: Some(i.settings.clone()),
            status,
        }
    }

    /// The connector block and its http block of a ready http connector plugin.
    pub(crate) fn http_manifest(&self, id: &str) -> Option<(ConnectorManifest, HttpBinding)> {
        let info = self.plugins().into_iter().find(|p| p.id == id)?;
        let connector = crate::core_wasm::listed(&info)?.clone();
        let binding = connector.http.clone()?;
        (connector.binding == desk_bridge::ConnectorBinding::Http).then_some((connector, binding))
    }

    pub(crate) fn http(&self) -> std::sync::MutexGuard<'_, HttpConnectors> {
        self.connectors
            .http
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub(crate) fn interval(connector: &ConnectorManifest) -> Option<Duration> {
    match connector.sync.mode {
        desk_bridge::ConnectorSyncMode::Push => None,
        _ => Some(Duration::from_secs(
            connector.sync.interval_seconds.unwrap_or(INTERVAL),
        )),
    }
}

pub(crate) fn source(id: &str, name: &str) -> ItemSource {
    ItemSource {
        connector: id.to_owned(),
        instance: name.to_owned(),
    }
}

pub(crate) fn missing(id: &str) -> desk_bridge::BridgeError {
    error(ErrorCode::NotFound, format!("no connector {id}"))
}

fn no_instance(id: &str, name: &str) -> desk_bridge::BridgeError {
    error(ErrorCode::NotFound, format!("{id} has no instance {name}"))
}

/// A settings or instance id problem the connector host's checks found, as a bridge error.
fn host_error(e: desk_plugin_host::Error) -> desk_bridge::BridgeError {
    error(ErrorCode::InvalidParams, e.message)
}
