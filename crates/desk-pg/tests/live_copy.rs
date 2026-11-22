//! COPY at scale on a real server (PG-23), as the database plugin streams it: 1,000,000 rows out
//! in pages of 1 MiB and in again in chunks of 1 MiB at most, nothing held whole, the copy equal to
//! the source by EXCEPT ALL both ways; a malformed line's error names its line; a COPY out closed
//! and a COPY in failed mid-way leave the session ready for the next statement.

#[macro_use]
mod common;

use common::{open, run, value};
use desk_pg::{COPY_CHUNK, CopyInput, Limits, Session, Transaction};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";
const ROWS: u64 = 1_000_000;

fn pages() -> Limits {
    Limits::new(None, Some(COPY_CHUNK as u64)).unwrap()
}

fn chunk(data: &[u8]) -> CopyInput {
    CopyInput {
        data: Some(data.to_vec()),
        ..CopyInput::default()
    }
}

/// Every chunk of a COPY in, cut at COPY_CHUNK bytes wherever that falls.
fn send(session: &Session, data: &[u8]) {
    for part in data.chunks(COPY_CHUNK) {
        let page = session.copy(chunk(part)).unwrap();
        assert!(page.more, "{:?}", page.error);
    }
}

#[test]
fn a_million_rows_out_and_in_in_bounded_chunks() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(
        session,
        "CREATE TEMP TABLE src (id int8, name text, note text, n numeric)",
    );
    run(
        session,
        &format!(
            "INSERT INTO src SELECT g, md5(g::text), CASE WHEN g % 7 = 0 THEN NULL ELSE E'a\\tb \\\\ ' || repeat('é', g % 5) END, g / 7.0 FROM generate_series(1, {ROWS}) g"
        ),
    );
    run(session, "CREATE TEMP TABLE dst (LIKE src)");

    let mut page = session
        .run(common::sql("COPY src TO STDOUT"), pages())
        .unwrap();
    let mut file = Vec::new();
    let (mut count, mut largest) = (1, 0);
    loop {
        let data = page.data.take().unwrap_or_default();
        largest = largest.max(data.len());
        file.extend_from_slice(&data);
        if !page.more {
            break;
        }
        page = session.fetch(pages(), false).unwrap();
        count += 1;
    }
    assert_eq!(page.row_count, Some(ROWS));
    // A page is full at 1 MiB and holds the row that filled it.
    assert!(largest <= COPY_CHUNK + 1024, "{largest}");
    assert!(count > 50, "{count} pages");

    let start = run(session, "COPY dst FROM STDIN");
    assert!(start.more);
    send(session, &file);
    let done = session
        .copy(CopyInput {
            done: true,
            ..CopyInput::default()
        })
        .unwrap();
    assert_eq!(done.row_count, Some(ROWS));
    let differ = "SELECT (SELECT count(*) FROM (TABLE src EXCEPT ALL TABLE dst) a) + (SELECT count(*) FROM (TABLE dst EXCEPT ALL TABLE src) b)";
    assert_eq!(value(session, differ), Some("0".to_owned()));
}

#[test]
fn a_malformed_line_names_its_line() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(session, "CREATE TEMP TABLE t (id int8, name text)");
    run(session, "COPY t FROM STDIN");
    let bad = session
        .copy(CopyInput {
            done: true,
            ..chunk(b"1\tone\n2\ttwo\nthree\tthree\n")
        })
        .unwrap();
    let error = bad.error.expect("the bad line");
    assert_eq!(error.code(), "22P02");
    let place = error.field(b'W').unwrap_or_default();
    assert!(place.contains("line 3"), "{place}");
    assert_eq!(bad.transaction, Some(Transaction::Idle));
    assert_eq!(
        value(session, "SELECT count(*) FROM t"),
        Some("0".to_owned())
    );
}

#[test]
fn a_copy_ended_mid_way_leaves_the_session_ready() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let rows = format!("COPY (SELECT g, md5(g::text) FROM generate_series(1, {ROWS}) g) TO STDOUT");
    let first = session.run(common::sql(&rows), pages()).unwrap();
    assert!(first.more);
    assert!(session.fetch(pages(), false).unwrap().more);
    let closed = session.fetch(pages(), true).unwrap();
    assert_eq!(
        (closed.more, closed.transaction),
        (false, Some(Transaction::Idle))
    );
    assert_eq!(value(session, "SELECT 41 + 1"), Some("42".to_owned()));

    run(session, "CREATE TEMP TABLE t (id int8, name text)");
    run(session, "COPY t FROM STDIN");
    send(session, &b"1\tone\n".repeat(400_000));
    let failed = session
        .copy(CopyInput {
            fail: Some("cancelled".to_owned()),
            ..CopyInput::default()
        })
        .unwrap();
    assert_eq!(failed.error.unwrap().code(), "57014");
    assert_eq!(
        value(session, "SELECT count(*) FROM t"),
        Some("0".to_owned())
    );
}
