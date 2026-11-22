//! Describe against a real server (PG-21, ADR 0353): Parse and Describe of a statement answer the
//! types the server infers for its parameters and the columns it answers, NoData for a statement
//! without rows, the server's error with its position, and nothing runs; an open transaction
//! stays open, and a result left open is closed first.

#[macro_use]
mod common;

use common::{limits, open, run, sql};
use desk_pg::{Limits, Statement, Transaction};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";

#[test]
fn describe_answers_parameter_types_and_columns() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(
        session,
        "CREATE TEMP TABLE t454_a (id int PRIMARY KEY, name text, tags text[])",
    );
    let described = session
        .describe(sql(
            "SELECT name, id + 1 AS next FROM t454_a WHERE id = $1 AND tags @> $2",
        ))
        .expect("the statement is described");
    assert_eq!(described.params, [23, 1009]);
    let page = &described.page;
    assert!(page.error.is_none());
    let columns = page.columns.as_ref().expect("the columns");
    let names: Vec<_> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["name", "next"]);
    let types: Vec<_> = columns.iter().map(|c| c.type_oid).collect();
    assert_eq!(types, [25, 23]);
    assert_eq!(page.transaction, Some(Transaction::Idle));
    assert!(page.rows.is_empty());
}

#[test]
fn a_write_is_described_and_never_runs() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(session, "CREATE TEMP TABLE t454_b (id int, at timestamptz)");
    let fixed = Statement {
        sql: "INSERT INTO t454_b VALUES ($1, $2)".to_owned(),
        params: Vec::new(),
        types: vec![20],
    };
    let described = session.describe(fixed).expect("the insert is described");
    assert_eq!(
        described.params,
        [20, 1184],
        "a given type stays, the other is inferred"
    );
    assert!(
        described.page.columns.is_none(),
        "an INSERT answers no rows: NoData"
    );
    let count = session
        .run(sql("SELECT count(*) FROM t454_b"), Limits::default())
        .expect("count");
    assert_eq!(count.rows[0][0].as_deref(), Some("0"), "nothing ran");
}

#[test]
fn an_error_comes_with_its_position_and_the_session_goes_on() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let described = session
        .describe(sql("SELECT id FROM t454_missing WHERE id = $1"))
        .expect("an error is a result");
    let error = described.page.error.as_ref().expect("the server's error");
    assert_eq!(error.code(), "42P01");
    assert_eq!(error.field(b'P'), Some("16"));
    assert!(described.params.is_empty());
    let after = session
        .run(sql("SELECT 1"), Limits::default())
        .expect("ready again");
    assert_eq!(after.rows[0][0].as_deref(), Some("1"));
}

#[test]
fn an_open_transaction_stays_open_and_an_open_result_is_closed_first() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(session, "BEGIN");
    let first = session
        .run(sql("SELECT generate_series(1, 5)"), limits(1))
        .expect("a first page");
    assert!(first.more);
    let described = session.describe(sql("SELECT $1::int")).expect("described");
    assert_eq!(described.params, [23]);
    assert_eq!(described.page.transaction, Some(Transaction::Open));
    let after = session
        .run(sql("SELECT 2"), Limits::default())
        .expect("ready");
    assert_eq!(after.transaction, Some(Transaction::Open));
    run(session, "ROLLBACK");
}
