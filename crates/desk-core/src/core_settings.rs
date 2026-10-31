//! The settings side of `Core`: settings.get, settings.set and settings.list (ADR 0031). Every key
//! belongs to the caller that sets it, as in the store, and set values live in a file of their
//! own (`settings.json` in the data folder). Reading resolves three layers, lowest first: the
//! default the owner's manifest declares in `contributes.settings`, init.yaml's `settings` under
//! the owner's id (what init.get hands out), then the value the owner set. Another owner's keys
//! need a `settings:read` scope covering `owner/key`; `settings.changed` goes to the owner and to
//! the subscribers whose `settings:read` grant covers the setting.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::MutexGuard;

use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, EventName, Permission, PluginInfo, Setting,
    SettingsChangedEvent, SettingsGetParams, SettingsGetResult, SettingsListParams,
    SettingsListResult, SettingsReadPermission, SettingsSetParams, SettingsSetResult,
};
use serde_json::Value;

use crate::handler::{Answer, Core, denied, error, json};
use crate::perm::{Denied, Target, setting_match};
use crate::store::Store;

/// Settings by owner and then key, with the value in force.
type Resolved = BTreeMap<(String, String), Value>;

impl Core {
    /// Keep settings.set values in `path` (`settings.json` in the app's data folder, next to
    /// `store.json`), in the store's shape `{ owner: { key: value } }`, written on every set.
    /// Without it they last until the core goes.
    pub fn with_settings_file(self, path: PathBuf) -> Self {
        *self.set_values() = Store::new(Some(path));
        self
    }

    pub(crate) fn settings_get(&self, caller: &str, params: SettingsGetParams) -> Answer {
        valid_key(&params.key)?;
        let owner = params.owner.as_deref().unwrap_or(caller);
        if owner != caller {
            valid_owner(owner)?;
            let setting = format!("{owner}/{}", params.key);
            let Some(scope) = params.scope else {
                return Err(denied(Denied {
                    permission: Permission::SettingsRead(settings_read(vec![setting])),
                    reason: format!("{owner}'s settings need a settings:read scope"),
                }));
            };
            let scope = Permission::SettingsRead(scope);
            self.check(caller, &scope, &Target::Setting(&setting))?;
        }
        json(SettingsGetResult {
            value: self.setting_in_force(owner, &params.key),
        })
    }

    pub(crate) fn settings_set(&self, caller: &str, params: SettingsSetParams) -> Answer {
        valid_key(&params.key)?;
        self.set_values()
            .set(caller, &params.key, params.value.clone())
            .map_err(|message| error(ErrorCode::InvalidParams, message))?;
        self.settings_changed(Setting {
            owner: caller.to_owned(),
            key: params.key,
            value: params.value,
        });
        json(SettingsSetResult {})
    }

    /// The caller's own settings by key, or with a scope every setting it covers by owner and key.
    pub(crate) fn settings_list(&self, caller: &str, params: SettingsListParams) -> Answer {
        let patterns = match params.scope {
            None => None,
            Some(scope) => {
                let patterns = scope.keys.clone();
                self.check(caller, &Permission::SettingsRead(scope), &Target::None)?;
                Some(patterns)
            }
        };
        let listed = |owner: &str, key: &str| match &patterns {
            None => owner == caller,
            Some(patterns) => {
                let setting = format!("{owner}/{key}");
                patterns.iter().any(|p| setting_match(p, &setting))
            }
        };
        let settings = self
            .resolved(caller, patterns.as_deref().unwrap_or_default())
            .into_iter()
            .filter(|((owner, key), _)| listed(owner, key))
            .map(|((owner, key), value)| Setting { owner, key, value })
            .collect();
        json(SettingsListResult { settings })
    }

    /// The value in force for `owner`'s `key`: the set value, else init.yaml's `owner.key`, else
    /// the default `owner`'s manifest declares; none when no layer has one.
    fn setting_in_force(&self, owner: &str, key: &str) -> Option<Value> {
        if let Some(value) = self.set_values().get(owner, key) {
            return Some(value);
        }
        let name = format!("{owner}.{key}");
        if let Some(value) = self.init().settings.remove(&name) {
            return Some(value);
        }
        let plugin = self.plugins().into_iter().find(|p| p.id == owner)?;
        defaults(&plugin)
            .find(|(key_of, _)| *key_of == key)
            .map(|(_, value)| value.clone())
    }

    /// Every setting some layer holds, layered as `setting_in_force` does. An init.yaml name goes
    /// to the longest owner it starts with among the known ones: installed plugins, owners of set
    /// values, `desk`, the caller and owners the `patterns` name without a `*`; one with no known
    /// owner is left out.
    fn resolved(&self, caller: &str, patterns: &[String]) -> Resolved {
        let plugins = self.plugins();
        let set_values: Vec<(String, String, Value)> = self
            .set_values()
            .all()
            .map(|(owner, key, value)| (owner.to_owned(), key.to_owned(), value.clone()))
            .collect();
        let mut known: BTreeSet<&str> = BTreeSet::from(["desk", caller]);
        known.extend(plugins.iter().map(|p| p.id.as_str()));
        known.extend(set_values.iter().map(|(owner, _, _)| owner.as_str()));
        known.extend(
            patterns
                .iter()
                .filter_map(|p| p.split_once('/').map(|(owner, _)| owner))
                .filter(|owner| !owner.contains('*')),
        );

        let mut resolved = Resolved::new();
        for plugin in &plugins {
            for (key, value) in defaults(plugin) {
                resolved.insert((plugin.id.clone(), key.to_owned()), value.clone());
            }
        }
        for (name, value) in self.init().settings {
            if let Some((owner, key)) = attribute(&name, &known) {
                resolved.insert((owner.to_owned(), key.to_owned()), value);
            }
        }
        for (owner, key, value) in set_values {
            resolved.insert((owner, key), value);
        }
        resolved
    }

    /// `settings.changed` for the owner and the subscribers whose settings:read grant covers it.
    fn settings_changed(&self, setting: Setting) {
        let target = format!("{}/{}", setting.owner, setting.key);
        let scope = Permission::SettingsRead(settings_read(vec![target.clone()]));
        let subscribed = self.recipients(EventName::SettingsChanged, Vec::new());
        let mut to: Vec<String> = {
            let permissions = self.permissions();
            let covered = |caller: &String| {
                let allowed = permissions.authorize(caller, &scope, &Target::Setting(&target));
                allowed.is_ok()
            };
            subscribed.into_iter().filter(covered).collect()
        };
        to.push(setting.owner.clone());
        self.events().publish_to(
            to,
            BridgeEvent::SettingsChanged(SettingsChangedEvent {
                event: Default::default(),
                data: setting,
            }),
        );
    }

    fn set_values(&self) -> MutexGuard<'_, Store> {
        self.settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The defaults a plugin's manifest declares for its own keys, as (key, default). Names outside
/// the plugin's own id are ignored, as the runtime does.
fn defaults(plugin: &PluginInfo) -> impl Iterator<Item = (&str, &Value)> {
    let prefix = format!("{}.", plugin.id);
    let declared = plugin
        .manifest
        .as_ref()
        .and_then(|m| m.contributes.as_ref());
    let settings = declared.and_then(|c| c.settings.as_ref());
    settings
        .into_iter()
        .flatten()
        .filter_map(move |(name, setting)| {
            let key = name.strip_prefix(&prefix)?;
            valid_key(key).ok()?;
            Some((key, &setting.default))
        })
}

/// The longest known owner `name` starts with (`owner.key`), and the key after it.
fn attribute<'a>(name: &'a str, known: &BTreeSet<&'a str>) -> Option<(&'a str, &'a str)> {
    known
        .iter()
        .filter_map(|owner| {
            let key = name.strip_prefix(owner)?.strip_prefix('.')?;
            valid_key(key).ok().map(|()| (*owner, key))
        })
        .max_by_key(|(owner, _)| owner.len())
}

fn settings_read(keys: Vec<String>) -> SettingsReadPermission {
    SettingsReadPermission {
        permission: Default::default(),
        keys,
    }
}

/// A `SettingKey`: `^[a-z0-9][a-z0-9._-]{0,127}$`.
fn valid_key(key: &str) -> Result<(), BridgeError> {
    let lower = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    let mut chars = key.chars();
    let valid = key.len() <= 128
        && chars.next().is_some_and(lower)
        && chars.all(|c| lower(c) || matches!(c, '.' | '_' | '-'));
    valid.then_some(()).ok_or_else(|| {
        error(
            ErrorCode::InvalidParams,
            format!("{key:?} is not a setting key (lowercase, dotted, at most 128 characters)"),
        )
    })
}

/// A `CallerId`: dotted segments of `[a-z][a-z0-9-]*`, at most 128 characters.
fn valid_owner(owner: &str) -> Result<(), BridgeError> {
    let segment = |s: &str| {
        let mut chars = s.chars();
        chars.next().is_some_and(|c| c.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    let valid = owner.len() <= 128 && owner.split('.').all(segment);
    valid.then_some(()).ok_or_else(|| {
        error(
            ErrorCode::InvalidParams,
            format!("{owner:?} is not a caller"),
        )
    })
}
