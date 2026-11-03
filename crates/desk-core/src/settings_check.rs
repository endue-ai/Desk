//! Checking a setting's value against its declaration (ADR 0080): kind, choices, minimum, maximum
//! and pattern; what the installed plugins declare for their own names, with the earlier names
//! `renamed` lists; and the layers the core resolves (manifest default < init.yaml < set value),
//! where a value that fails is skipped so the layer below shows through.

use std::collections::BTreeMap;

use desk_bridge::{PluginInfo, SettingContribution, SettingKind};
use serde_json::{Value, json};

/// One declared setting: its owner (a plugin id), its key and the declaration.
#[derive(Debug, Clone)]
pub(crate) struct Declared {
    pub owner: String,
    pub key: String,
    pub setting: SettingContribution,
}

impl Declared {
    pub fn name(&self) -> String {
        format!("{}.{}", self.owner, self.key)
    }

    /// The names a layer may hold this setting's value under, the setting's own first.
    pub fn names(&self) -> Vec<String> {
        let earlier = self.setting.renamed.iter().flatten().cloned();
        std::iter::once(self.name()).chain(earlier).collect()
    }
}

/// What the installed plugins declare, by full name.
#[derive(Debug, Default)]
pub(crate) struct Schemas {
    declared: BTreeMap<String, Declared>,
    /// An earlier full name and the full name of the setting that lists it.
    renamed: BTreeMap<String, String>,
    /// Every installed plugin's id, and whether it declares a setting.
    owners: BTreeMap<String, bool>,
}

impl Schemas {
    /// The declarations of `plugins`, enabled or not; names outside a plugin's own id are ignored.
    pub fn new(plugins: &[PluginInfo]) -> Self {
        let mut schemas = Self::default();
        for plugin in plugins {
            schemas.owners.entry(plugin.id.clone()).or_insert(false);
            let contributes = plugin
                .manifest
                .as_ref()
                .and_then(|m| m.contributes.as_ref());
            let settings = contributes.and_then(|c| c.settings.as_ref());
            let prefix = format!("{}.", plugin.id);
            for (name, setting) in settings.into_iter().flatten() {
                let Some(key) = name.strip_prefix(&prefix).filter(|key| is_key(key)) else {
                    continue;
                };
                for old in setting.renamed.iter().flatten() {
                    schemas.renamed.entry(old.clone()).or_insert(name.clone());
                }
                schemas.owners.insert(plugin.id.clone(), true);
                let declared = Declared {
                    owner: plugin.id.clone(),
                    key: key.to_owned(),
                    setting: setting.clone(),
                };
                schemas.declared.insert(name.clone(), declared);
            }
        }
        schemas
    }

    pub fn get(&self, owner: &str, key: &str) -> Option<&Declared> {
        self.declared.get(&format!("{owner}.{key}"))
    }

    pub fn named(&self, name: &str) -> Option<&Declared> {
        self.declared.get(name)
    }

    /// The setting that lists `name` as an earlier name.
    pub fn renamed_to(&self, name: &str) -> Option<&Declared> {
        self.declared.get(self.renamed.get(name)?)
    }

    pub fn all(&self) -> impl Iterator<Item = &Declared> {
        self.declared.values()
    }

    /// The installed plugin `name` belongs to (the longest id it starts with), the key after it,
    /// and whether that plugin declares any setting.
    pub fn owner_of<'a>(&self, name: &'a str) -> Option<(&str, &'a str, bool)> {
        self.owners
            .iter()
            .filter_map(|(owner, declares)| {
                let key = name.strip_prefix(owner.as_str())?.strip_prefix('.')?;
                Some((owner.as_str(), key, *declares))
            })
            .max_by_key(|(owner, _, _)| owner.len())
    }

    /// The name `owner` declares that is closest to `name` (fewest edits).
    pub fn nearest(&self, owner: &str, name: &str) -> Option<String> {
        self.declared
            .values()
            .filter(|declared| declared.owner == owner)
            .map(|declared| declared.name())
            .min_by_key(|candidate| edits(candidate, name))
    }
}

/// Why `value` fails `setting`, for people; none when it fits.
pub(crate) fn problem(setting: &SettingContribution, value: &Value) -> Option<String> {
    let shown = value.to_string();
    let kind = match setting.kind {
        SettingKind::Boolean => (value.is_boolean(), "a boolean"),
        SettingKind::Integer => (is_integer(value), "an integer"),
        SettingKind::Number => (value.is_number(), "a number"),
        SettingKind::String => (value.is_string(), "a string"),
        SettingKind::Array => (value.is_array(), "an array"),
        SettingKind::Object => (value.is_object(), "an object"),
    };
    if !kind.0 {
        return Some(format!("{shown} is not {}", kind.1));
    }
    if let (Some(text), Some(choices)) = (value.as_str(), &setting.choices)
        && !choices.iter().any(|choice| choice == text)
    {
        return Some(format!("{shown} is not one of {}", choices.join(", ")));
    }
    if let Some(number) = value.as_f64() {
        if let Some(minimum) = setting.minimum.filter(|minimum| number < *minimum) {
            return Some(format!("{shown} is below the minimum {}", plain(minimum)));
        }
        if let Some(maximum) = setting.maximum.filter(|maximum| number > *maximum) {
            return Some(format!("{shown} is above the maximum {}", plain(maximum)));
        }
    }
    if let (Some(text), Some(pattern)) = (value.as_str(), &setting.pattern)
        && let Ok(matcher) = jsonschema::validator_for(&json!({ "pattern": pattern }))
        && !matcher.is_valid(&json!(text))
    {
        return Some(format!("{shown} does not match {pattern}"));
    }
    None
}

/// The values the core's layers hold, read at once: set values by owner and key, init.yaml's by
/// full name.
pub(crate) struct Layers {
    pub schemas: Schemas,
    pub set: BTreeMap<(String, String), Value>,
    pub init: BTreeMap<String, Value>,
}

impl Layers {
    /// The value in force for `owner`'s `key`, and the earlier name it was read under: the set value,
    /// else init.yaml's, else the declared default. In each layer the setting's own name wins, then
    /// its earlier names in order; a value that fails the declaration is skipped with its layer.
    pub fn in_force(&self, owner: &str, key: &str) -> Option<(Value, Option<String>)> {
        let declared = self.schemas.get(owner, key).filter(|d| d.owner == owner);
        let names = declared.map_or_else(|| vec![format!("{owner}.{key}")], Declared::names);
        // A set value belongs to the caller that set it: under the own name only that caller's
        // counts; an earlier name is matched whole, whoever owned it then.
        let own = (owner.to_owned(), key.to_owned());
        let set = self
            .set
            .get(&own)
            .map(|value| (0, &names[0], value))
            .or_else(|| {
                let joined = |(o, k): &(String, String)| format!("{o}.{k}");
                names.iter().enumerate().skip(1).find_map(|(index, name)| {
                    let value = self.set.iter().find(|(at, _)| joined(at) == *name)?.1;
                    Some((index, name, value))
                })
            });
        let init = names
            .iter()
            .enumerate()
            .find_map(|(index, name)| self.init.get(name).map(|value| (index, name, value)));
        for (index, name, value) in [set, init].into_iter().flatten() {
            if declared.is_some_and(|d| problem(&d.setting, value).is_some()) {
                continue;
            }
            return Some((value.clone(), (index > 0).then(|| name.clone())));
        }
        declared.map(|d| (d.setting.default.clone(), None))
    }

    /// init.yaml's settings as `init.get` hands them out: each under the setting's own name when it
    /// was written under an earlier one (unless the own name is there too), and none that fails.
    pub fn init_in_force(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        for (name, value) in &self.init {
            let target = match (self.schemas.named(name), self.schemas.renamed_to(name)) {
                (Some(declared), _) => declared,
                (None, Some(declared)) if self.first_present(declared) == Some(name) => declared,
                (None, Some(_)) => continue,
                (None, None) => {
                    out.insert(name.clone(), value.clone());
                    continue;
                }
            };
            if problem(&target.setting, value).is_none() {
                out.insert(target.name(), value.clone());
            }
        }
        out
    }

    /// The first name `declared` is held under in init.yaml, its own name first.
    fn first_present(&self, declared: &Declared) -> Option<&String> {
        declared
            .names()
            .into_iter()
            .find_map(|name| self.init.get_key_value(&name).map(|(name, _)| name))
    }
}

/// A `SettingKey`: `^[a-z0-9][a-z0-9._-]{0,127}$`.
pub(crate) fn is_key(key: &str) -> bool {
    let lower = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    let mut chars = key.chars();
    key.len() <= 128
        && chars.next().is_some_and(lower)
        && chars.all(|c| lower(c) || matches!(c, '.' | '_' | '-'))
}

/// An integer as JSON Schema counts one: a number with no fraction.
fn is_integer(value: &Value) -> bool {
    value.is_i64() || value.is_u64() || value.as_f64().is_some_and(|n| n.fract() == 0.0)
}

/// A bound as people write it: 0, not 0.0.
fn plain(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{}", number as i64)
    } else {
        number.to_string()
    }
}

/// The Levenshtein distance between `a` and `b`, in characters.
fn edits(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let substitute = previous + usize::from(ca != *cb);
            previous = row[j + 1];
            row[j + 1] = substitute.min(row[j] + 1).min(previous + 1);
        }
    }
    row[b.len()]
}
