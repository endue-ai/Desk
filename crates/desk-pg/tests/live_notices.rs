//! Notices against a real server (#541, ADR 0334): the notices a call hears come with its page, in
//! order, and never also as events, so nothing a frame hears later can move them to another
//! statement; a page keeps 10,000 and counts the rest.

#[macro_use]
mod common;

use common::{limits, open, run, sql};
use desk_pg::{Event, Page};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";

fn said(page: &Page) -> Vec<(String, String)> {
    let pairs = page.notices.iter();
    pairs
        .map(|n| (n.severity().to_owned(), n.message().to_owned()))
        .collect()
}

fn heard(events: &common::Events) -> usize {
    let all = events.all();
    all.iter().filter(|e| matches!(e, Event::Notice(_))).count()
}

#[test]
fn a_statement_s_notices_come_with_its_page() {
    let config = live!(VAR);
    let (opened, events) = open(&config);
    let session = &opened.session;
    let before = heard(&events);

    let page = run(
        session,
        "DO $$ BEGIN RAISE NOTICE 'first'; RAISE WARNING 'second'; END $$",
    );
    let pairs = [("NOTICE", "first"), ("WARNING", "second")].map(|(s, m)| (s.into(), m.into()));
    assert_eq!(said(&page), pairs);
    assert_eq!(page.notices_skipped, 0);
    assert_eq!(said(&run(session, "SELECT 1")), []);

    // A function's notices while the rows are read in pages: each with the page it was raised in.
    run(
        session,
        "CREATE FUNCTION pg_temp.t541_said(i int) RETURNS int LANGUAGE plpgsql AS \
         $$ BEGIN RAISE NOTICE 'row %', i; RETURN i; END $$",
    );
    let first = session
        .run(
            sql("SELECT pg_temp.t541_said(i) FROM generate_series(1, 5) i"),
            limits(2),
        )
        .expect("the statement runs");
    let mut pages = vec![first];
    while pages.last().is_some_and(|p| p.more) {
        pages.push(session.fetch(limits(2), false).expect("a page"));
    }
    let rows: Vec<String> = pages.iter().flat_map(said).map(|(_, m)| m).collect();
    assert_eq!(rows, ["row 1", "row 2", "row 3", "row 4", "row 5"]);
    assert!(pages[0].notices.len() < 5, "the first page holds its own");

    assert_eq!(heard(&events), before, "none came as an event");
}

#[test]
fn a_page_keeps_ten_thousand_notices_and_counts_the_rest() {
    let config = live!(VAR);
    let (opened, _events) = open(&config);
    let page = run(
        &opened.session,
        "DO $$ BEGIN FOR i IN 1..10005 LOOP RAISE NOTICE 'n%', i; END LOOP; END $$",
    );
    assert_eq!(page.notices.len(), 10_000);
    assert_eq!(page.notices.last().map(|n| n.message()), Some("n10000"));
    assert_eq!(page.notices_skipped, 5);
}
