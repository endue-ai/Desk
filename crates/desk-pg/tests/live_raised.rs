//! A call's notices as they are raised (PG-25, ADR 0358), and LISTEN on an idle session, against a
//! real server: each notice reaches the sink as `CallNotice` while its statement still runs, in
//! order, with the number of the call whose page carries it too; a NOTIFY from another session of
//! the same database reaches a listening session while it is idle, and UNLISTEN stops it.

#[macro_use]
mod common;

use std::time::Duration;

use common::{open, run, until};
use desk_pg::Event;

const VAR: &str = "ENDUE_DB_TEST_POSTGRES";

fn raised(events: &common::Events) -> Vec<(u64, String)> {
    let all = events.all();
    let raised = all.iter().filter_map(|e| match e {
        Event::CallNotice { call, notice } => Some((*call, notice.message().to_owned())),
        _ => None,
    });
    raised.collect()
}

#[test]
fn a_statements_notices_arrive_as_they_are_raised() {
    let config = live!(VAR);
    let (opened, events) = open(&config);
    let session = &opened.session;
    run(session, "SELECT 1");
    let slow = "DO $$ BEGIN RAISE NOTICE 'one'; PERFORM pg_sleep(0.2); \
                RAISE WARNING 'two'; PERFORM pg_sleep(0.2); RAISE NOTICE 'three'; \
                PERFORM pg_sleep(2); END $$";
    std::thread::scope(|scope| {
        let running = scope.spawn(|| run(session, slow));
        let heard = until(|| Some(raised(&events)).filter(|r| r.len() == 3));
        assert!(
            !running.is_finished(),
            "they came before the statement ended"
        );
        let page = running.join().expect("the run answers");
        let calls: Vec<u64> = heard.iter().map(|(call, _)| *call).collect();
        assert_eq!(calls, [page.call; 3], "the call that heard them");
        let texts: Vec<&str> = heard.iter().map(|(_, text)| text.as_str()).collect();
        assert_eq!(texts, ["one", "two", "three"]);
        let kept: Vec<&str> = page.notices.iter().map(|n| n.message()).collect();
        assert_eq!(
            kept,
            ["one", "two", "three"],
            "the page is still the record"
        );
        assert!(page.call > 1, "the SELECT before was a call of its own");
    });
    let next = run(session, "SELECT 2");
    assert_eq!(
        raised(&events).len(),
        3,
        "a call that hears none sends none"
    );
    assert!(next.call > 1);
}

#[test]
fn a_listening_session_hears_notify_while_idle_and_unlisten_stops_it() {
    let config = live!(VAR);
    let (listener, events) = open(&config);
    let (sender, _) = open(&config);
    run(&listener.session, "LISTEN t458_jobs");
    run(&sender.session, "NOTIFY t458_jobs, 'first'");
    let (pid, channel, payload) = events.wait(|e| match e {
        Event::Notification {
            pid,
            channel,
            payload,
        } => Some((*pid, channel.clone(), payload.clone())),
        _ => None,
    });
    assert_eq!((channel.as_str(), payload.as_str()), ("t458_jobs", "first"));
    assert_eq!(pid, sender.pid, "the sender's process");

    run(&listener.session, "UNLISTEN t458_jobs");
    run(&sender.session, "NOTIFY t458_jobs, 'second'");
    std::thread::sleep(Duration::from_millis(500));
    let heard = events.all();
    let second = heard
        .iter()
        .any(|e| matches!(e, Event::Notification { payload, .. } if payload == "second"));
    assert!(!second, "UNLISTEN stopped it");
}
