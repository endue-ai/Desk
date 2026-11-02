//! A script's answers as the WIT types the imports return, and the names the WIT values have on
//! the bridge. A result that does not fit its method is a problem with the script, which fails the
//! test with what the method takes.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::bindings::{Command, CommandInfo, Decision, DirEntry, Duration, EntryKind, ErrorCode};
use crate::bindings::{Grant, LogEntry, LogLevel, NotifyLevel, Response, Setting};

/// A bridge error code (specs/bridge/v0), as the script writes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Code {
    PermissionDenied,
    InvalidParams,
    NotFound,
    AlreadyExists,
    IoError,
    Timeout,
    Cancelled,
    Unsupported,
    Internal,
}

impl Code {
    pub(super) fn wit(self) -> ErrorCode {
        match self {
            Self::PermissionDenied => ErrorCode::PermissionDenied,
            Self::InvalidParams => ErrorCode::InvalidParams,
            Self::NotFound => ErrorCode::NotFound,
            Self::AlreadyExists => ErrorCode::AlreadyExists,
            Self::IoError => ErrorCode::IoError,
            Self::Timeout => ErrorCode::Timeout,
            Self::Cancelled => ErrorCode::Cancelled,
            Self::Unsupported => ErrorCode::Unsupported,
            Self::Internal => ErrorCode::Internal,
        }
    }
}

/// `value` read as `T`, or why not (`takes` says what the method takes).
fn shape<T: DeserializeOwned>(value: Value, takes: &str) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| format!("it takes {takes} ({e})"))
}

/// fs.read: the file's text.
pub(super) fn bytes(value: Value) -> Result<Vec<u8>, String> {
    shape::<String>(value, "the file's text").map(String::into_bytes)
}

/// cmd.invoke, events.subscribe: an id.
pub(super) fn id(value: Value) -> Result<String, String> {
    shape(value, "an id string")
}

/// fs.write: the bytes written.
pub(super) fn count(value: Value) -> Result<u64, String> {
    shape(value, "a byte count")
}

/// store.get, settings.get: any JSON value; `null` is never set.
pub(super) fn optional(value: Value) -> Result<Option<Value>, String> {
    Ok(Some(value).filter(|value| !value.is_null()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    name: String,
    kind: Kind,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    modified_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    File,
    Dir,
    Symlink,
}

/// fs.list: `[{ name, kind, size?, modifiedAt? }]`.
pub(super) fn entries(value: Value) -> Result<Vec<DirEntry>, String> {
    let entries: Vec<Entry> = shape(value, "[{ name, kind, size?, modifiedAt? }]")?;
    let entry = |e: Entry| DirEntry {
        name: e.name,
        kind: match e.kind {
            Kind::File => EntryKind::File,
            Kind::Dir => EntryKind::Dir,
            Kind::Symlink => EntryKind::Symlink,
        },
        size: e.size,
        modified_at: e.modified_at,
    };
    Ok(entries.into_iter().map(entry).collect())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fetched {
    status: u16,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: String,
}

/// net.fetch: `{ status, headers?, body? }`, headers by name and the body as text.
pub(super) fn response(value: Value) -> Result<Response, String> {
    let fetched: Fetched = shape(value, "{ status, headers?, body? }")?;
    Ok(Response {
        status: fetched.status,
        headers: fetched.headers.into_iter().collect(),
        body: fetched.body.into_bytes(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GivenGrant {
    grant_id: String,
    permission: Value,
}

impl From<GivenGrant> for Grant {
    fn from(grant: GivenGrant) -> Self {
        Self {
            grant_id: grant.grant_id,
            permission: grant.permission.to_string(),
        }
    }
}

/// perm.query: `[{ grantId, permission }]`.
pub(super) fn grants(value: Value) -> Result<Vec<Grant>, String> {
    let grants: Vec<GivenGrant> = shape(value, "[{ grantId, permission }]")?;
    Ok(grants.into_iter().map(Grant::from).collect())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Decided {
    granted: bool,
    #[serde(default)]
    grant: Option<GivenGrant>,
}

/// perm.request: `{ granted, grant? }`.
pub(super) fn decision(value: Value) -> Result<Decision, String> {
    let decided: Decided = shape(value, "{ granted, grant?: { grantId, permission } }")?;
    Ok(Decision {
        granted: decided.granted,
        grant: decided.grant.map(Grant::from),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Listed {
    id: String,
    title: String,
    provider: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    keywords: Vec<String>,
}

/// cmd.list: `[{ id, title, provider, description?, keywords? }]`.
pub(super) fn commands(value: Value) -> Result<Vec<CommandInfo>, String> {
    let listed: Vec<Listed> = shape(value, "[{ id, title, provider, description?, keywords? }]")?;
    let info = |c: Listed| CommandInfo {
        command: Command {
            id: c.id,
            title: c.title,
            description: c.description,
            keywords: c.keywords,
            args_schema: None,
            when: None,
        },
        provider: c.provider,
    };
    Ok(listed.into_iter().map(info).collect())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GivenSetting {
    owner: String,
    key: String,
    value: Value,
}

/// settings.list: `[{ owner, key, value }]`.
pub(super) fn settings(value: Value) -> Result<Vec<Setting>, String> {
    let given: Vec<GivenSetting> = shape(value, "[{ owner, key, value }]")?;
    let setting = |s: GivenSetting| Setting {
        owner: s.owner,
        key: s.key,
        value: s.value.to_string(),
    };
    Ok(given.into_iter().map(setting).collect())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    at: String,
    channel: String,
    level: String,
    message: String,
    #[serde(default)]
    fields: Option<Value>,
}

/// log.tail: `[{ at, channel, level, message, fields? }]`.
pub(super) fn lines(value: Value) -> Result<Vec<LogEntry>, String> {
    let takes = "[{ at, channel, level, message, fields? }]";
    let lines: Vec<Line> = shape(value, takes)?;
    let entry = |line: Line| {
        let level = match line.level.as_str() {
            "debug" => LogLevel::Debug,
            "info" => LogLevel::Info,
            "warn" => LogLevel::Warn,
            "error" => LogLevel::Error,
            other => return Err(format!("it takes {takes} (level {other})")),
        };
        Ok(LogEntry {
            at: line.at,
            channel: line.channel,
            level,
            message: line.message,
            fields: line.fields.map(|fields| fields.to_string()),
        })
    };
    lines.into_iter().map(entry).collect()
}

pub(super) fn level(level: LogLevel) -> &'static str {
    match level {
        LogLevel::Debug => "debug",
        LogLevel::Info => "info",
        LogLevel::Warn => "warn",
        LogLevel::Error => "error",
    }
}

pub(super) fn notify_level(level: NotifyLevel) -> &'static str {
    match level {
        NotifyLevel::Info => "info",
        NotifyLevel::Success => "success",
        NotifyLevel::Warning => "warning",
        NotifyLevel::Error => "error",
    }
}

pub(super) fn duration(duration: Duration) -> &'static str {
    match duration {
        Duration::Once => "once",
        Duration::Session => "session",
        Duration::Always => "always",
    }
}
