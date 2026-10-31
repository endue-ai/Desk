//! The built-in connectors `desk.calendar` (resource `event`) and `desk.reminders` (resource `task`)
//! over the OS calendar (desk-sys `CalendarSource`): `auth: none`, no settings, one instance
//! `default`, never turned off. They exist only when the core has a calendar source. Their records
//! live in each one's store under `desk.connector/instances`, the connector host's shape. The OS is
//! asked only on connect; a refusal leaves the instance in `error` until a sync finds access.

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};

use desk_bridge::{
    ConnectorConnectParams, ConnectorConnectResult, ConnectorInfo, ConnectorInstance,
    ConnectorResource, ConnectorState, ConnectorStatus, ErrorCode, ItemKind, ItemQuery,
};
use desk_index::DataReadScope;
use desk_plugin_host::rfc3339;
use desk_sys::calendar::Authorization;
use serde_json::{Value, json};

use crate::calendar_items::{self, CALENDAR, INSTANCE, REMINDERS, comparable, seconds};
use crate::core_connectors::{INSTANCES, status};
use crate::handler::{Answer, Core, error, json as answer};
use crate::time::parse_rfc3339;

/// Between syncs, as the connector default; past two of them an instance loads `stale`.
const INTERVAL: Duration = Duration::from_secs(900);

/// One built-in connector's instance.
pub(crate) struct BuiltIn {
    status: ConnectorStatus,
    last_sync_at: Option<String>,
    due: SystemTime,
    syncing: bool,
}

/// The built-in instances, by connector id.
#[derive(Default)]
pub(crate) struct BuiltIns(BTreeMap<String, BuiltIn>);

impl Core {
    /// Whether `id` is a built-in connector on this desk.
    pub(crate) fn is_builtin(&self, id: &str) -> bool {
        self.calendar.is_some() && (id == CALENDAR || id == REMINDERS)
    }

    /// Bring back the instances the store records; each syncs at the next tick. Never asks the OS.
    pub(crate) fn load_builtins(&self) {
        if self.calendar.is_none() {
            return;
        }
        let now = self.clock.now();
        for id in [CALENDAR, REMINDERS] {
            let Some(Value::Array(records)) = self.stored(id, INSTANCES) else {
                continue;
            };
            let Some(record) = records.iter().find(|r| r["id"] == INSTANCE) else {
                continue;
            };
            let last = record["lastSyncAt"].as_str().map(str::to_owned);
            let synced = last.as_deref().and_then(parse_rfc3339);
            let stale_before = seconds(now) - 2 * INTERVAL.as_secs() as i64;
            let state = match synced {
                Some(at) if at < stale_before => ConnectorState::Stale,
                _ => ConnectorState::Connected,
            };
            let built_in = BuiltIn {
                status: status(state, last.clone(), None),
                last_sync_at: last,
                due: now,
                syncing: false,
            };
            self.builtins().0.insert(id.to_owned(), built_in);
        }
    }

    /// The built-in connectors as connector.list lists them.
    pub(crate) fn builtin_infos(&self) -> Vec<ConnectorInfo> {
        if self.calendar.is_none() {
            return Vec::new();
        }
        let builtins = self.builtins();
        [(CALENDAR, ItemKind::Event), (REMINDERS, ItemKind::Task)]
            .into_iter()
            .map(|(id, kind)| ConnectorInfo {
                id: id.to_owned(),
                instances: builtins
                    .0
                    .get(id)
                    .map(|b| self.listing(id, b))
                    .into_iter()
                    .collect(),
                resources: vec![ConnectorResource {
                    kind,
                    actions: None,
                    live: None,
                }],
            })
            .collect()
    }

    /// connector.connect of a built-in: asks the OS when it never was, on this thread.
    pub(crate) fn connect_builtin(&self, params: ConnectorConnectParams) -> Answer {
        let id = params.connector.as_str();
        let instance = params.instance.as_deref().unwrap_or(INSTANCE);
        if instance != INSTANCE {
            let why = format!("{id} has one instance, {INSTANCE}, not {instance}");
            return Err(error(ErrorCode::InvalidParams, why));
        }
        if params.settings.as_ref().is_some_and(|s| !s.is_empty()) {
            let why = format!("{id} takes no settings");
            return Err(error(ErrorCode::InvalidParams, why));
        }
        if self.builtins().0.contains_key(id) {
            let why = format!("{id} already has an instance {INSTANCE}");
            return Err(error(ErrorCode::AlreadyExists, why));
        }
        let calendar = self.calendar.clone().ok_or_else(|| missing(id))?;
        let mut access = calendar.authorization();
        if access == Authorization::NotDetermined {
            access = calendar
                .request_access()
                .map_err(|e| error(e.code, e.message))?;
        }
        let refusal = (!access.can_read()).then(|| refused(id));
        let state = match refusal {
            Some(_) => ConnectorState::Error,
            None => ConnectorState::Connected,
        };
        let built_in = BuiltIn {
            status: status(state, None, refusal.clone()),
            last_sync_at: None,
            due: self.clock.now(),
            syncing: false,
        };
        let listed = self.listing(id, &built_in);
        self.builtins().0.insert(id.to_owned(), built_in);
        self.persist_builtin(id);
        self.set_title(id, INSTANCE, params.title);
        self.announce_connected(id, INSTANCE, listed.status);
        match refusal {
            Some(message) => Err(error(ErrorCode::PermissionDenied, message)),
            None => answer(ConnectorConnectResult {
                instance: INSTANCE.to_owned(),
            }),
        }
    }

    /// connector.disconnect of a built-in: its items, its record and its title go.
    pub(crate) fn disconnect_builtin(&self, id: &str, instance: &str) -> Answer {
        self.builtin_instance(id, instance)?;
        let index = self.index()?;
        let cleared = index.clear(&calendar_items::source(id));
        cleared.map_err(crate::core_data::index_error)?;
        self.builtins().0.remove(id);
        self.persist_builtin(id);
        self.set_title(id, INSTANCE, None);
        self.announce_disconnected(id, INSTANCE);
        answer(desk_bridge::ConnectorDisconnectResult {})
    }

    /// connector.sync of a built-in: the sync runs now, before this answers.
    pub(crate) fn sync_builtin_now(&self, id: &str, instance: &str) -> Answer {
        self.builtin_instance(id, instance)?;
        self.sync_builtin(id);
        answer(desk_bridge::ConnectorSyncNowResult {
            started: desk_bridge::True,
        })
    }

    /// Every built-in sync that is due, in id order. Returns the pairs it ran.
    pub(crate) fn tick_builtins(&self) -> Vec<(String, String)> {
        let now = self.clock.now();
        let due: Vec<String> = {
            let builtins = self.builtins();
            let due = builtins
                .0
                .iter()
                .filter(|(_, b)| b.due <= now && !b.syncing);
            due.map(|(id, _)| id.clone()).collect()
        };
        for id in &due {
            self.sync_builtin(id);
        }
        due.into_iter()
            .map(|id| (id, INSTANCE.to_owned()))
            .collect()
    }

    /// Sync one built-in: `syncing`, then `connected` with the time, or `error` with why.
    fn sync_builtin(&self, id: &str) {
        let syncing = {
            let mut builtins = self.builtins();
            let Some(built_in) = builtins.0.get_mut(id).filter(|b| !b.syncing) else {
                return;
            };
            built_in.syncing = true;
            built_in.due = self.clock.now() + INTERVAL;
            let last = built_in.last_sync_at.clone();
            built_in.status = status(ConnectorState::Syncing, last, None);
            built_in.status.clone()
        };
        self.report(id, INSTANCE, syncing);
        let outcome = self.run_builtin(id);
        let ended = {
            let mut builtins = self.builtins();
            let Some(built_in) = builtins.0.get_mut(id) else {
                // Disconnected meanwhile: what the sync wrote goes too.
                drop(builtins);
                if let Ok(index) = self.index() {
                    let _ = index.clear(&calendar_items::source(id));
                }
                return;
            };
            built_in.syncing = false;
            built_in.status = match outcome {
                Ok(()) => {
                    built_in.last_sync_at = Some(rfc3339(self.clock.now()));
                    status(
                        ConnectorState::Connected,
                        built_in.last_sync_at.clone(),
                        None,
                    )
                }
                Err(message) => {
                    let last = built_in.last_sync_at.clone();
                    status(ConnectorState::Error, last, Some(message))
                }
            };
            built_in.status.clone()
        };
        self.persist_builtin(id);
        self.report(id, INSTANCE, ended);
    }

    /// Read the OS calendar and write what changed since the index's copy.
    fn run_builtin(&self, id: &str) -> Result<(), String> {
        let calendar = self.calendar.clone().ok_or_else(|| missing(id).message)?;
        let index = self.index().map_err(|e| e.message)?.clone();
        if !calendar.authorization().can_read() {
            return Err(refused(id));
        }
        let now = self.clock.now();
        let fresh = calendar_items::fetch(calendar.as_ref(), id, now)?;
        let source = calendar_items::source(id);
        let mut existing = BTreeMap::new();
        let mut cursor: Option<String> = None;
        loop {
            let query =
                json!({ "sources": [format!("{id}/{INSTANCE}")], "limit": 500, "cursor": cursor });
            let query: ItemQuery = serde_json::from_value(query).map_err(|e| e.to_string())?;
            let page = index.query(&query, &DataReadScope::all());
            let page = page.map_err(|e| e.message)?;
            for item in &page.items {
                let value = comparable(item);
                let key = value["id"].as_str().unwrap_or_default().to_owned();
                existing.insert(key, value);
            }
            cursor = page.cursor;
            if cursor.is_none() {
                break;
            }
        }
        let (upserted, removed) = calendar_items::changes(&existing, fresh, &rfc3339(now))?;
        if !upserted.is_empty() {
            index.upsert(&upserted).map_err(|e| e.message)?;
        }
        if !removed.is_empty() {
            index.remove(&source, &removed).map_err(|e| e.message)?;
        }
        Ok(())
    }

    /// The built-in's record in its own store, as the connector host keeps a Wasm connector's.
    fn persist_builtin(&self, id: &str) {
        let record = self.builtins().0.get(id).map(|b| {
            json!({ "id": INSTANCE, "settings": {}, "paused": false, "lastSyncAt": b.last_sync_at })
        });
        let records = Value::Array(record.into_iter().collect());
        // A refused write leaves the instance in memory for this run.
        let _ = self.store_put(id, INSTANCES, records);
    }

    fn builtin_instance(&self, id: &str, instance: &str) -> Result<(), desk_bridge::BridgeError> {
        if instance == INSTANCE && self.builtins().0.contains_key(id) {
            return Ok(());
        }
        Err(error(
            ErrorCode::NotFound,
            format!("{id} has no instance {instance}"),
        ))
    }

    fn listing(&self, id: &str, built_in: &BuiltIn) -> ConnectorInstance {
        ConnectorInstance {
            connector: id.to_owned(),
            instance: INSTANCE.to_owned(),
            title: self.title(id, INSTANCE),
            settings: None,
            status: built_in.status.clone(),
        }
    }

    fn builtins(&self) -> std::sync::MutexGuard<'_, BuiltIns> {
        self.connectors
            .builtins
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn missing(id: &str) -> desk_bridge::BridgeError {
    error(ErrorCode::NotFound, format!("no connector {id}"))
}

/// Why a built-in cannot read, and where the person changes it.
fn refused(id: &str) -> String {
    let what = if id == CALENDAR {
        "Calendars"
    } else {
        "Reminders"
    };
    format!(
        "macOS does not let Desk read {}: allow it in System Settings, Privacy & Security, {what}, \
         then sync again",
        what.to_lowercase()
    )
}
