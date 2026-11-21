//! Sessions against a real server: `ENDUE_DB_TEST_POSTGRES` names it (a `postgresql://` URI of a
//! server without TLS); every test skips when it is unset. Sign-in, pages, columns, values, errors.

#[macro_use]
mod common;

use common::{Events, limits, open, run, sql, value};
use desk_pg::{Auth, Error, Limits, Statement, TlsMode, Transaction};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";

#[test]
fn signs_in_with_scram_and_reports_the_server() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    assert_eq!(opened.auth, Auth::ScramSha256);
    assert!(opened.pid > 0);
    assert_eq!(
        opened.tls, None,
        "prefer falls back to plain TCP on a server without TLS"
    );
    let parameter = |name: &str| {
        let found = opened.parameters.iter().find(|(n, _)| n == name);
        found.map(|(_, v)| v.clone())
    };
    assert!(parameter("server_version").is_some());
    assert_eq!(parameter("client_encoding").as_deref(), Some("UTF8"));
    assert_eq!(parameter("application_name").as_deref(), Some("endue Desk"));
    let pid = value(&opened.session, "SELECT pg_backend_pid()");
    assert_eq!(pid, Some(opened.pid.to_string()));

    let mut wrong = config.clone();
    wrong.password = Some("not the password".to_owned());
    match desk_pg::open(wrong, Events::default().sink()) {
        Err(Error::Refused(error)) => assert_eq!(error.code(), "28P01"),
        other => panic!("a wrong password is refused: {:?}", other.err()),
    }
    let mut none = config.clone();
    none.password = None;
    let answer = desk_pg::open(none, Events::default().sink());
    assert!(matches!(answer.err(), Some(Error::NeedsPassword)));
    let mut tls = config.clone();
    tls.tls = TlsMode::Require;
    assert!(matches!(
        desk_pg::open(tls, Events::default().sink()).err(),
        Some(Error::Io(_))
    ));
    let mut nobody = config.clone();
    nobody.port = 1;
    assert!(matches!(
        desk_pg::open(nobody, Events::default().sink()).err(),
        Some(Error::Io(_))
    ));
}

#[test]
fn pages_are_exact() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let query = sql("SELECT g FROM generate_series(1, 2500) g");
    let first = session.run(query, limits(1000)).unwrap();
    assert_eq!(
        (first.rows.len(), first.more, first.tag.as_deref()),
        (1000, true, None)
    );
    assert_eq!(first.rows[0], vec![Some("1".to_owned())]);
    assert!(session.more());
    let second = session.fetch(limits(1000), false).unwrap();
    assert_eq!((second.rows.len(), second.more), (1000, true));
    assert_eq!(second.rows[0], vec![Some("1001".to_owned())]);
    assert_eq!(second.columns, None);
    let last = session.fetch(limits(1000), false).unwrap();
    assert_eq!((last.rows.len(), last.more), (500, false));
    assert_eq!(last.tag.as_deref(), Some("SELECT 2500"));
    assert_eq!(last.row_count, Some(2500));
    assert_eq!(last.transaction, Some(Transaction::Idle));
    assert!(!session.more());

    let exact = session.run(
        sql("SELECT g FROM generate_series(1, 1000) g"),
        limits(1000),
    );
    let exact = exact.unwrap();
    assert_eq!(
        (exact.rows.len(), exact.more),
        (1000, false),
        "a full last page has no more"
    );

    let wide = sql("SELECT repeat('x', 100000) FROM generate_series(1, 3)");
    let bytes = Limits::new(None, Some(65_536)).unwrap();
    let mut pages = vec![session.run(wide, bytes).unwrap()];
    while pages.last().unwrap().more {
        pages.push(session.fetch(bytes, false).unwrap());
    }
    let sizes: Vec<usize> = pages.iter().map(|p| p.rows.len()).collect();
    assert_eq!(sizes, vec![1, 1, 1], "a page holds one row past its bytes");

    let huge = session.run(
        sql("SELECT repeat('x', 70 * 1024 * 1024)"),
        Limits::default(),
    );
    assert!(
        matches!(huge, Err(Error::TooLarge(_))),
        "a row over 64 MiB ends its result"
    );
    assert_eq!(value(session, "SELECT 1"), Some("1".to_owned()));
}

#[test]
fn columns_carry_type_and_origin() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(
        session,
        "CREATE TEMP TABLE c (id int4 PRIMARY KEY, name varchar(20))",
    );
    let page = run(session, "SELECT id, name, 1 + 1 AS two FROM c");
    let columns = page.columns.expect("described");
    let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["id", "name", "two"]);
    assert_eq!((columns[0].type_oid, columns[0].type_size), (23, 4));
    assert_ne!(columns[0].table_oid, 0);
    assert_eq!((columns[0].column_number, columns[1].column_number), (1, 2));
    assert_eq!((columns[1].type_oid, columns[1].type_modifier), (1043, 24));
    assert_eq!((columns[2].table_oid, columns[2].column_number), (0, 0));
    assert_eq!(page.rows.len(), 0);
    assert_eq!(page.row_count, Some(0));
    let none = run(session, "SET search_path = public");
    assert_eq!(
        (none.columns, none.tag.as_deref(), none.row_count),
        (None, Some("SET"), None)
    );
}

#[test]
fn values_are_the_servers_text() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let page = run(
        session,
        "SELECT NULL::text, 1.50::numeric, true, '2024-01-02'::date, '{1,2}'::int[], 'é'::text, \
         '\\x01ff'::bytea, ''::text",
    );
    let text = |v: &str| Some(v.to_owned());
    let expected = vec![
        None,
        text("1.50"),
        text("t"),
        text("2024-01-02"),
        text("{1,2}"),
        text("é"),
        text("\\x01ff"),
        text(""),
    ];
    assert_eq!(page.rows, vec![expected]);
    let bound = Statement {
        sql: "SELECT $1::int + 1, $2::text IS NULL, $3 + 1".to_owned(),
        params: vec![Some("41".to_owned()), None, Some("1".to_owned())],
        types: vec![0, 0, 23],
    };
    let page = session.run(bound, Limits::default()).unwrap();
    assert_eq!(page.rows, vec![vec![text("42"), text("t"), text("2")]]);
    assert_eq!(page.columns.unwrap()[2].type_oid, 23);
    let empty = run(session, "");
    assert_eq!((empty.tag.as_deref(), empty.columns), (Some(""), None));
}

#[test]
fn errors_carry_every_field() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    let page = session.run(sql("SELECT 1/0"), Limits::default()).unwrap();
    let error = page.error.expect("the server's error");
    assert_eq!((error.severity(), error.code()), ("ERROR", "22012"));
    assert_eq!(error.message(), "division by zero");
    assert_eq!(error.field(b'S'), Some("ERROR"));
    assert!(
        error.field(b'F').is_some() && error.field(b'L').is_some() && error.field(b'R').is_some()
    );
    assert_eq!(page.transaction, Some(Transaction::Idle));

    let syntax = session
        .run(sql("SELECT 1 FROMM x"), Limits::default())
        .unwrap();
    let syntax = syntax.error.unwrap();
    assert_eq!((syntax.code(), syntax.field(b'P')), ("42601", Some("16")));

    run(
        session,
        "CREATE TEMP TABLE e (id int CONSTRAINT e_positive CHECK (id > 0))",
    );
    let check = session
        .run(sql("INSERT INTO e VALUES (-1)"), Limits::default())
        .unwrap();
    let check = check.error.unwrap();
    assert_eq!(check.code(), "23514");
    assert_eq!(
        (check.field(b't'), check.field(b'n')),
        (Some("e"), Some("e_positive"))
    );
    assert!(check.field(b's').unwrap().starts_with("pg_temp"));
    assert!(check.field(b'D').is_some(), "the failing row");

    let raised = "DO $$ BEGIN RAISE EXCEPTION 'boom' USING DETAIL = 'the detail', \
                  HINT = 'the hint', ERRCODE = 'P0001'; END $$";
    let raised = session
        .run(sql(raised), Limits::default())
        .unwrap()
        .error
        .unwrap();
    assert_eq!((raised.code(), raised.message()), ("P0001", "boom"));
    assert_eq!(
        (raised.field(b'D'), raised.field(b'H')),
        (Some("the detail"), Some("the hint"))
    );
    assert!(raised.field(b'W').unwrap().contains("PL/pgSQL"));

    run(session, "BEGIN");
    let failed = session.run(sql("SELECT 1/0"), Limits::default()).unwrap();
    assert_eq!(failed.transaction, Some(Transaction::Failed));
    assert_eq!(session.transaction(), Transaction::Failed);
    assert_eq!(
        run(session, "ROLLBACK").transaction,
        Some(Transaction::Idle)
    );
    assert_eq!(run(session, "BEGIN").transaction, Some(Transaction::Open));
    run(session, "COMMIT");
}

#[test]
fn read_only_refuses_writes() {
    let mut config = live!(VAR);
    config.read_only = true;
    config.settings = vec![("default_transaction_read_only".to_owned(), "off".to_owned())];
    let (opened, _) = open(&config);
    let session = &opened.session;
    assert_eq!(
        value(session, "SHOW default_transaction_read_only"),
        Some("on".to_owned())
    );
    let write = session.run(sql("CREATE TABLE t440_written (id int)"), Limits::default());
    assert_eq!(write.unwrap().error.unwrap().code(), "25006");
    assert_eq!(value(session, "SELECT 2"), Some("2".to_owned()));
}
