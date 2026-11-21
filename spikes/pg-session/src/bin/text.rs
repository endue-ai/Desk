//! Values in the server's text form (the plugin's NF-10): NULL apart from '' and 'NULL', numbers as
//! the server wrote them (past 2^53 too), dates in DateStyle ISO, bytea in hex, arrays, JSON,
//! ranges and records as their output functions print them. The extended protocol with text result
//! format and the simple protocol give the same characters.

use std::process::ExitCode;

use desk_pg_session_spike::{Session, expect, line, plain, title, verdict};

const SQL: &str = r#"SELECT NULL::text AS null_text, ''::text AS empty, 'NULL'::text AS null_word,
  9007199254740993::int8 AS past_2_53, 12345678901234567890.000100::numeric AS big_numeric,
  0.1::float8 AS float8, 'NaN'::numeric AS nan, 'a'::char(3) AS padded, true AS yes,
  '2026-11-21 10:00:00+00'::timestamptz AS at, '2026-11-21'::date AS day,
  '1 day 02:03:04.5'::interval AS span, '\x00ff'::bytea AS bytes,
  ARRAY[1, NULL, 3] AS ints, ARRAY['a b', NULL, 'NULL', ''] AS texts,
  '{"b": 1, "a": [true, null]}'::jsonb AS doc, int4range(1, 10) AS range, '(1,2)'::point AS pt,
  '12.50'::money AS cash, ROW(1, 'x', NULL) AS rec, 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6'::uuid AS id"#;

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let mut s = Session::connect(&plain()).await.expect("sign-in");
    title("text: the server's text form of each value, as JSON (null is NULL)");
    let page = s.open(SQL, &[], 10).await.expect("the query");
    let columns = page.columns.unwrap();
    let row = &page.rows[0];
    for (c, value) in columns.iter().zip(row) {
        line(
            &format!("{} (type {})", c.name, c.type_oid),
            serde_json::to_string(value).unwrap(),
        );
    }
    let get = |name: &str| row[columns.iter().position(|c| c.name == name).unwrap()].clone();
    expect(
        &mut failures,
        get("null_text").is_none(),
        "NULL arrived as a value",
    );
    expect(
        &mut failures,
        get("empty").as_deref() == Some(""),
        "'' did not stay ''",
    );
    expect(
        &mut failures,
        get("null_word").as_deref() == Some("NULL"),
        "'NULL' did not stay 'NULL'",
    );
    expect(
        &mut failures,
        get("past_2_53").as_deref() == Some("9007199254740993"),
        "int8 past 2^53 changed",
    );
    expect(
        &mut failures,
        get("at").as_deref() == Some("2026-11-21 10:00:00+00"),
        "timestamptz is not ISO in UTC",
    );
    expect(
        &mut failures,
        get("bytes").as_deref() == Some("\\x00ff"),
        "bytea is not hex",
    );
    expect(
        &mut failures,
        get("padded").as_deref() == Some("a  "),
        "char(3) lost its padding",
    );

    let (simple, _) = s.simple(SQL).await.expect("simple");
    expect(
        &mut failures,
        &simple[0].rows[0] == row,
        "the simple protocol printed other text",
    );
    line("simple protocol", "the same characters for every column");

    title("text: the session's settings decide the text, and the server reports them");
    s.simple("SET TimeZone = 'Asia/Seoul'; SET IntervalStyle = 'iso_8601'")
        .await
        .expect("set");
    let page = s
        .open(
            "SELECT '2026-11-21 10:00:00+00'::timestamptz, '1 day 02:03:04.5'::interval",
            &[],
            0,
        )
        .await
        .unwrap();
    line(
        "after SET TimeZone and IntervalStyle",
        format!("{:?}", page.rows[0]),
    );
    let reported: Vec<String> = s.asyncs.iter().map(|a| format!("{a:?}")).collect();
    line("ParameterStatus that arrived", reported.join("; "));
    expect(
        &mut failures,
        page.rows[0][0].as_deref() == Some("2026-11-21 19:00:00+09"),
        "TimeZone did not apply",
    );
    s.terminate().await.ok();
    verdict(&failures)
}
