//! Helpers the acceptance tests share: a fresh index file, items and queries from JSON.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{
    Item, ItemChange, ItemPage, ItemQuery, ItemRemoved, ItemRemovedChange, ItemSource,
    ItemUpserted, ItemUpsertedChange,
};
use desk_index::{DataReadScope, Index};
use serde_json::{Value, json};

/// A path for a new index file in a folder of its own.
pub fn temp_path(name: &str) -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    let dir = std::env::temp_dir().join(format!(
        "desk-index-{name}-{}-{n}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("index.sqlite")
}

pub fn open(name: &str) -> Index {
    Index::open(temp_path(name)).unwrap()
}

/// 2026-10-`day` at `hour`:00Z.
pub fn at(day: u32, hour: u32) -> String {
    format!("2026-10-{day:02}T{hour:02}:00:00Z")
}

/// 2026-10-`day` at 09:00Z.
pub fn day(day: u32) -> String {
    at(day, 9)
}

pub fn all() -> DataReadScope {
    DataReadScope::all()
}

/// `connector` or `connector/instance` (instance `default`).
pub fn source(selector: &str) -> ItemSource {
    let (connector, instance) = selector.split_once('/').unwrap_or((selector, "default"));
    ItemSource {
        connector: connector.into(),
        instance: instance.into(),
    }
}

pub fn item(value: Value) -> Item {
    serde_json::from_value(value).unwrap()
}

pub fn query(value: Value) -> ItemQuery {
    serde_json::from_value(value).unwrap()
}

fn envelope(kind: &str, src: &str, id: &str, title: &str, updated: &str, extra: Value) -> Item {
    let src = source(src);
    let mut value = json!({
        "id": id,
        "source": { "connector": src.connector, "instance": src.instance },
        "kind": kind,
        "title": title,
        "updatedAt": updated,
    });
    let fields = value.as_object_mut().unwrap();
    for (key, field) in extra.as_object().unwrap() {
        fields.insert(key.clone(), field.clone());
    }
    item(value)
}

/// An open task; `extra` adds or replaces fields.
pub fn task_with(src: &str, id: &str, title: &str, updated: &str, extra: Value) -> Item {
    let mut fields = json!({ "status": "open" });
    for (key, field) in extra.as_object().unwrap() {
        fields[key] = field.clone();
    }
    envelope("task", src, id, title, updated, fields)
}

pub fn task(src: &str, id: &str, title: &str, updated: &str) -> Item {
    task_with(src, id, title, updated, json!({}))
}

pub fn note(src: &str, id: &str, title: &str, updated: &str, body: &str) -> Item {
    envelope("note", src, id, title, updated, json!({ "body": body }))
}

pub fn event(src: &str, id: &str, title: &str, updated: &str, start: &str) -> Item {
    envelope(
        "event",
        src,
        id,
        title,
        updated,
        json!({ "start": start, "end": start }),
    )
}

pub fn message(src: &str, id: &str, title: &str, updated: &str) -> Item {
    envelope(
        "message",
        src,
        id,
        title,
        updated,
        json!({ "from": { "email": "a@example.com" }, "receivedAt": updated, "unread": true }),
    )
}

pub fn field(item: &Item, name: &str) -> Value {
    serde_json::to_value(item).unwrap()[name].clone()
}

pub fn id_of(item: &Item) -> String {
    field(item, "id").as_str().unwrap().to_string()
}

pub fn ids(page: &ItemPage) -> Vec<String> {
    page.items.iter().map(id_of).collect()
}

/// The ids `query` answers over the whole index, joined by spaces.
pub fn found(index: &Index, value: Value) -> String {
    ids_of(index, value).join(" ")
}

/// The ids `query` answers over the whole index.
pub fn ids_of(index: &Index, value: Value) -> Vec<String> {
    ids(&index.query(&query(value), &all()).unwrap())
}

pub fn upserted(item: &Item) -> ItemChange {
    ItemChange::ItemUpserted(ItemUpserted {
        change: ItemUpsertedChange::Upserted,
        item: item.clone(),
    })
}

pub fn removed(src: &str, id: &str) -> ItemChange {
    ItemChange::ItemRemoved(ItemRemoved {
        change: ItemRemovedChange::Removed,
        source: source(src),
        id: id.into(),
    })
}
