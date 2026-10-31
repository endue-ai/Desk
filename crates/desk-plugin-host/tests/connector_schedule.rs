//! When the connector host syncs: on the manifest's interval on an injected clock, at once on
//! demand, with backoff after failures, through every status (`connected`, `syncing`, `stale`,
//! `error`, `paused`), and on its own scheduler thread. Part of the connector host's acceptance
//! tests with `connector.rs`, split for the 400-line rule.

mod common;

use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use common::{Desk, Folder, HELLO, Sent, at, hello_connector, ids, ran, state};
use desk_bridge::ConnectorState;
use desk_plugin_host::{Limits, PluginError};

#[test]
fn syncs_follow_the_manifest_interval_on_an_injected_clock() {
    let (desk, notes, work) = (Desk::new(Limits::default()), Folder::new(), Folder::new());
    notes.write("a.md", "# A\n", -60);
    work.write("w.md", "# W\n", -60);
    desk.hello("notes", &notes);
    assert_eq!(desk.tick_at(0), ran(&[(HELLO, "notes")]));

    desk.clock.set(100);
    desk.connectors
        .create_instance(HELLO, "work", work.settings())
        .unwrap();
    desk.sink.take();
    assert_eq!(desk.tick_at(100), ran(&[(HELLO, "work")]));
    let sent = desk.sink.take();
    let [Sent::Upsert(items)] = sent.as_slice() else {
        panic!("{sent:?}")
    };
    assert_eq!(items[0]["source"]["instance"], "work");

    assert_eq!(desk.tick_at(299), ran(&[]));
    assert_eq!(desk.tick_at(300), ran(&[(HELLO, "notes")]));
    desk.clock.set(310);
    let synced = desk.connectors.sync_now(HELLO, "notes").unwrap();
    assert_eq!(synced.state, ConnectorState::Connected);
    assert_eq!(synced.last_sync_at, Some(at(310)));
    assert_eq!(desk.tick_at(399), ran(&[]));
    assert_eq!(desk.tick_at(400), ran(&[(HELLO, "work")]));
    assert_eq!(desk.tick_at(609), ran(&[]));
    assert_eq!(desk.tick_at(610), ran(&[(HELLO, "notes")]));
}

#[test]
fn a_failing_sync_backs_off_and_a_success_resets_it() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.delete();
    let created = desk.hello("notes", &notes);
    assert_eq!(created.state, ConnectorState::Error);
    let message = created.error.unwrap().message;
    assert!(message.contains("not-found"), "{message}");

    let tried = [0, 10, 29, 30, 60, 89, 90, 150, 209].into_iter();
    let attempts: Vec<i64> = tried.filter(|&t| !desk.tick_at(t).is_empty()).collect();
    assert_eq!(attempts, [0, 30, 90]);
    let (now, message) = state(&desk, HELLO, "notes");
    assert_eq!(now, ConnectorState::Error);
    assert!(message.contains("not-found"), "{message}");

    notes.create();
    notes.write("a.md", "# A\n", 0);
    assert_eq!(desk.tick_at(210), ran(&[(HELLO, "notes")]));
    assert_eq!(state(&desk, HELLO, "notes").0, ConnectorState::Connected);
    assert_eq!(desk.tick_at(509), ran(&[]));
    assert_eq!(desk.tick_at(510), ran(&[(HELLO, "notes")]));
}

#[test]
fn status_moves_between_connected_syncing_error_and_paused() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.write("a.md", "# A\n", -60);
    let changes = desk.connectors.watch_status();
    desk.hello("notes", &notes);
    desk.tick_at(0);
    notes.delete();
    desk.tick_at(300);
    desk.connectors.pause(HELLO, "notes").unwrap();
    let seen: Vec<_> = changes.try_iter().collect();
    for change in &seen {
        assert_eq!(
            (change.connector.as_str(), change.instance.as_str()),
            (HELLO, "notes")
        );
    }
    use ConnectorState::{Connected, Error, Paused, Syncing};
    let states: Vec<ConnectorState> = seen.iter().map(|c| c.status.state).collect();
    assert_eq!(
        states,
        [Connected, Syncing, Connected, Syncing, Error, Paused]
    );

    assert_eq!(desk.tick_at(600), ran(&[]));
    assert_eq!(desk.tick_at(100_000), ran(&[]));
    let refused = desk.connectors.sync_now(HELLO, "notes");
    assert!(
        matches!(refused, Err(PluginError::Paused(_))),
        "{refused:?}"
    );

    desk.connectors.resume(HELLO, "notes").unwrap();
    notes.create();
    notes.write("a.md", "# A\n", -60);
    assert_eq!(desk.connectors.tick(), ran(&[(HELLO, "notes")]));
    let states: Vec<ConnectorState> = changes.try_iter().map(|c| c.status.state).collect();
    assert_eq!(states, [Syncing, Connected]);
}

#[test]
fn an_instance_loaded_long_after_its_last_sync_is_stale_until_it_syncs() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.write("a.md", "# A\n", -60);
    desk.hello("notes", &notes);
    desk.tick_at(0);

    desk.clock.set(900);
    let fresh = desk.again();
    fresh.install(&hello_connector()).unwrap();
    let changes = fresh.watch_status();
    let status = fresh.status(HELLO, "notes").unwrap();
    assert_eq!(status.state, ConnectorState::Stale);
    assert_eq!(status.last_sync_at, Some(at(0)));
    assert_eq!(fresh.tick(), ran(&[(HELLO, "notes")]));
    let states: Vec<ConnectorState> = changes.try_iter().map(|c| c.status.state).collect();
    assert_eq!(states, [ConnectorState::Syncing, ConnectorState::Connected]);
}

#[test]
fn the_scheduler_thread_syncs_due_instances_without_a_tick_call() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.write("a.md", "# A\n", -60);
    desk.hello("notes", &notes);
    desk.connectors.start_scheduler(Duration::from_millis(20));

    let deadline = Instant::now() + Duration::from_secs(5);
    while desk.sink.is_empty() {
        assert!(Instant::now() < deadline, "the scheduler never synced");
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        ids(&desk.sink.take()),
        [("upsert", vec!["a.md".to_owned()])]
    );
    let Desk {
        connectors, sink, ..
    } = desk;
    drop(connectors);
    assert_eq!(
        Arc::strong_count(&sink),
        1,
        "the scheduler thread outlived its host"
    );
}
