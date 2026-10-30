//! Limits per source: a size cap (oldest updatedAt first) and a retention period; counts per source.

mod common;

use std::sync::mpsc::TryRecvError;

use common::*;
use desk_index::Limits;
use serde_json::json;

#[test]
fn a_source_over_its_cap_loses_its_oldest_items_first() {
    let index = open("retention-cap");
    let (a, b) = (source("desk.fixtures"), source("desk.fixtures/work"));
    assert_eq!(
        index.limits(&a),
        Limits {
            max_items: 50_000,
            keep_days: None
        }
    );
    index.set_limits(
        &a,
        Limits {
            max_items: 3,
            keep_days: None,
        },
    );
    assert_eq!(index.limits(&a).max_items, 3);
    assert_eq!(index.limits(&b), Limits::default());

    let changes = index
        .subscribe(
            &query(json!({ "sources": ["desk.fixtures/default"] })),
            &all(),
        )
        .unwrap();
    let day = |d: u32| format!("2026-10-{d:02}T09:00:00Z");
    let a_items: Vec<_> = [3, 1, 5, 2, 4]
        .iter()
        .map(|d| task("desk.fixtures", &format!("a{d}"), "A", &day(*d)))
        .collect();
    let b_items: Vec<_> = (1..=5)
        .map(|d| task("desk.fixtures/work", &format!("b{d}"), "B", &day(d)))
        .collect();
    index.upsert(&[a_items.clone(), b_items].concat()).unwrap();
    assert_eq!(
        ids_of(&index, json!({ "sources": ["desk.fixtures/default"] })),
        ["a5", "a4", "a3"]
    );
    assert_eq!(
        ids_of(&index, json!({ "sources": ["desk.fixtures/work"] })).len(),
        5
    );
    // a1 and a2 came and went in the same write: the subscriber never hears of them.
    let kept: Vec<_> = [&a_items[0], &a_items[2], &a_items[4]]
        .into_iter()
        .map(upserted)
        .collect();
    assert_eq!(changes.try_recv().unwrap(), kept);

    // A newer item pushes the oldest out, in the same batch.
    let a6 = task("desk.fixtures", "a6", "A", &day(6));
    index.upsert(&[a6.clone()]).unwrap();
    assert_eq!(
        changes.try_recv().unwrap(),
        [upserted(&a6), removed("desk.fixtures", "a3")]
    );
    // An item older than every kept one goes at once.
    index
        .upsert(&[task("desk.fixtures", "a0", "A", &day(1))])
        .unwrap();
    assert_eq!(
        ids_of(&index, json!({ "sources": ["desk.fixtures/default"] })),
        ["a6", "a5", "a4"]
    );
    assert_eq!(changes.try_recv(), Err(TryRecvError::Empty));

    // keep_days drops what was not updated for that long.
    let feeds = source("desk.fixtures/feeds");
    index.set_limits(
        &feeds,
        Limits {
            max_items: 50_000,
            keep_days: Some(30),
        },
    );
    index
        .upsert(&[
            task("desk.fixtures/feeds", "old", "Old", "2000-01-01T00:00:00Z"),
            task(
                "desk.fixtures/feeds",
                "fresh",
                "Fresh",
                "2999-01-01T00:00:00Z",
            ),
        ])
        .unwrap();
    assert_eq!(
        ids_of(&index, json!({ "sources": ["desk.fixtures/feeds"] })),
        ["fresh"]
    );
}

#[test]
fn counts_report_items_per_source() {
    let index = open("retention-counts");
    assert_eq!(index.counts().unwrap(), []);
    let t = "2026-10-30T09:00:00Z";
    index
        .upsert(&[
            task("other.app", "o1", "Other", t),
            task("desk.fixtures/work", "w1", "Work", t),
            task("desk.fixtures", "d1", "Desk", t),
            task("desk.fixtures/work", "w2", "Work", t),
            task("desk.fixtures", "d2", "Desk", t),
            task("desk.fixtures/work", "w3", "Work", t),
        ])
        .unwrap();
    assert_eq!(
        index.counts().unwrap(),
        [
            (source("desk.fixtures"), 2),
            (source("desk.fixtures/work"), 3),
            (source("other.app"), 1),
        ]
    );
    index.clear(&source("desk.fixtures/work")).unwrap();
    assert_eq!(
        index.counts().unwrap(),
        [(source("desk.fixtures"), 2), (source("other.app"), 1)]
    );
}
