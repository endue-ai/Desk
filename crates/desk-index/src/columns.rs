//! An item as the columns of one `items` row: the key, the envelope, the whole item as JSON, the
//! common `where` fields and the normalized `*_utc` times.

use desk_bridge::{Item, ItemSource};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::time::epoch_seconds;

/// The item fields kept as epoch seconds, and their columns. `where` and `sort` on these fields
/// compare instants, whatever offset each time was written with.
pub(crate) const TIME_FIELDS: [(&str, &str); 7] = [
    ("updatedAt", "updated_at_utc"),
    ("createdAt", "created_at_utc"),
    ("start", "start_utc"),
    ("end", "end_utc"),
    ("due", "due_utc"),
    ("receivedAt", "received_at_utc"),
    ("publishedAt", "published_at_utc"),
];

/// An item's identity in the index: source and id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct Key {
    pub connector: String,
    pub instance: String,
    pub id: String,
}

impl Key {
    pub fn new(source: &ItemSource, id: &str) -> Self {
        Self {
            connector: source.connector.clone(),
            instance: source.instance.clone(),
            id: id.to_string(),
        }
    }

    pub fn source(&self) -> ItemSource {
        ItemSource {
            connector: self.connector.clone(),
            instance: self.instance.clone(),
        }
    }
}

/// One `items` row, ready to bind.
pub(crate) struct Row {
    pub key: Key,
    pub kind: String,
    pub title: String,
    pub updated_at: String,
    pub created_at: Option<String>,
    pub deep_link: Option<String>,
    pub body: Option<String>,
    pub json: String,
    pub status: Option<String>,
    pub unread: Option<bool>,
    /// In the order of `TIME_FIELDS`; `updatedAt` is always there.
    pub utc: [Option<i64>; 7],
}

/// The row of `item`. A known time field that is not an RFC 3339 time with an offset is
/// `invalid_params`: it could not be compared.
pub(crate) fn row(item: &Item) -> Result<Row> {
    let value = serde_json::to_value(item)
        .map_err(|err| Error::new(crate::ErrorCode::Internal, format!("item to JSON: {err}")))?;
    let text = |name: &str| value.get(name).and_then(Value::as_str).map(str::to_owned);
    let source = value.get("source");
    let part = |name: &str| {
        source
            .and_then(|s| s.get(name))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let key = Key {
        connector: part("connector").unwrap_or_default(),
        instance: part("instance").unwrap_or_default(),
        id: text("id").unwrap_or_default(),
    };
    if key.id.is_empty() || key.connector.is_empty() || key.instance.is_empty() {
        return Err(Error::invalid(
            "an item needs an id, a connector and an instance",
        ));
    }
    let mut utc = [None; 7];
    for (slot, (field, _)) in utc.iter_mut().zip(TIME_FIELDS) {
        if let Some(time) = value.get(field) {
            let parsed = time.as_str().and_then(epoch_seconds);
            *slot = Some(parsed.ok_or_else(|| {
                Error::invalid(format!(
                    "item {}: {field} {time} is not an RFC 3339 time with an offset",
                    key.id
                ))
            })?);
        }
    }
    Ok(Row {
        kind: text("kind").unwrap_or_default(),
        title: text("title").unwrap_or_default(),
        updated_at: text("updatedAt").unwrap_or_default(),
        created_at: text("createdAt"),
        deep_link: text("deepLink"),
        body: text("body"),
        status: text("status"),
        unread: value.get("unread").and_then(Value::as_bool),
        json: value.to_string(),
        utc,
        key,
    })
}

/// The item a row's `json` holds.
pub(crate) fn item(json: &str) -> Result<Item> {
    serde_json::from_str(json).map_err(|err| {
        Error::new(
            crate::ErrorCode::IoError,
            format!("item index: a stored item does not read back: {err}"),
        )
    })
}
