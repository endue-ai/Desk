//! A session closed while its statement runs (ADR 0339): the statement is cancelled on the server
//! before Terminate, so nothing of the session stays behind. Against the server `live.rs` names.

#[macro_use]
mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::{open, sql, until, value};
use desk_pg::{CloseReason, Error, Event, Limits};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";

/// Whether the server still holds the backend `pid`, asked on a session of its own.
fn gone_within(config: &desk_pg::Config, pid: i32, wait: Duration) -> bool {
    let (watcher, _) = open(config);
    let held = format!("SELECT count(*) FROM pg_stat_activity WHERE pid = {pid}");
    let deadline = Instant::now() + wait;
    loop {
        if value(&watcher.session, &held) == Some("0".to_owned()) {
            return true;
        }
        if Instant::now() > deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn closing_a_running_statement_cancels_it_first() {
    let config = live!(VAR);
    let (opened, events) = open(&config);
    let pid = opened.pid;
    let session = Arc::new(opened.session);
    let running = session.clone();
    let sleeper =
        std::thread::spawn(move || running.run(sql("SELECT pg_sleep(30)"), Limits::default()));
    until(|| session.running().then_some(()));
    std::thread::sleep(Duration::from_millis(300));
    let start = Instant::now();
    session.close(CloseReason::Closed);
    let answered = sleeper.join().unwrap();
    assert!(matches!(answered, Err(Error::Closed)), "{answered:?}");
    let reason = events.wait(|e| match e {
        Event::Closed { reason, .. } => Some(*reason),
        _ => None,
    });
    assert_eq!(reason, CloseReason::Closed);
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    assert!(
        gone_within(&config, pid, Duration::from_secs(5)),
        "the statement ran on after its session closed"
    );
}

#[test]
fn closing_an_idle_session_ends_it_at_once() {
    let config = live!(VAR);
    let (opened, events) = open(&config);
    let pid = opened.pid;
    assert_eq!(value(&opened.session, "SELECT 1"), Some("1".to_owned()));
    opened.session.close(CloseReason::Closed);
    events.wait(|e| matches!(e, Event::Closed { .. }).then_some(()));
    assert!(gone_within(&config, pid, Duration::from_secs(5)));
}
