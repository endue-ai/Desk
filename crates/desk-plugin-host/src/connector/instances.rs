//! A connector's instances: their settings checked against `instanceSettings`, and their records in
//! the plugin's own store, under keys only the host reaches (`desk.`).

use std::collections::BTreeMap;
use std::time::SystemTime;

use desk_bridge::{ConnectorSetting, ConnectorSettingKind, ConnectorState, ConnectorStatus};
use serde_json::{Map, Value, json};

use crate::bindings::{Error, ErrorCode};
use crate::clock::parse_rfc3339;
use crate::connector_bindings::Instance as GuestInstance;

/// The store key of every instance's record: `[{ id, settings, paused, lastSyncAt }]`.
pub(crate) const INSTANCES: &str = "desk.connector/instances";

/// The store key of one instance's cursor: its text, or null.
pub(crate) fn cursor_key(instance: &str) -> String {
    format!("desk.connector/cursor/{instance}")
}

/// What the host knows about one instance.
#[derive(Debug, Clone)]
pub(crate) struct Instance {
    /// Its settings, without the secret ones.
    pub(crate) settings: Map<String, Value>,
    pub(crate) paused: bool,
    /// The last sync that succeeded, RFC 3339.
    pub(crate) last_sync_at: Option<String>,
    pub(crate) status: ConnectorStatus,
    /// When the scheduler syncs it next; none for a push-only connector.
    pub(crate) due: Option<SystemTime>,
    /// Failures in a row, for the backoff.
    pub(crate) failures: u32,
}

impl Instance {
    /// A new instance, due at the next tick when the connector pulls.
    pub(crate) fn new(settings: Map<String, Value>, due: Option<SystemTime>) -> Self {
        Self {
            settings,
            paused: false,
            last_sync_at: None,
            status: status(ConnectorState::Connected, None, None),
            due,
            failures: 0,
        }
    }

    /// The instance as the guest sees it: its settings with the defaults of the ones not set.
    pub(crate) fn guest(&self, name: &str, declared: Option<&Settings>) -> GuestInstance {
        let mut settings = self.settings.clone();
        for (key, setting) in declared.into_iter().flatten() {
            if let (Some(default), false) = (&setting.default, setting.secret == Some(true)) {
                settings
                    .entry(key.clone())
                    .or_insert_with(|| default.clone());
            }
        }
        GuestInstance {
            id: name.to_owned(),
            settings: Value::Object(settings).to_string(),
        }
    }

    pub(crate) fn record(&self, name: &str) -> Value {
        json!({
            "id": name,
            "settings": self.settings,
            "paused": self.paused,
            "lastSyncAt": self.last_sync_at,
        })
    }
}

/// The manifest's `instanceSettings`.
pub(crate) type Settings = BTreeMap<String, ConnectorSetting>;

/// A status in `state`, with the last sync and an error message when there is one.
pub(crate) fn status(
    state: ConnectorState,
    last_sync_at: Option<String>,
    message: Option<String>,
) -> ConnectorStatus {
    let error = message.map(|message| desk_bridge::ConnectorError {
        message,
        reauth: None,
    });
    ConnectorStatus {
        state,
        last_sync_at,
        error,
    }
}

/// The instances in a stored record list, as loaded: paused ones `paused`, ones whose last sync is
/// older than `stale_after` `stale`, the rest `connected`; all due at `due`. Entries that do not
/// read as records are skipped.
pub(crate) fn load(
    stored: Option<Value>,
    now: SystemTime,
    stale_after: Option<std::time::Duration>,
    due: Option<SystemTime>,
) -> BTreeMap<String, Instance> {
    let mut loaded = BTreeMap::new();
    let Some(Value::Array(records)) = stored else {
        return loaded;
    };
    for record in records {
        let (Some(name), Some(Value::Object(settings))) =
            (record["id"].as_str(), record.get("settings").cloned())
        else {
            continue;
        };
        let mut instance = Instance::new(settings, due);
        instance.paused = record["paused"].as_bool().unwrap_or(false);
        instance.last_sync_at = record["lastSyncAt"].as_str().map(str::to_owned);
        let synced = instance.last_sync_at.as_deref().and_then(parse_rfc3339);
        let old = |at: SystemTime| stale_after.is_some_and(|after| at + after < now);
        let state = if instance.paused {
            ConnectorState::Paused
        } else if synced.is_some_and(old) {
            ConnectorState::Stale
        } else {
            ConnectorState::Connected
        };
        instance.status = status(state, instance.last_sync_at.clone(), None);
        loaded.insert(name.to_owned(), instance);
    }
    loaded
}

/// Check an instance id: 1 to 64 of lowercase letters, digits, `_` and `-`, starting with a letter
/// or a digit (`InstanceId` in specs/item/v0).
pub(crate) fn check_id(name: &str) -> Result<(), Error> {
    let mut chars = name.chars();
    let first = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let rest = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_-".contains(c));
    if first && rest && name.len() <= 64 {
        return Ok(());
    }
    Err(invalid(format!(
        "instance id {name:?} is not 1 to 64 lowercase letters, digits, _ and -"
    )))
}

/// Check `settings` against `declared`: an object, every field declared and of its kind, every
/// required one present (or defaulted). Returns them without the secret ones, which the host
/// never stores nor hands to the guest.
pub(crate) fn check_settings(
    declared: Option<&Settings>,
    settings: &Value,
) -> Result<Map<String, Value>, Error> {
    let (no_settings, nothing) = (Settings::new(), Map::new());
    let declared = declared.unwrap_or(&no_settings);
    let given = match settings {
        Value::Object(given) => given,
        Value::Null => &nothing,
        _ => return Err(invalid("instance settings are a JSON object".into())),
    };
    let mut kept = Map::new();
    for (key, value) in given {
        let Some(setting) = declared.get(key) else {
            return Err(invalid(format!(
                "{key} is not one of the connector's settings"
            )));
        };
        let (fits, kind) = match setting.kind {
            ConnectorSettingKind::String => (value.is_string(), "a string"),
            ConnectorSettingKind::Integer => (value.is_i64() || value.is_u64(), "an integer"),
            ConnectorSettingKind::Boolean => (value.is_boolean(), "true or false"),
        };
        if !fits {
            return Err(invalid(format!("the setting {key} takes {kind}")));
        }
        if setting.secret != Some(true) {
            kept.insert(key.clone(), value.clone());
        }
    }
    for (key, setting) in declared {
        let missing = !given.contains_key(key) && setting.default.is_none();
        if setting.required == Some(true) && missing {
            return Err(invalid(format!("the setting {key} is required")));
        }
    }
    Ok(kept)
}

pub(crate) fn invalid(message: String) -> Error {
    Error {
        code: ErrorCode::InvalidParams,
        message,
    }
}
