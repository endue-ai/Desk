//! `Index::subscribe`: one batch of changes per write, only those the query and the scope cover.

mod common;

use std::sync::mpsc::TryRecvError;

use common::*;
use desk_index::DataReadScope;
use serde_json::json;

const T: &str = "2026-10-30T09:00:00Z";

#[test]
fn a_subscriber_hears_batched_changes_matching_its_query_and_scope() {
    let index = open("subscribe-batch");
    let changes = index
        .subscribe(&query(json!({ "kinds": ["task"] })), &all())
        .unwrap();
    let tasks = [
        task("desk.fixtures", "t1", "Pay rent", T),
        task("desk.fixtures", "t2", "Water plants", T),
        task("desk.fixtures", "t3", "Call mum", T),
    ];
    index.upsert(&tasks).unwrap();
    let batch = changes.try_recv().unwrap();
    assert_eq!(batch, tasks.iter().map(upserted).collect::<Vec<_>>());
    assert_eq!(changes.try_recv(), Err(TryRecvError::Empty));

    index.remove(&source("desk.fixtures"), ["t2"]).unwrap();
    assert_eq!(
        changes.try_recv().unwrap(),
        [removed("desk.fixtures", "t2")]
    );
    index.clear(&source("desk.fixtures")).unwrap();
    assert_eq!(
        changes.try_recv().unwrap(),
        [
            removed("desk.fixtures", "t1"),
            removed("desk.fixtures", "t3")
        ]
    );
    assert_eq!(changes.try_recv(), Err(TryRecvError::Empty));
}

#[test]
fn changes_outside_the_query_or_scope_are_not_delivered() {
    let index = open("subscribe-outside");
    let scope = DataReadScope {
        kinds: None,
        sources: Some(vec!["desk.*".into()]),
    };
    let q = query(json!({
        "kinds": ["task"],
        "text": "invoice",
        "where": [{ "field": "status", "op": "eq", "value": "open" }],
    }));
    let changes = index.subscribe(&q, &scope).unwrap();
    index
        .upsert(&[
            note("desk.fixtures", "n1", "Invoice notes", T, "invoice"),
            task("other.app", "o1", "Pay the invoice", T),
            task("desk.fixtures", "t1", "Pay rent", T),
            task_with(
                "desk.fixtures",
                "t2",
                "Send the invoice",
                T,
                json!({ "status": "done" }),
            ),
        ])
        .unwrap();
    index.remove(&source("other.app"), ["o1"]).unwrap();
    index.clear(&source("desk.fixtures")).unwrap();
    assert_eq!(changes.try_recv(), Err(TryRecvError::Empty));

    let hit = task("desk.mail", "m1", "Invoice 42", T);
    index
        .upsert(&[hit.clone(), task("other.app", "o2", "Invoice", T)])
        .unwrap();
    assert_eq!(changes.try_recv().unwrap(), [upserted(&hit)]);
    assert_eq!(changes.try_recv(), Err(TryRecvError::Empty));
}

#[test]
fn an_item_that_leaves_the_query_is_delivered_as_removed() {
    let index = open("subscribe-leave");
    let q = query(json!({ "where": [{ "field": "status", "op": "eq", "value": "open" }] }));
    let changes = index.subscribe(&q, &all()).unwrap();
    let open = task("desk.fixtures", "t1", "Pay rent", T);
    index.upsert(&[open.clone()]).unwrap();
    assert_eq!(changes.try_recv().unwrap(), [upserted(&open)]);

    let done = task_with(
        "desk.fixtures",
        "t1",
        "Pay rent",
        T,
        json!({ "status": "done" }),
    );
    index.upsert(&[done.clone()]).unwrap();
    assert_eq!(
        changes.try_recv().unwrap(),
        [removed("desk.fixtures", "t1")]
    );
    index.upsert(&[done]).unwrap();
    assert_eq!(changes.try_recv(), Err(TryRecvError::Empty));
}

#[test]
fn dropping_the_receiver_ends_the_subscription() {
    let index = open("subscribe-drop");
    let kept = index.subscribe(&query(json!({})), &all()).unwrap();
    let gone = index.subscribe(&query(json!({})), &all()).unwrap();
    assert_eq!(index.subscription_count(), 2);
    drop(gone);
    index
        .upsert(&[task("desk.fixtures", "t1", "Pay rent", T)])
        .unwrap();
    assert_eq!(index.subscription_count(), 1);
    assert_eq!(kept.try_recv().unwrap().len(), 1);
    drop(kept);
    index.remove(&source("desk.fixtures"), ["t1"]).unwrap();
    assert_eq!(index.subscription_count(), 0);
}
