//! The query budget: one kind out of 10 000 items, newest first, a page of 50, under 50 ms.

mod common;

use std::time::{Duration, Instant};

use common::*;
use desk_index::DataReadScope;
use serde_json::json;

const ITEMS: usize = 10_000;
const BUDGET: Duration = Duration::from_millis(50);

#[test]
fn ten_thousand_items_query_under_fifty_milliseconds() {
    let index = open("perf");
    let items: Vec<_> = (0..ITEMS)
        .map(|i| {
            // Spread over October with repeats, so ties are broken by id too.
            let at = format!(
                "2026-10-{:02}T{:02}:{:02}:{:02}Z",
                1 + i % 28,
                (i / 28) % 24,
                (i / 672) % 60,
                (i * 7) % 60,
            );
            let src = if i % 2 == 0 {
                "desk.fixtures"
            } else {
                "desk.mail"
            };
            let id = format!("i{i:05}");
            match i % 4 {
                0 => task(src, &id, &format!("Task {i}"), &at),
                1 => note(src, &id, &format!("Note {i}"), &at, "some words to index"),
                2 => event(src, &id, &format!("Event {i}"), &at, &at),
                _ => message(src, &id, &format!("Message {i}"), &at),
            }
        })
        .collect();
    index.upsert(&items).unwrap();

    let q = query(json!({
        "kinds": ["task"],
        "sort": [{ "field": "updatedAt", "dir": "desc" }],
        "limit": 50,
    }));
    let all = DataReadScope::all();
    let scoped = DataReadScope {
        kinds: None,
        sources: Some(vec!["desk.*".into()]),
    };
    let median = |scope: &DataReadScope| {
        assert_eq!(index.query(&q, scope).unwrap().items.len(), 50);
        let mut times: Vec<Duration> = (0..5)
            .map(|_| {
                let start = Instant::now();
                let page = index.query(&q, scope).unwrap();
                let took = start.elapsed();
                assert_eq!(page.items.len(), 50);
                took
            })
            .collect();
        times.sort();
        times[2]
    };
    let plain = median(&all);
    let with_scope = median(&scoped);
    eprintln!(
        "desk-index: median of five queries over {ITEMS} items: {plain:?}, with a scope {with_scope:?}"
    );
    assert!(plain < BUDGET, "{plain:?} is over the {BUDGET:?} budget");
    assert!(
        with_scope < BUDGET,
        "{with_scope:?} with a scope is over the {BUDGET:?} budget"
    );
}
