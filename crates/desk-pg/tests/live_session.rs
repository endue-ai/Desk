//! Sessions against a real server, as `live.rs`: what arrives unasked, cancel, COPY, the password
//! file, and how results and sessions end.

#[macro_use]
mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::{Events, limits, open, run, sql, until, value};
use desk_pg::{CloseReason, CopyInput, Direction, Error, Event, Limits, Transaction};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";

#[test]
fn notices_and_notifications_arrive_as_they_come() {
    let config = live!(VAR);
    let (listener, events) = open(&config);
    let notices = "DO $$ BEGIN RAISE NOTICE 'first'; RAISE WARNING 'second'; END $$";
    run(&listener.session, notices);
    let said: Vec<(String, String)> = events
        .all()
        .iter()
        .filter_map(|e| match e {
            Event::Notice(n) => Some((n.severity().to_owned(), n.message().to_owned())),
            _ => None,
        })
        .collect();
    let said: Vec<(&str, &str)> = said.iter().map(|(s, m)| (s.as_str(), m.as_str())).collect();
    assert_eq!(said, [("NOTICE", "first"), ("WARNING", "second")]);

    run(&listener.session, "LISTEN t440_channel");
    let (sender, _) = open(&config);
    run(
        &sender.session,
        "SELECT pg_notify('t440_channel', 'the payload')",
    );
    let (pid, payload) = events.wait(|e| match e {
        Event::Notification {
            pid,
            channel,
            payload,
        } if channel == "t440_channel" => Some((*pid, payload.clone())),
        _ => None,
    });
    assert_eq!(
        (pid, payload.as_str()),
        (sender.pid, "the payload"),
        "while idle"
    );

    run(&listener.session, "SET application_name = 'renamed'");
    let renamed = events.wait(|e| match e {
        Event::Parameter { name, value } if name == "application_name" => Some(value.clone()),
        _ => None,
    });
    assert_eq!(renamed, "renamed");
}

#[test]
fn cancel_stops_the_statement_on_the_server() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = Arc::new(opened.session);
    session.cancel().expect("nothing runs: nothing to cancel");
    let running = session.clone();
    let start = Instant::now();
    let sleeper =
        std::thread::spawn(move || running.run(sql("SELECT pg_sleep(30)"), Limits::default()));
    until(|| session.running().then_some(()));
    std::thread::sleep(Duration::from_millis(300));
    let busy = session.run(sql("SELECT 1"), Limits::default());
    assert!(
        matches!(busy, Err(Error::Invalid(_))),
        "one statement at a time"
    );
    session.cancel().unwrap();
    let page = sleeper.join().unwrap().unwrap();
    assert_eq!(page.error.unwrap().code(), "57014");
    assert!(start.elapsed() < Duration::from_secs(10));
    let (watcher, _) = open(&config);
    let active = format!(
        "SELECT count(*) FROM pg_stat_activity WHERE pid = {} AND state = 'active'",
        opened.pid
    );
    assert_eq!(value(&watcher.session, &active), Some("0".to_owned()));
    assert_eq!(value(&session, "SELECT 1"), Some("1".to_owned()));
}

#[test]
fn copy_out_and_in() {
    let config = live!(VAR);
    let (opened, _) = open(&config);
    let session = &opened.session;
    run(session, "CREATE TEMP TABLE k (id int, name text)");
    let start = run(session, "COPY k FROM STDIN");
    let copy = start.copy.expect("a COPY");
    assert_eq!(
        (copy.direction, copy.binary, copy.columns, start.more),
        (Direction::In, false, 2, true)
    );
    assert!(session.more());
    let busy = session.run(sql("SELECT 1"), Limits::default());
    assert!(
        matches!(busy, Err(Error::Invalid(_))),
        "the COPY waits for its data"
    );
    let chunk = |data: &str| CopyInput {
        data: Some(data.as_bytes().to_vec()),
        ..CopyInput::default()
    };
    assert!(session.copy(chunk("1\tone\n")).unwrap().more);
    let done = session
        .copy(CopyInput {
            done: true,
            ..chunk("2\ttwo\n")
        })
        .unwrap();
    assert_eq!(
        (done.tag.as_deref(), done.row_count, done.more),
        (Some("COPY 2"), Some(2), false)
    );
    assert_eq!(done.transaction, Some(Transaction::Idle));

    let out = run(session, "COPY k TO STDOUT");
    assert_eq!(out.copy.unwrap().direction, Direction::Out);
    assert_eq!(out.data.as_deref(), Some(&b"1\tone\n2\ttwo\n"[..]));
    assert_eq!((out.more, out.tag.as_deref()), (false, Some("COPY 2")));

    let big = sql("COPY (SELECT g FROM generate_series(1, 100000) g) TO STDOUT");
    let bytes = Limits::new(None, Some(65_536)).unwrap();
    let mut pages = vec![session.run(big, bytes).unwrap()];
    while pages.last().unwrap().more {
        pages.push(session.fetch(bytes, false).unwrap());
    }
    assert!(pages.len() > 5);
    let all: Vec<u8> = pages.iter().flat_map(|p| p.data.clone().unwrap()).collect();
    let expected: String = (1..=100_000).map(|g| format!("{g}\n")).collect();
    assert_eq!(all, expected.into_bytes());
    assert_eq!(pages.last().unwrap().row_count, Some(100_000));

    let endless = sql("COPY (SELECT g FROM generate_series(1, 50000000) g) TO STDOUT");
    assert!(session.run(endless, bytes).unwrap().more);
    let closed = session.fetch(bytes, true).unwrap();
    assert_eq!(
        (closed.more, closed.transaction),
        (false, Some(Transaction::Idle))
    );
    assert_eq!(value(session, "SELECT 3"), Some("3".to_owned()));

    run(session, "COPY k FROM STDIN");
    let bad = session
        .copy(CopyInput {
            done: true,
            ..chunk("x\tbad\n")
        })
        .unwrap();
    assert_eq!(bad.error.unwrap().code(), "22P02");
    run(session, "COPY k FROM STDIN");
    let fail = CopyInput {
        fail: Some("stopped".to_owned()),
        ..CopyInput::default()
    };
    assert_eq!(session.copy(fail).unwrap().error.unwrap().code(), "57014");
    assert_eq!(
        value(session, "SELECT count(*) FROM k"),
        Some("2".to_owned())
    );
}

#[test]
fn a_password_file_answers_a_missing_password() {
    let mut config = live!(VAR);
    let password = config.password.take().unwrap();
    let folder = std::env::temp_dir().join(format!("desk-pg-live-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let file = folder.join("pgpass");
    let line = format!(
        "# a comment\n*:*:*:{}:{}\n",
        config.user,
        password.replace(':', "\\:")
    );
    std::fs::write(&file, line).unwrap();
    private(&file, 0o600);
    config.password_file = Some(file.clone());
    let (opened, _) = open(&config);
    assert_eq!(value(&opened.session, "SELECT 1"), Some("1".to_owned()));
    #[cfg(unix)]
    {
        private(&file, 0o644);
        let open = desk_pg::open(config.clone(), Events::default().sink());
        assert!(
            matches!(open.err(), Some(Error::NeedsPassword)),
            "a readable file is ignored"
        );
    }
    std::fs::remove_dir_all(&folder).unwrap();
}

fn private(file: &std::path::Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(file, std::fs::Permissions::from_mode(mode)).unwrap();
    }
    let _ = (file, mode);
}

#[test]
fn open_results_close_and_sessions_end() {
    let config = live!(VAR);
    let (opened, events) = open(&config);
    let session = &opened.session;
    assert!(
        session
            .run(sql("SELECT g FROM generate_series(1, 2500) g"), limits(100))
            .unwrap()
            .more
    );
    assert_eq!(
        value(session, "SELECT 'next'"),
        Some("next".to_owned()),
        "a new run closes it"
    );
    assert!(!session.more());
    assert!(matches!(
        session.fetch(limits(10), false),
        Err(Error::Invalid(_))
    ));
    assert!(
        session
            .run(sql("SELECT g FROM generate_series(1, 2500) g"), limits(100))
            .unwrap()
            .more
    );
    let closed = session.fetch(limits(10), true).unwrap();
    assert_eq!((closed.rows.len(), closed.more), (0, false));
    session.close(CloseReason::Closed);
    session.close(CloseReason::Revoked);
    let reason = events.wait(|e| match e {
        Event::Closed { reason, .. } => Some(*reason),
        _ => None,
    });
    assert_eq!(reason, CloseReason::Closed, "the first reason wins");
    assert!(session.closed());
    assert!(matches!(
        session.run(sql("SELECT 1"), Limits::default()),
        Err(Error::Closed)
    ));

    let (ended, events) = open(&config);
    let (killer, _) = open(&config);
    run(
        &killer.session,
        &format!("SELECT pg_terminate_backend({})", ended.pid),
    );
    let (reason, code) = events.wait(|e| match e {
        Event::Closed { reason, error, .. } => {
            Some((*reason, error.as_ref().map(|e| e.code().to_owned())))
        }
        _ => None,
    });
    assert_eq!(
        (reason, code.as_deref()),
        (CloseReason::Server, Some("57P01"))
    );
    assert_eq!(closes(&events), 1);

    let (encoded, events) = open(&config);
    let _ = encoded
        .session
        .run(sql("SET client_encoding = 'LATIN1'"), Limits::default());
    let reason = events.wait(|e| match e {
        Event::Closed { reason, .. } => Some(*reason),
        _ => None,
    });
    assert_eq!(reason, CloseReason::Encoding);

    let (dropped, events) = open(&config);
    drop(dropped);
    let reason = events.wait(|e| match e {
        Event::Closed { reason, .. } => Some(*reason),
        _ => None,
    });
    assert_eq!(reason, CloseReason::Desk);
}

fn closes(events: &Events) -> usize {
    std::thread::sleep(Duration::from_millis(200));
    events
        .all()
        .iter()
        .filter(|e| matches!(e, Event::Closed { .. }))
        .count()
}
