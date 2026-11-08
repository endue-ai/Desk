//! The schema is versioned in `PRAGMA user_version` and migrates forward; `rebuild` repairs the
//! full-text table.

mod common;

use std::path::Path;

use common::*;
use desk_index::{ErrorCode, Index, SCHEMA_VERSION};
use rusqlite::Connection;
use serde_json::json;

fn user_version(path: &Path) -> u32 {
    let conn = Connection::open(path).unwrap();
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

#[test]
fn an_index_file_at_schema_version_1_opens_and_the_version_is_recorded() {
    assert_eq!(SCHEMA_VERSION, 1);
    // A new file is created at the current version.
    let path = temp_path("migrate-new");
    {
        let index = Index::open(&path).unwrap();
        index
            .upsert(&[task(
                "desk.fixtures",
                "t1",
                "Pay rent",
                "2026-10-30T09:00:00Z",
            )])
            .unwrap();
    }
    assert_eq!(user_version(&path), SCHEMA_VERSION);
    let index = Index::open(&path).unwrap();
    assert_eq!(ids_of(&index, json!({ "text": "rent" })), ["t1"]);

    // A file schema version 1 wrote opens with its items, its text and its version.
    let path = temp_path("migrate-v1");
    Connection::open(&path)
        .unwrap()
        .execute_batch(include_str!("fixtures/schema-v1.sql"))
        .unwrap();
    let index = Index::open(&path).unwrap();
    assert_eq!(user_version(&path), SCHEMA_VERSION);
    let t1 = index
        .get(&source("desk.fixtures"), "t1", &all())
        .unwrap()
        .unwrap();
    assert_eq!(field(&t1, "due"), "2026-11-01T00:00:00Z");
    assert_eq!(ids_of(&index, json!({ "text": "rent" })), ["t1"]);
    let due =
        json!({ "where": [{ "field": "due", "op": "eq", "value": "2026-11-01T09:00:00+09:00" }] });
    assert_eq!(ids_of(&index, due), ["t1"]);
    index
        .upsert(&[task(
            "desk.fixtures",
            "t2",
            "Water plants",
            "2026-10-30T10:00:00Z",
        )])
        .unwrap();
    assert_eq!(ids_of(&index, json!({})), ["t2", "t1"]);

    // A file a newer desk wrote is refused and left as it is.
    let path = temp_path("migrate-newer");
    Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 99)
        .unwrap();
    let err = Index::open(&path).err().expect("a newer schema is refused");
    assert_eq!(err.code, ErrorCode::Unsupported);
    assert!(err.message.contains("99"), "{}", err.message);
    assert_eq!(user_version(&path), 99);
}

#[test]
fn rebuild_recreates_the_full_text_table_and_keeps_every_item() {
    let path = temp_path("migrate-rebuild");
    let index = Index::open(&path).unwrap();
    index
        .upsert(&[
            task("desk.fixtures", "t1", "Pay rent", "2026-10-30T09:00:00Z"),
            task(
                "desk.fixtures",
                "t2",
                "Water plants",
                "2026-10-30T10:00:00Z",
            ),
            note(
                "desk.fixtures",
                "n1",
                "Ideas",
                "2026-10-30T11:00:00Z",
                "rent a bike",
            ),
        ])
        .unwrap();
    drop(index);
    Connection::open(&path)
        .unwrap()
        .execute_batch("DROP TABLE items_fts;")
        .unwrap();

    let index = Index::open(&path).unwrap();
    let err = index
        .query(&query(json!({ "text": "rent" })), &all())
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::IoError);
    index.rebuild().unwrap();
    assert_eq!(ids_of(&index, json!({ "text": "rent" })), ["n1", "t1"]);
    assert_eq!(index.count(&query(json!({})), &all()).unwrap(), 3);
    // Writes keep the rebuilt table current, and a rebuild of a sound index changes nothing.
    index
        .upsert(&[task(
            "desk.fixtures",
            "t3",
            "Plant tulips",
            "2026-10-30T12:00:00Z",
        )])
        .unwrap();
    index.remove(&source("desk.fixtures"), ["t2"]).unwrap();
    index.rebuild().unwrap();
    assert_eq!(ids_of(&index, json!({ "text": "plant" })), ["t3"]);
    assert_eq!(ids_of(&index, json!({})), ["t3", "n1", "t1"]);
}
