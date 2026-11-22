//! Scripts against a real server (#540, ADR 0344): several statements in one call, each answered
//! with its own first page and notices, in order; the first error stops the script unless it goes
//! on, a result with pages left or a COPY FROM STDIN stops it with that result open, a transaction
//! it opens stays the session's, and a cancel stops it between statements as well as in one.

#[macro_use]
mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::{limits, open, run, sql, until, value};
use desk_pg::{Direction, Limits, Statement, Transaction};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";

fn script(texts: &[&str]) -> Vec<Statement> {
    texts.iter().map(|text| sql(text)).collect()
}

#[test]
fn a_script_answers_each_statement_in_order_with_its_notices() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let done = session
        .script(
            script(&[
                "CREATE TEMP TABLE t540_a (id int PRIMARY KEY, name text)",
                "DO $$ BEGIN RAISE NOTICE 'one'; END $$",
                "INSERT INTO t540_a VALUES (1, 'ada'), (2, 'grace')",
                "DO $$ BEGIN RAISE NOTICE 'two'; RAISE WARNING 'three'; END $$",
                "SELECT name FROM t540_a ORDER BY id",
            ]),
            Limits::default(),
            false,
        )
        .expect("the script runs");
    assert!(!done.cancelled);
    assert!(done.failure.is_none());
    let tags: Vec<_> = done.pages.iter().map(|p| p.tag.clone()).collect();
    let tags: Vec<_> = tags.iter().map(|t| t.as_deref().unwrap_or("")).collect();
    assert_eq!(tags, ["CREATE TABLE", "DO", "INSERT 0 2", "DO", "SELECT 2"]);
    let said: Vec<Vec<&str>> = done
        .pages
        .iter()
        .map(|p| p.notices.iter().map(|n| n.message()).collect())
        .collect();
    assert_eq!(said, [vec![], vec!["one"], vec![], vec!["two", "three"], vec![]]);
    let last = &done.pages[4];
    assert_eq!(last.columns.as_ref().map(Vec::len), Some(1));
    let names: Vec<_> = last.rows.iter().map(|r| r[0].clone()).collect();
    assert_eq!(names, [Some("ada".to_owned()), Some("grace".to_owned())]);
    assert!(done.pages.iter().all(|p| p.transaction == Some(Transaction::Idle)));
    assert!(!session.running());
}

#[test]
fn the_first_error_stops_the_script_unless_it_goes_on() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(session, "CREATE TEMP TABLE t540_b (id int PRIMARY KEY)");
    let texts = [
        "INSERT INTO t540_b VALUES (1)",
        "SELECT 1 AS a,\n  nope",
        "INSERT INTO t540_b VALUES (2)",
    ];
    let stopped = session
        .script(script(&texts), Limits::default(), false)
        .expect("the script runs");
    assert_eq!(stopped.pages.len(), 2, "nothing after the error runs");
    let error = stopped.pages[1].error.as_ref().expect("the server's error");
    assert_eq!(error.code(), "42703");
    let position = (texts[1].find("nope").unwrap() + 1).to_string();
    assert_eq!(error.field(b'P'), Some(position.as_str()));
    // Each statement is its own: the one before the error stays.
    let count = "SELECT string_agg(id::text, ',' ORDER BY id) FROM t540_b";
    assert_eq!(value(session, count), Some("1".to_owned()));

    run(session, "TRUNCATE t540_b");
    let went_on = session
        .script(script(&texts), Limits::default(), true)
        .expect("the script runs");
    assert_eq!(went_on.pages.len(), 3);
    assert!(went_on.pages[1].error.is_some());
    assert_eq!(value(session, count), Some("1,2".to_owned()));
}

#[test]
fn a_transaction_the_script_opens_stays_the_session_s() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(session, "CREATE TEMP TABLE t540_c (id int)");
    let done = session
        .script(
            script(&["BEGIN", "INSERT INTO t540_c VALUES (1)"]),
            Limits::default(),
            false,
        )
        .expect("the script runs");
    assert_eq!(done.pages[1].transaction, Some(Transaction::Open));
    assert_eq!(session.transaction(), Transaction::Open);
    let failed = session
        .script(
            script(&["INSERT INTO t540_c VALUES ('x')", "SELECT 1"]),
            Limits::default(),
            false,
        )
        .expect("the script runs");
    assert_eq!(failed.pages.len(), 1);
    assert_eq!(failed.pages[0].transaction, Some(Transaction::Failed));
    run(session, "ROLLBACK");
    assert_eq!(value(session, "SELECT count(*) FROM t540_c"), Some("0".to_owned()));
}

#[test]
fn a_result_with_pages_left_or_a_copy_in_stops_the_script_open() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let done = session
        .script(
            script(&[
                "SELECT 1",
                "SELECT i FROM generate_series(1, 10) i",
                "SELECT 2",
            ]),
            limits(3),
            false,
        )
        .expect("the script runs");
    assert_eq!(done.pages.len(), 2);
    assert!(done.pages[1].more && session.more());
    let next = session.fetch(limits(100), false).expect("the rest");
    assert_eq!(next.rows.len(), 7);
    assert_eq!(next.tag.as_deref(), Some("SELECT 10"));

    run(session, "CREATE TEMP TABLE t540_d (id int)");
    let copy = session
        .script(
            script(&["COPY t540_d FROM STDIN", "SELECT 3"]),
            Limits::default(),
            false,
        )
        .expect("the script runs");
    assert_eq!(copy.pages.len(), 1);
    assert_eq!(copy.pages[0].copy.map(|c| c.direction), Some(Direction::In));
    let input = desk_pg::CopyInput {
        data: Some(b"5\n".to_vec()),
        done: true,
        fail: None,
    };
    assert_eq!(session.copy(input).unwrap().tag.as_deref(), Some("COPY 1"));
}

#[test]
fn cancel_stops_the_script_where_it_is() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = Arc::new(opened.session);
    let running = session.clone();
    let start = Instant::now();
    let sleeps = vec!["SELECT pg_sleep(0.05)"; 200];
    let script = std::thread::spawn(move || {
        running.script(script(&sleeps), Limits::default(), true)
    });
    until(|| session.running().then_some(()));
    std::thread::sleep(Duration::from_millis(400));
    session.cancel().unwrap();
    let done = script.join().unwrap().expect("the script answers");
    assert!(done.cancelled, "a cancel stops even a script that goes on");
    assert!(done.pages.len() < 200, "{} statements ran", done.pages.len());
    assert!(start.elapsed() < Duration::from_secs(5));
    // A statement the cancel reached carries 57014; every page before it finished.
    let errors = done.pages.iter().filter(|p| p.error.is_some()).count();
    assert!(errors <= 1);
    assert_eq!(value(&session, "SELECT 1"), Some("1".to_owned()));
    // The next script is not cancelled by the last one's cancel.
    let again = session
        .script(self::script(&["SELECT 1", "SELECT 2"]), Limits::default(), false)
        .unwrap();
    assert_eq!((again.pages.len(), again.cancelled), (2, false));
}

#[test]
fn a_fatal_error_ends_the_script_and_its_page_says_so() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let done = session
        .script(
            script(&[
                "SELECT 1",
                "SELECT pg_terminate_backend(pg_backend_pid())",
                "SELECT 2",
            ]),
            Limits::default(),
            true,
        )
        .expect("the script answers");
    assert_eq!(done.pages.len(), 2);
    let fatal = done.pages[1].error.as_ref().expect("the server's FATAL");
    assert_eq!(fatal.severity(), "FATAL");
    until(|| session.closed().then_some(()));
}
