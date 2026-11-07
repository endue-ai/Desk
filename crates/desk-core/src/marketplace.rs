//! The market for every kind without the core (specs/market/v0, ADR 0107): reading an index and a
//! bundle, which kind a manifest is, a theme market's entry as a market entry, which permissions an
//! entry adds and which an install leaves unaccepted, and the record kept beside a market install.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use desk_bridge::{
    MarketEntry, MarketIndex, MarketKind, Permission, PluginBundle, PluginKind, ThemeIndexEntry,
    ThemeIndexKind,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::manifest::schema_registry;

/// The endue index: what this repository's market folder serves. Code installs only from it.
pub const ENDUE_MARKET: &str = "https://raw.githubusercontent.com/endue-ai/Desk/main/market/";
/// Where a market install's record lives in the market folder: hidden, so never a plugin.
pub(crate) const RECORDS: &str = ".market";

/// Beside a market install, `.market/<id>.json`: where it came from and what it was granted.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Record {
    pub(crate) market: String,
    pub(crate) url: String,
    pub(crate) version: String,
    pub(crate) sha256: String,
    #[serde(default)]
    pub(crate) permissions: Vec<Permission>,
}

/// A market index's bytes as a `MarketIndex`, checked against its schema, or why not.
pub(crate) fn read_index(bytes: &[u8]) -> Result<MarketIndex, String> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|e| format!("not a market index: {e}"))?;
    if let Some(problem) = validator("MarketIndex").iter_errors(&value).next() {
        let at = problem.instance_path().to_string();
        return Err(format!("not a market index: {at}: {problem}"));
    }
    serde_json::from_value(value).map_err(|e| format!("not a market index: {e}"))
}

/// A bundle's bytes as a `PluginBundle`, checked against its schema, and its files decoded.
pub(crate) fn read_bundle(
    bytes: &[u8],
) -> Result<(PluginBundle, BTreeMap<String, Vec<u8>>), String> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|e| format!("not a .desk-plugin: {e}"))?;
    if let Some(problem) = validator("PluginBundle").iter_errors(&value).next() {
        let at = problem.instance_path().to_string();
        return Err(format!("not a .desk-plugin: {at}: {problem}"));
    }
    let bundle: PluginBundle =
        serde_json::from_value(value).map_err(|e| format!("not a .desk-plugin: {e}"))?;
    let mut files = BTreeMap::new();
    for (path, data) in &bundle.files {
        let bytes = STANDARD
            .decode(data)
            .map_err(|e| format!("{path} is not base64: {e}"))?;
        files.insert(path.clone(), bytes);
    }
    Ok((bundle, files))
}

fn validator(name: &str) -> &'static jsonschema::Validator {
    static INDEX: OnceLock<jsonschema::Validator> = OnceLock::new();
    static BUNDLE: OnceLock<jsonschema::Validator> = OnceLock::new();
    let cell = if name == "MarketIndex" {
        &INDEX
    } else {
        &BUNDLE
    };
    cell.get_or_init(|| {
        let uri = format!("https://endue.ai/specs/market/v0/market.schema.json#/$defs/{name}");
        jsonschema::options()
            .with_registry(schema_registry())
            .should_validate_formats(false)
            .build(&json!({ "$ref": uri }))
            .expect("the market schema compiles")
    })
}

/// The market kind a plugin of `kind` installs as.
pub(crate) fn kind_of(kind: PluginKind) -> MarketKind {
    match kind {
        PluginKind::Theme => MarketKind::Theme,
        PluginKind::DesignSystem => MarketKind::DesignSystem,
        PluginKind::View => MarketKind::View,
        _ => MarketKind::Plugin,
    }
}

/// A theme market's entry, its url already absolute, as a market entry.
pub(crate) fn theme_entry(theme: ThemeIndexEntry) -> MarketEntry {
    let kind = match theme.kind {
        Some(ThemeIndexKind::DesignSystem) => MarketKind::DesignSystem,
        _ => MarketKind::Theme,
    };
    MarketEntry {
        id: theme.id,
        kind,
        name: theme.name,
        version: theme.version,
        description: theme.description,
        publisher: theme.author,
        license: theme.license,
        tags: theme.tags,
        url: theme.url,
        sha256: theme.sha256,
        size: theme.size,
        permissions: None,
        engines: None,
    }
}

/// Whether an index is the endue market's (`endue` is its URL prefix).
pub(crate) fn verified(market: &str, endue: &str) -> bool {
    market.starts_with(endue)
}

/// The permissions in `asked` that `given` does not hold, in `asked`'s order.
pub(crate) fn missing(asked: &[Permission], given: &[Permission]) -> Vec<Permission> {
    let given: Vec<Value> = given.iter().map(|p| json!(p)).collect();
    asked
        .iter()
        .filter(|p| !given.contains(&json!(p)))
        .cloned()
        .collect()
}

/// One permission as a short line for a message: its name and what it names.
pub(crate) fn describe(permission: &Permission) -> String {
    let value = json!(permission);
    let name = value["permission"].as_str().unwrap_or("?").to_owned();
    let mut rest: Vec<String> = Vec::new();
    if let Some(fields) = value.as_object() {
        for (key, field) in fields.iter().filter(|(key, _)| *key != "permission") {
            rest.push(format!("{key} {field}"));
        }
    }
    if rest.is_empty() {
        name
    } else {
        format!("{name} ({})", rest.join(", "))
    }
}
