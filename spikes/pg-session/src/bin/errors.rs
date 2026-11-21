//! Errors carry every field the server sends: severity (S, V), code (C), message (M), detail (D),
//! hint (H), position (P), internal position and query (p, q), where (W), schema, table, column,
//! data type and constraint names (s, t, c, d, n), and the server's file, line and routine (F, L, R).
//! A notice carries the same fields. After an error the session is ready for the next statement.

use std::collections::BTreeSet;
use std::process::ExitCode;

use desk_pg_session_spike::session::Fields;
use desk_pg_session_spike::{Session, expect, line, plain, title, verdict};

const SETUP: &str = "DROP TABLE IF EXISTS spike_err; DROP DOMAIN IF EXISTS spike_positive;
CREATE TABLE spike_err (id int PRIMARY KEY, v text NOT NULL CHECK (length(v) < 5));
CREATE DOMAIN spike_positive AS int CHECK (VALUE > 0);
INSERT INTO spike_err VALUES (1, 'one')";

const CASES: [(&str, &str); 8] = [
    ("unique", "INSERT INTO spike_err VALUES (1, 'two')"),
    ("not null", "INSERT INTO spike_err VALUES (2, NULL)"),
    ("check", "INSERT INTO spike_err VALUES (3, 'too long')"),
    ("domain", "SELECT (-1)::spike_positive"),
    ("syntax", "SELEC 1"),
    ("hint", "SELECT spike_missing(1)"),
    (
        "inside a function",
        "DO $$ BEGIN PERFORM missing_column FROM spike_err; END $$",
    ),
    ("two statements in one run", "SELECT 1; SELECT 2"),
];

fn show(name: &str, fields: &Fields, all: &mut BTreeSet<char>) {
    let text: Vec<String> = fields.iter().map(|(c, v)| format!("{c}={v:?}")).collect();
    line(name, text.join(" "));
    all.extend(fields.iter().map(|(c, _)| *c));
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let mut s = Session::connect(&plain()).await.expect("sign-in");
    s.simple(SETUP).await.expect("setup");
    title("errors: every field, by the extended protocol");
    let mut all = BTreeSet::new();
    for (name, sql) in CASES {
        match s.open(sql, &[], 10).await {
            Err(desk_pg_session_spike::Error::Server(fields)) => show(name, &fields, &mut all),
            other => failures.push(format!("{name}: {other:?}")),
        }
        let ok = s
            .open("SELECT 1", &[], 0)
            .await
            .map(|p| p.rows.len() == 1)
            .unwrap_or(false);
        expect(
            &mut failures,
            ok,
            format!("the session was not ready after {name}"),
        );
    }
    let codes: String = all.iter().collect();
    line("field codes seen", &codes);
    for code in "SVCMDHPpqWstcdnFLR".chars() {
        expect(
            &mut failures,
            all.contains(&code),
            format!("no error carried field {code}"),
        );
    }

    title("errors: a notice has the same fields");
    s.simple(
        "DO $$ BEGIN RAISE NOTICE 'look' USING DETAIL = 'the detail', HINT = 'the hint'; END $$",
    )
    .await
    .expect("notice");
    for a in &s.asyncs {
        if let desk_pg_session_spike::session::Async::Notice(fields, _) = a {
            show("notice", fields, &mut all);
        }
    }
    s.simple("DROP TABLE spike_err; DROP DOMAIN spike_positive")
        .await
        .ok();
    s.terminate().await.ok();
    verdict(&failures)
}
