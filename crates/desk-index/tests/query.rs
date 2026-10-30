//! `Index::query`: kinds, sources, text, where, sort, the cursor and the caller's data:read scope.

mod common;

use common::*;
use desk_bridge::DataReadPermission;
use desk_index::{DataReadScope, ErrorCode};
use serde_json::{Value, json};

#[test]
fn upserted_items_come_back_by_kind_source_text_and_where_in_sort_order() {
    let index = open("query-basic");
    let t1 = task_with(
        "desk.fixtures",
        "t1",
        "Pay rent",
        "2026-10-28T09:00:00Z",
        json!({ "due": "2026-11-01T00:00:00Z" }),
    );
    index
        .upsert(&[
            t1.clone(),
            task_with(
                "desk.fixtures/work",
                "t2",
                "Send the budget",
                "2026-10-29T09:00:00Z",
                json!({ "due": "2026-10-31T00:00:00Z" }),
            ),
            task_with(
                "other.app",
                "t3",
                "Book flights",
                "2026-10-30T09:00:00Z",
                json!({ "status": "done" }),
            ),
            note(
                "desk.fixtures",
                "n1",
                "Ideas",
                "2026-10-30T10:00:00Z",
                "the budget for next year",
            ),
            event(
                "desk.fixtures",
                "e1",
                "Standup",
                "2026-10-27T09:00:00Z",
                "2026-10-30T09:00:00Z",
            ),
        ])
        .unwrap();

    // Kinds, newest updatedAt first when sort is absent; the item comes back as it went in.
    let page = index
        .query(&query(json!({ "kinds": ["task"] })), &all())
        .unwrap();
    assert_eq!(ids(&page), ["t3", "t2", "t1"]);
    assert_eq!(page.items[2], t1);
    assert_eq!(page.cursor, None);
    // A connector id covers every instance of it; connector/instance covers one.
    assert_eq!(
        ids_of(&index, json!({ "sources": ["desk.fixtures"] })),
        ["n1", "t2", "t1", "e1"]
    );
    assert_eq!(
        ids_of(&index, json!({ "sources": ["desk.fixtures/work"] })),
        ["t2"]
    );
    assert_eq!(
        ids_of(
            &index,
            json!({ "sources": ["other.app", "desk.fixtures/work"] })
        ),
        ["t3", "t2"]
    );
    // Text through the full-text table over title and body: words and prefixes, all of them.
    assert_eq!(ids_of(&index, json!({ "text": "budget" })), ["n1", "t2"]);
    assert_eq!(ids_of(&index, json!({ "text": "BUDG" })), ["n1", "t2"]);
    assert_eq!(ids_of(&index, json!({ "text": "budget send" })), ["t2"]);
    assert_eq!(
        ids_of(&index, json!({ "text": "\"unbalanced" })),
        Vec::<String>::new()
    );
    // Where and sort.
    let open_by_due = json!({
        "kinds": ["task"],
        "where": [{ "field": "status", "op": "eq", "value": "open" }],
        "sort": [{ "field": "due", "dir": "asc" }],
    });
    assert_eq!(ids_of(&index, open_by_due), ["t2", "t1"]);
    let by_title = json!({ "sort": [{ "field": "title", "dir": "asc" }] });
    assert_eq!(ids_of(&index, by_title), ["t3", "n1", "t1", "t2", "e1"]);
    // An upsert replaces the item with the same source and id.
    index
        .upsert(&[task_with(
            "desk.fixtures",
            "t1",
            "Pay the rent",
            "2026-10-31T09:00:00Z",
            json!({ "status": "done" }),
        )])
        .unwrap();
    assert_eq!(
        ids_of(&index, json!({ "kinds": ["task"] })),
        ["t1", "t3", "t2"]
    );
    assert_eq!(ids_of(&index, json!({ "text": "rent" })), ["t1"]);
    assert_eq!(index.count(&query(json!({})), &all()).unwrap(), 5);
}

#[test]
fn paging_with_a_cursor_is_stable_and_never_repeats_or_skips_an_item() {
    let index = open("query-paging");
    let same = "2026-10-30T09:00:00Z";
    let tasks: Vec<_> = ["g", "a", "e", "c", "b", "f", "d"]
        .iter()
        .map(|id| task("desk.fixtures", id, "Same time", same))
        .collect();
    index.upsert(&tasks).unwrap();

    let mut q = query(json!({ "kinds": ["task"], "limit": 3 }));
    let first = index.query(&q, &all()).unwrap();
    assert_eq!(ids(&first), ["a", "b", "c"]);
    // An item that sorts before the cursor and an update to one already seen do not shift the next page.
    index
        .upsert(&[
            task("desk.fixtures", "0", "Same time", same),
            task("desk.fixtures", "a", "Renamed", same),
        ])
        .unwrap();
    q.cursor = first.cursor.clone();
    assert!(q.cursor.is_some());
    let second = index.query(&q, &all()).unwrap();
    assert_eq!(ids(&second), ["d", "e", "f"]);
    q.cursor = second.cursor.clone();
    let last = index.query(&q, &all()).unwrap();
    assert_eq!(ids(&last), ["g"]);
    assert_eq!(last.cursor, None);

    // Paging through two at a time, both directions, gives every item exactly once.
    for dir in ["asc", "desc"] {
        let mut q = query(json!({ "sort": [{ "field": "updatedAt", "dir": dir }], "limit": 2 }));
        let mut seen = Vec::new();
        loop {
            let page = index.query(&q, &all()).unwrap();
            seen.extend(ids(&page));
            match page.cursor {
                Some(cursor) => q.cursor = Some(cursor),
                None => break,
            }
        }
        assert_eq!(seen, ["0", "a", "b", "c", "d", "e", "f", "g"], "{dir}");
    }
}

#[test]
fn a_data_read_scope_filters_kinds_and_sources_inside_the_page() {
    let index = open("query-scope");
    let mut items = Vec::new();
    // The newest items are the ones the scope does not cover: a filter after paging would leave the
    // page short.
    for i in 0..8 {
        items.push(task("other.app", &format!("o{i}"), "Other", &at(30, i)));
        items.push(event(
            "desk.fixtures",
            &format!("e{i}"),
            "Event",
            &at(30, i),
            &at(30, i),
        ));
        items.push(task(
            "example.desk",
            &format!("x{i}"),
            "Prefix only",
            &at(30, i),
        ));
    }
    for i in 0..6 {
        items.push(task("desk.fixtures", &format!("d{i}"), "Desk", &at(20, i)));
    }
    for i in 0..4 {
        items.push(task("desk.mail", &format!("m{i}"), "Mail", &at(10, i)));
    }
    index.upsert(&items).unwrap();

    let perm: DataReadPermission = serde_json::from_value(json!({
        "permission": "data:read", "kinds": ["task"], "sources": ["desk.*"],
    }))
    .unwrap();
    let scope = DataReadScope::from(&perm);
    let mut q = query(json!({ "limit": 5 }));
    let page = index.query(&q, &scope).unwrap();
    assert_eq!(page.items.len(), 5);
    for item in &page.items {
        assert_eq!(field(item, "kind"), "task");
        let connector = field(item, "source")["connector"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(connector.starts_with("desk."), "{connector}");
    }
    assert_eq!(index.count(&q, &scope).unwrap(), 10);
    q.cursor = page.cursor.clone();
    let rest = index.query(&q, &scope).unwrap();
    assert_eq!(ids(&rest), ["d0", "m3", "m2", "m1", "m0"]);
    assert_eq!(rest.cursor, None);

    // A query wider than the scope is narrowed, not refused; one outside it answers nothing.
    assert_eq!(
        index
            .count(&query(json!({ "kinds": ["event", "task"] })), &scope)
            .unwrap(),
        10
    );
    let outside = query(json!({ "sources": ["other.app"] }));
    assert!(index.query(&outside, &scope).unwrap().items.is_empty());
    assert_eq!(index.count(&outside, &scope).unwrap(), 0);
    // Absent kinds or sources mean all of them; an empty list covers nothing.
    let desk_fixtures = scope_of(None, Some(&["desk.fixtures"]));
    assert_eq!(index.count(&query(json!({})), &desk_fixtures).unwrap(), 14);
    assert_eq!(
        index
            .count(&query(json!({})), &scope_of(Some(&[]), None))
            .unwrap(),
        0
    );
    assert_eq!(
        index
            .count(&query(json!({})), &scope_of(None, Some(&["*"])))
            .unwrap(),
        34
    );
    // get passes the scope too.
    assert_eq!(index.get(&source("other.app"), "o0", &scope).unwrap(), None);
    assert!(
        index
            .get(&source("desk.mail"), "m0", &scope)
            .unwrap()
            .is_some()
    );
}

#[test]
fn get_answers_the_item_or_none_and_remove_and_clear_drop_rows() {
    let index = open("query-get");
    let (a, b) = (source("desk.fixtures"), source("desk.fixtures/work"));
    let t1 = task("desk.fixtures", "t1", "Pay rent", "2026-10-30T09:00:00Z");
    index
        .upsert(&[
            t1.clone(),
            task(
                "desk.fixtures",
                "t2",
                "Water plants",
                "2026-10-30T10:00:00Z",
            ),
            task("desk.fixtures", "t3", "Call mum", "2026-10-30T11:00:00Z"),
            task(
                "desk.fixtures/work",
                "w1",
                "Ship it",
                "2026-10-30T09:00:00Z",
            ),
            task("desk.fixtures/work", "w2", "Review", "2026-10-30T10:00:00Z"),
        ])
        .unwrap();

    assert_eq!(index.get(&a, "t1", &all()).unwrap(), Some(t1));
    assert_eq!(index.get(&a, "nope", &all()).unwrap(), None);
    assert_eq!(index.get(&b, "t1", &all()).unwrap(), None);
    assert_eq!(index.remove(&a, ["t1", "nope"]).unwrap(), 1);
    assert_eq!(index.get(&a, "t1", &all()).unwrap(), None);
    assert_eq!(index.clear(&a).unwrap(), 2);
    assert_eq!(index.count(&query(json!({})), &all()).unwrap(), 2);
    assert_eq!(
        ids_of(&index, json!({ "sources": ["desk.fixtures"] })),
        ["w2", "w1"]
    );
    // The full-text table forgets removed items too.
    assert!(ids_of(&index, json!({ "text": "plants" })).is_empty());
    assert_eq!(index.clear(&a).unwrap(), 0);
}

#[test]
fn where_ops_cover_eq_ne_lt_lte_gt_gte_in_contains_and_exists() {
    let index = open("query-where");
    let t = "2026-10-30T09:00:00Z";
    index
        .upsert(&[
            task_with(
                "desk.fixtures",
                "p0",
                "No priority",
                t,
                json!({ "raw": { "labels": [] } }),
            ),
            task_with(
                "desk.fixtures",
                "p1",
                "Pay rent",
                t,
                json!({ "priority": 1, "raw": { "labels": ["urgent", "home"] } }),
            ),
            task_with(
                "desk.fixtures",
                "p2",
                "Ship the release",
                t,
                json!({ "priority": 2, "status": "done", "raw": { "labels": ["work"] } }),
            ),
            task_with(
                "desk.fixtures",
                "p3",
                "Fix the build",
                t,
                json!({ "priority": 3, "raw": { "labels": ["work", "urgent"] } }),
            ),
            task_with(
                "desk.fixtures",
                "p4",
                "Someday",
                t,
                json!({ "priority": 4, "status": "cancelled" }),
            ),
            event(
                "desk.fixtures",
                "e1",
                "Late",
                t,
                "2026-10-30T08:00:00+09:00",
            ),
            event("desk.fixtures", "e2", "Midnight", t, "2026-10-30T00:00:00Z"),
            event(
                "desk.fixtures",
                "e3",
                "Morning",
                t,
                "2026-10-30T10:00:00+01:00",
            ),
        ])
        .unwrap();
    let tasks = |conditions: Value| where_ids(&index, "task", conditions);
    let events = |conditions: Value| where_ids(&index, "event", conditions);
    let cond =
        |field: &str, op: &str, value: Value| json!([{ "field": field, "op": op, "value": value }]);

    assert_eq!(
        tasks(cond("status", "eq", json!("open"))),
        ["p0", "p1", "p3"]
    );
    assert_eq!(tasks(cond("status", "ne", json!("open"))), ["p2", "p4"]);
    assert_eq!(
        tasks(cond("priority", "ne", json!(2))),
        ["p0", "p1", "p3", "p4"]
    );
    assert_eq!(tasks(cond("priority", "lt", json!(3))), ["p1", "p2"]);
    assert_eq!(tasks(cond("priority", "lte", json!(3))), ["p1", "p2", "p3"]);
    assert_eq!(tasks(cond("priority", "gt", json!(2))), ["p3", "p4"]);
    assert_eq!(tasks(cond("priority", "gte", json!(2))), ["p2", "p3", "p4"]);
    assert_eq!(
        tasks(cond("status", "in", json!(["open", "cancelled"]))),
        ["p0", "p1", "p3", "p4"]
    );
    assert_eq!(tasks(cond("priority", "in", json!([1, 4]))), ["p1", "p4"]);
    assert!(tasks(cond("priority", "in", json!([]))).is_empty());
    assert_eq!(
        tasks(cond("raw.labels", "contains", json!("urgent"))),
        ["p1", "p3"]
    );
    assert_eq!(tasks(cond("title", "contains", json!("the"))), ["p2", "p3"]);
    assert_eq!(
        tasks(json!([{ "field": "priority", "op": "exists" }])),
        ["p1", "p2", "p3", "p4"]
    );
    assert_eq!(tasks(cond("priority", "exists", json!(false))), ["p0"]);
    assert_eq!(
        tasks(cond("raw", "exists", json!(true))),
        ["p0", "p1", "p2", "p3"]
    );
    let both = json!([
        { "field": "status", "op": "eq", "value": "open" },
        { "field": "priority", "op": "lte", "value": 2 },
    ]);
    assert_eq!(tasks(both), ["p1"]);

    // start compares instants: 08:00+09:00 is 23:00Z the day before, 10:00+01:00 is 09:00Z.
    assert_eq!(
        events(cond("start", "gte", json!("2026-10-30T00:00:00Z"))),
        ["e2", "e3"]
    );
    assert_eq!(
        events(cond("start", "lt", json!("2026-10-30T09:00:00+09:00"))),
        ["e1"]
    );
    assert_eq!(
        events(cond("start", "eq", json!("2026-10-30T09:00:00+09:00"))),
        ["e2"]
    );
    assert_eq!(
        events(cond("start", "lte", json!("2026-10-30T09:00:00Z"))),
        ["e1", "e2", "e3"]
    );
    assert_eq!(
        events(cond("start", "gt", json!("2026-10-30T08:59:59Z"))),
        ["e3"]
    );
    assert_eq!(
        events(cond("start", "in", json!(["2026-10-30T10:00:00+01:00"]))),
        ["e3"]
    );
    assert_eq!(events(cond("start", "contains", json!("+01:00"))), ["e3"]);

    // A time field against something that is not a time, `in` without an array, an order on an
    // object, or a condition without its value is invalid_params.
    for bad in [
        cond("start", "lt", json!(5)),
        cond("priority", "in", json!(1)),
        cond("priority", "gt", json!({ "a": 1 })),
        json!([{ "field": "status", "op": "eq" }]),
        cond("priority", "exists", json!("yes")),
    ] {
        let q = query(json!({ "where": bad }));
        assert_eq!(
            index.query(&q, &all()).unwrap_err().code,
            ErrorCode::InvalidParams,
            "{bad}"
        );
    }
}

#[test]
fn time_fields_compare_by_instant_not_by_string() {
    let index = open("query-time");
    let t = "2026-10-30T09:00:00Z";
    index
        .upsert(&[
            event(
                "desk.fixtures",
                "c",
                "Third",
                t,
                "2026-10-29T23:30:00-03:00",
            ),
            event("desk.fixtures", "b", "Second", t, "2026-10-30T01:00:00Z"),
            event(
                "desk.fixtures",
                "a",
                "First",
                t,
                "2026-10-30T09:00:00+09:00",
            ),
            task("desk.fixtures", "late", "Later", "2026-10-30T01:00:00Z"),
            task(
                "desk.fixtures",
                "early",
                "Earlier",
                "2026-10-30T09:00:00+09:00",
            ),
        ])
        .unwrap();
    // As strings c < b < a; as instants a (00:00Z) < b (01:00Z) < c (02:30Z).
    let by_start = |dir: &str| {
        ids_of(
            &index,
            json!({ "kinds": ["event"], "sort": [{ "field": "start", "dir": dir }] }),
        )
    };
    assert_eq!(by_start("asc"), ["a", "b", "c"]);
    assert_eq!(by_start("desc"), ["c", "b", "a"]);
    // updatedAt too, newest first by default.
    assert_eq!(
        ids_of(&index, json!({ "kinds": ["task"] })),
        ["late", "early"]
    );
}

#[test]
fn limit_over_500_is_invalid_params() {
    let index = open("query-limit");
    index
        .upsert(&[task("desk.fixtures", "t1", "One", "2026-10-30T09:00:00Z")])
        .unwrap();
    let err = index
        .query(&query(json!({ "limit": 501 })), &all())
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidParams);
    assert!(err.message.contains("500"), "{}", err.message);
    assert_eq!(ids_of(&index, json!({ "limit": 500 })), ["t1"]);
    for bad in [
        json!({ "limit": 0 }),
        json!({ "cursor": "not a cursor" }),
        json!({ "sort": [{ "field": "bad path!", "dir": "asc" }] }),
        json!({ "sources": ["$calendar"] }),
        json!({ "text": "" }),
    ] {
        let err = index.query(&query(bad.clone()), &all()).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams, "{bad}");
    }
}

/// 2026-10-`day` at 09:`minute`Z.
fn at(day: u32, minute: u32) -> String {
    format!("2026-10-{day:02}T09:{minute:02}:00Z")
}

fn scope_of(kinds: Option<&[&str]>, sources: Option<&[&str]>) -> DataReadScope {
    DataReadScope {
        kinds: kinds.map(|k| serde_json::from_value(json!(k)).unwrap()),
        sources: sources.map(|s| s.iter().map(|p| p.to_string()).collect()),
    }
}

fn where_ids(index: &desk_index::Index, kind: &str, conditions: Value) -> Vec<String> {
    let q =
        json!({ "kinds": [kind], "where": conditions, "sort": [{ "field": "id", "dir": "asc" }] });
    ids_of(index, q)
}
