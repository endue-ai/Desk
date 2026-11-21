//! A result's columns as RowDescription gives them: each column's type (OID and modifier) and, for
//! a column read straight from a table, that table's OID and the column's attribute number, checked
//! against pg_attribute. Expressions say 0 and 0; a result without rows still has its columns.

use std::process::ExitCode;

use desk_pg_session_spike::query::Column;
use desk_pg_session_spike::{Session, expect, line, plain, title, verdict};

const SETUP: &str = "
DROP VIEW IF EXISTS spike_view; DROP TABLE IF EXISTS spike_cols, spike_kind;
CREATE TABLE spike_kind (id int PRIMARY KEY, label text);
CREATE TABLE spike_cols (id int PRIMARY KEY, name varchar(20), amount numeric(10,2),
  at timestamptz, tags text[], kind int REFERENCES spike_kind);
CREATE VIEW spike_view AS SELECT c.id, k.label FROM spike_cols c JOIN spike_kind k ON k.id = c.kind;
INSERT INTO spike_kind VALUES (1, 'one');
INSERT INTO spike_cols VALUES (1, 'first', 12.50, '2026-11-21 10:00+00', '{a,b}', 1);";

const SQL: &str = "SELECT c.id, c.name AS who, c.amount, c.amount * 2 AS twice, c.tags, k.label,
  v.label AS via_view, now() AS asked FROM spike_cols c JOIN spike_kind k ON k.id = c.kind
  LEFT JOIN spike_view v ON v.id = c.id";

/// The type's name with its modifier, the table's name and the column's name, from the catalog.
async fn describe(s: &mut Session, c: &Column) -> (String, String, String) {
    let (oid, typmod, table, attnum) = (
        c.type_oid.to_string(),
        c.type_modifier.to_string(),
        c.table_oid.to_string(),
        c.column_id.to_string(),
    );
    let sql = "SELECT format_type($1::oid, $2::int), NULLIF($3::oid, 0)::regclass::text,
      (SELECT attname FROM pg_attribute WHERE attrelid = $3::oid AND attnum = $4::int2)";
    let page = s
        .open(
            sql,
            &[Some(&oid), Some(&typmod), Some(&table), Some(&attnum)],
            0,
        )
        .await
        .unwrap();
    let row = &page.rows[0];
    let text = |i: usize| row[i].clone().unwrap_or_else(|| "-".into());
    (text(0), text(1), text(2))
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let mut s = Session::connect(&plain()).await.expect("sign-in");
    s.simple(SETUP).await.expect("setup");
    title("columns: types and origins of a join with expressions and a view");
    let page = s.open(SQL, &[], 100).await.expect("the query");
    let columns = page.columns.clone().expect("RowDescription");
    let mut seen = Vec::new();
    for c in &columns {
        let (ty, table, attname) = describe(&mut s, c).await;
        line(
            &c.name,
            format!(
                "type {} {ty} (typmod {}, size {}), table {} {table}, attnum {} {attname}, format {}",
                c.type_oid, c.type_modifier, c.type_size, c.table_oid, c.column_id, c.format
            ),
        );
        seen.push((c.name.clone(), ty, table, attname));
    }
    let find = |name: &str| seen.iter().find(|s| s.0 == name).cloned().unwrap();
    expect(
        &mut failures,
        find("who")
            == (
                "who".into(),
                "character varying(20)".into(),
                "spike_cols".into(),
                "name".into(),
            ),
        "who is not spike_cols.name varchar(20)",
    );
    expect(
        &mut failures,
        find("amount").1 == "numeric(10,2)",
        "amount lost its modifier",
    );
    expect(
        &mut failures,
        find("twice").2 == "-",
        "an expression named a table",
    );
    expect(
        &mut failures,
        find("label").2 == "spike_kind",
        "label is not spike_kind's",
    );
    line(
        "via_view resolves to",
        format!("{} {}", find("via_view").2, find("via_view").3),
    );

    title("columns: a result without rows");
    let empty = s
        .open("SELECT * FROM spike_cols WHERE false", &[], 100)
        .await
        .expect("empty");
    let names: Vec<String> = empty
        .columns
        .unwrap_or_default()
        .iter()
        .map(|c| c.name.clone())
        .collect();
    line("columns", names.join(", "));
    line(
        "rows and tag",
        format!("{} {:?}", empty.rows.len(), empty.tag),
    );
    expect(
        &mut failures,
        names.len() == 6,
        "a result without rows lost its columns",
    );
    s.simple("DROP VIEW spike_view; DROP TABLE spike_cols, spike_kind")
        .await
        .ok();
    s.terminate().await.ok();
    verdict(&failures)
}
