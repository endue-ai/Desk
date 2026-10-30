//! `Index::query`: kinds, sources, text, where, sort, the cursor and the caller's data:read scope.

mod common;

use common::*;
use desk_bridge::DataReadPermission;
use desk_index::{DataReadScope, ErrorCode, Index};
use serde_json::{Value, json};

const D: &str = "desk.fixtures";
const W: &str = "desk.fixtures/work";
const O: &str = "other.app";

#[test]
fn upserted_items_come_back_by_kind_source_text_and_where_in_sort_order() {
    let index = open("query-basic");
    let due = |d: u32| json!({ "due": format!("2026-10-{d:02}T00:00:00Z") });
    let done = json!({ "status": "done" });
    let t1 = task_with(D, "t1", "Pay rent", &day(28), due(31));
    let t2 = task_with(W, "t2", "Send the budget", &day(29), due(30));
    let t3 = task_with(O, "t3", "Book flights", &day(30), done.clone());
    let n1 = note(D, "n1", "Ideas", &at(30, 10), "the budget for next year");
    let e1 = event(D, "e1", "Standup", &day(27), &day(30));
    index.upsert(&[t1.clone(), t2, t3, n1, e1]).unwrap();
    let found = |q: Value| found(&index, q);

    // Kinds, newest updatedAt first when sort is absent; the item comes back as it went in.
    let tasks = query(json!({ "kinds": ["task"] }));
    let page = index.query(&tasks, &all()).unwrap();
    assert_eq!(ids(&page), ["t3", "t2", "t1"]);
    assert_eq!(page.items[2], t1);
    assert_eq!(page.cursor, None);
    // A connector id covers every instance of it; connector/instance covers one.
    assert_eq!(found(json!({ "sources": [D] })), "n1 t2 t1 e1");
    assert_eq!(found(json!({ "sources": [W] })), "t2");
    assert_eq!(found(json!({ "sources": [O, W] })), "t3 t2");
    // Text through the full-text table over title and body: words and prefixes, all of them.
    assert_eq!(found(json!({ "text": "budget" })), "n1 t2");
    assert_eq!(found(json!({ "text": "BUDG" })), "n1 t2");
    assert_eq!(found(json!({ "text": "budget send" })), "t2");
    assert_eq!(found(json!({ "text": "\"unbalanced" })), "");
    // Where and sort.
    let open_by_due = json!({
        "kinds": ["task"],
        "where": [{ "field": "status", "op": "eq", "value": "open" }],
        "sort": [{ "field": "due", "dir": "asc" }],
    });
    assert_eq!(found(open_by_due), "t2 t1");
    let by_title = json!({ "sort": [{ "field": "title", "dir": "asc" }] });
    assert_eq!(found(by_title), "t3 n1 t1 t2 e1");
    // An upsert replaces the item with the same source and id.
    let renamed = task_with(D, "t1", "Pay the rent", &day(31), done);
    index.upsert(&[renamed]).unwrap();
    assert_eq!(found(json!({ "kinds": ["task"] })), "t1 t3 t2");
    assert_eq!(found(json!({ "text": "rent" })), "t1");
    assert_eq!(index.count(&query(json!({})), &all()).unwrap(), 5);
}

#[test]
fn paging_with_a_cursor_is_stable_and_never_repeats_or_skips_an_item() {
    let index = open("query-paging");
    let same = &day(30);
    let tasks: Vec<_> = ["g", "a", "e", "c", "b", "f", "d"]
        .iter()
        .map(|id| task(D, id, "Same time", same))
        .collect();
    index.upsert(&tasks).unwrap();

    let mut q = query(json!({ "kinds": ["task"], "limit": 3 }));
    let first = index.query(&q, &all()).unwrap();
    assert_eq!(ids(&first), ["a", "b", "c"]);
    // An item that sorts before the cursor and an update to one already seen do not shift the
    // next page.
    let (before, seen) = (
        task(D, "0", "Same time", same),
        task(D, "a", "Renamed", same),
    );
    index.upsert(&[before, seen]).unwrap();
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
        assert_eq!(seen.join(" "), "0 a b c d e f g", "{dir}");
    }
    // A field some items lack sorts them last, either way, and pages the same.
    let due = |d: u32| json!({ "due": format!("2026-11-{d:02}T00:00:00Z") });
    let dated = [("b", 2), ("d", 1), ("f", 2)].map(|(id, d)| task_with(D, id, "Due", same, due(d)));
    index.upsert(&dated).unwrap();
    for (dir, order) in [("asc", "d b f 0 a c e g"), ("desc", "b f d 0 a c e g")] {
        let mut q = query(json!({ "sort": [{ "field": "due", "dir": dir }], "limit": 3 }));
        let mut seen = Vec::new();
        loop {
            let page = index.query(&q, &all()).unwrap();
            seen.extend(ids(&page));
            match page.cursor {
                Some(cursor) => q.cursor = Some(cursor),
                None => break,
            }
        }
        assert_eq!(seen.join(" "), order, "{dir}");
    }
}

#[test]
fn a_data_read_scope_filters_kinds_and_sources_inside_the_page() {
    let index = open("query-scope");
    let minute = |d: u32, m: u32| format!("2026-10-{d:02}T09:{m:02}:00Z");
    let mut items = Vec::new();
    // The newest items are the ones the scope does not cover: a filter after paging would leave
    // the page short.
    for i in 0..8 {
        let t = &minute(30, i);
        items.push(task(O, &format!("o{i}"), "Other", t));
        items.push(event(D, &format!("e{i}"), "Event", t, t));
        items.push(task("example.desk", &format!("x{i}"), "Prefix only", t));
    }
    for i in 0..6 {
        items.push(task(D, &format!("d{i}"), "Desk", &minute(20, i)));
    }
    for i in 0..4 {
        items.push(task("desk.mail", &format!("m{i}"), "Mail", &minute(10, i)));
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
    let count = |q: Value, scope: &DataReadScope| index.count(&query(q), scope).unwrap();
    assert_eq!(count(json!({ "kinds": ["event", "task"] }), &scope), 10);
    let outside = json!({ "sources": [O] });
    let page = index.query(&query(outside.clone()), &scope).unwrap();
    assert!(page.items.is_empty());
    assert_eq!(count(outside, &scope), 0);
    // Absent kinds or sources mean all of them; an empty list covers nothing.
    assert_eq!(count(json!({}), &scope_of(None, Some(&[D]))), 14);
    assert_eq!(count(json!({}), &scope_of(Some(&[]), None)), 0);
    assert_eq!(count(json!({}), &scope_of(None, Some(&[]))), 0);
    assert_eq!(count(json!({}), &scope_of(None, Some(&["*"]))), 34);
    // get passes the scope too.
    assert_eq!(index.get(&source(O), "o0", &scope).unwrap(), None);
    let mail = index.get(&source("desk.mail"), "m0", &scope).unwrap();
    assert!(mail.is_some());
}

#[test]
fn get_answers_the_item_or_none_and_remove_and_clear_drop_rows() {
    let index = open("query-get");
    let (a, b) = (source(D), source(W));
    let t1 = task(D, "t1", "Pay rent", &at(30, 9));
    index
        .upsert(&[
            t1.clone(),
            task(D, "t2", "Water plants", &at(30, 10)),
            task(D, "t3", "Call mum", &at(30, 11)),
            task(W, "w1", "Ship it", &at(30, 9)),
            task(W, "w2", "Review", &at(30, 10)),
        ])
        .unwrap();

    assert_eq!(index.get(&a, "t1", &all()).unwrap(), Some(t1));
    assert_eq!(index.get(&a, "nope", &all()).unwrap(), None);
    assert_eq!(index.get(&b, "t1", &all()).unwrap(), None);
    assert_eq!(index.remove(&a, ["t1", "nope"]).unwrap(), 1);
    assert_eq!(index.get(&a, "t1", &all()).unwrap(), None);
    assert_eq!(index.clear(&a).unwrap(), 2);
    assert_eq!(index.count(&query(json!({})), &all()).unwrap(), 2);
    assert_eq!(found(&index, json!({ "sources": [D] })), "w2 w1");
    // The full-text table forgets removed items too.
    assert_eq!(found(&index, json!({ "text": "plants" })), "");
    assert_eq!(index.clear(&a).unwrap(), 0);
}

#[test]
fn where_ops_cover_eq_ne_lt_lte_gt_gte_in_contains_and_exists() {
    let index = open("query-where");
    let t = &day(30);
    let with = |id: &str, title: &str, extra: Value| task_with(D, id, title, t, extra);
    let p2 = json!({ "priority": 2, "status": "done", "raw": { "labels": ["work"] } });
    index
        .upsert(&[
            with("p0", "No priority", json!({ "raw": { "labels": [] } })),
            with(
                "p1",
                "Pay rent",
                json!({ "priority": 1, "raw": { "labels": ["urgent"] } }),
            ),
            with("p2", "Ship the release", p2),
            with(
                "p3",
                "Fix the build",
                json!({ "priority": 3, "raw": { "labels": ["work", "urgent"] } }),
            ),
            with(
                "p4",
                "Someday",
                json!({ "priority": 4, "status": "cancelled" }),
            ),
            event(D, "e1", "Late", t, "2026-10-30T08:00:00+09:00"),
            event(D, "e2", "Midnight", t, "2026-10-30T00:00:00Z"),
            event(D, "e3", "Morning", t, "2026-10-30T10:00:00+01:00"),
        ])
        .unwrap();
    let cond =
        |field: &str, op: &str, value: Value| json!([{ "field": field, "op": op, "value": value }]);
    let tasks =
        |field: &str, op: &str, value: Value| where_ids(&index, "task", cond(field, op, value));
    let events =
        |op: &str, value: &str| where_ids(&index, "event", cond("start", op, json!(value)));

    assert_eq!(tasks("status", "eq", json!("open")), "p0 p1 p3");
    assert_eq!(tasks("status", "ne", json!("open")), "p2 p4");
    assert_eq!(tasks("priority", "ne", json!(2)), "p0 p1 p3 p4");
    assert_eq!(tasks("priority", "lt", json!(3)), "p1 p2");
    assert_eq!(tasks("priority", "lte", json!(3)), "p1 p2 p3");
    assert_eq!(tasks("priority", "gt", json!(2)), "p3 p4");
    assert_eq!(tasks("priority", "gte", json!(2)), "p2 p3 p4");
    assert_eq!(
        tasks("status", "in", json!(["open", "cancelled"])),
        "p0 p1 p3 p4"
    );
    assert_eq!(tasks("priority", "in", json!([1, 4])), "p1 p4");
    assert_eq!(tasks("priority", "in", json!([])), "");
    assert_eq!(tasks("raw.labels", "contains", json!("urgent")), "p1 p3");
    assert_eq!(tasks("title", "contains", json!("the")), "p2 p3");
    let any_priority = json!([{ "field": "priority", "op": "exists" }]);
    assert_eq!(where_ids(&index, "task", any_priority), "p1 p2 p3 p4");
    assert_eq!(tasks("priority", "exists", json!(false)), "p0");
    assert_eq!(tasks("raw", "exists", json!(true)), "p0 p1 p2 p3");
    let both = json!([
        { "field": "status", "op": "eq", "value": "open" },
        { "field": "priority", "op": "lte", "value": 2 },
    ]);
    assert_eq!(where_ids(&index, "task", both), "p1");

    // start compares instants: 08:00+09:00 is 23:00Z the day before, 10:00+01:00 is 09:00Z.
    assert_eq!(events("gte", "2026-10-30T00:00:00Z"), "e2 e3");
    assert_eq!(events("lt", "2026-10-30T09:00:00+09:00"), "e1");
    assert_eq!(events("eq", "2026-10-30T09:00:00+09:00"), "e2");
    assert_eq!(events("lte", "2026-10-30T09:00:00Z"), "e1 e2 e3");
    assert_eq!(events("gt", "2026-10-30T08:59:59Z"), "e3");
    assert_eq!(events("contains", "+01:00"), "e3");
    let at_nine = cond("start", "in", json!(["2026-10-30T10:00:00+01:00"]));
    assert_eq!(where_ids(&index, "event", at_nine), "e3");

    // A time field against something that is not a time, `in` without an array, an order on an
    // object, a condition without its value, or exists with a string is invalid_params.
    for bad in [
        cond("start", "lt", json!(5)),
        cond("priority", "in", json!(1)),
        cond("priority", "gt", json!({ "a": 1 })),
        json!([{ "field": "status", "op": "eq" }]),
        cond("priority", "exists", json!("yes")),
    ] {
        let q = query(json!({ "where": bad }));
        let err = index.query(&q, &all()).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams, "{bad}");
    }
}

#[test]
fn time_fields_compare_by_instant_not_by_string() {
    let index = open("query-time");
    let t = &day(30);
    index
        .upsert(&[
            event(D, "c", "Third", t, "2026-10-29T23:30:00-03:00"),
            event(D, "b", "Second", t, "2026-10-30T01:00:00Z"),
            event(D, "a", "First", t, "2026-10-30T09:00:00+09:00"),
            task(D, "late", "Later", "2026-10-30T01:00:00Z"),
            task(D, "early", "Earlier", "2026-10-30T09:00:00+09:00"),
        ])
        .unwrap();
    // As strings c < b < a; as instants a (00:00Z) < b (01:00Z) < c (02:30Z).
    let by_start = |dir: &str| {
        let sort = json!([{ "field": "start", "dir": dir }]);
        found(&index, json!({ "kinds": ["event"], "sort": sort }))
    };
    assert_eq!(by_start("asc"), "a b c");
    assert_eq!(by_start("desc"), "c b a");
    // updatedAt too, newest first by default.
    assert_eq!(found(&index, json!({ "kinds": ["task"] })), "late early");
}

#[test]
fn limit_over_500_is_invalid_params() {
    let index = open("query-limit");
    index.upsert(&[task(D, "t1", "One", &day(30))]).unwrap();
    let err = index
        .query(&query(json!({ "limit": 501 })), &all())
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidParams);
    assert!(err.message.contains("500"), "{}", err.message);
    assert_eq!(found(&index, json!({ "limit": 500 })), "t1");
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

fn scope_of(kinds: Option<&[&str]>, sources: Option<&[&str]>) -> DataReadScope {
    DataReadScope {
        kinds: kinds.map(|k| serde_json::from_value(json!(k)).unwrap()),
        sources: sources.map(|s| s.iter().map(|p| p.to_string()).collect()),
    }
}

/// The ids of `kind` the conditions cover, by id.
fn where_ids(index: &Index, kind: &str, conditions: Value) -> String {
    let sort = json!([{ "field": "id", "dir": "asc" }]);
    found(
        index,
        json!({ "kinds": [kind], "where": conditions, "sort": sort }),
    )
}
