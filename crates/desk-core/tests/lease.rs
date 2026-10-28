//! Session leases against examples/brain-echo: acquire, release, expiry and takeover. A session is
//! written by one desk at a time; opening it on another desk takes the lease over and the previous
//! desk becomes read-only.

mod common;

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use common::Echo;
use desk_brain::{Brain, BrainFailure, ClientInfo, CreateSessionRequest, LeaseHolder};
use desk_brain_endue::HttpBrain;
use desk_core::{LeaseClient, LeaseError};

fn brain(echo: &Echo) -> Arc<HttpBrain> {
    Arc::new(HttpBrain::new(echo.url()).unwrap())
}

fn session(brain: &HttpBrain) -> String {
    let request = CreateSessionRequest {
        title: None,
        client: ClientInfo {
            name: "lease tests".to_owned(),
            version: "0".to_owned(),
        },
    };
    brain.create_session(&request).unwrap().id
}

/// A desk holding leases of five brain seconds (100 ms with the test clock).
fn desk(brain: &Arc<HttpBrain>, id: &str) -> LeaseClient {
    let holder = LeaseHolder {
        desk_id: id.to_owned(),
        name: None,
    };
    LeaseClient::new(brain.clone(), holder, 5)
}

#[test]
fn acquiring_makes_this_desk_the_writer() {
    let echo = Echo::start();
    let brain = brain(&echo);
    let s = session(&brain);
    let mut a = desk(&brain, "desk-a");
    let lease = a.acquire(&s, false).unwrap().clone();
    assert_eq!(lease.holder.desk_id, "desk-a");
    assert_eq!(brain.get_lease(&s).unwrap().lease_id, lease.lease_id);
    assert_eq!(a.ensure().unwrap(), lease.lease_id);
    assert!(!a.is_read_only());

    let mut b = desk(&brain, "desk-b");
    match b.acquire(&s, false) {
        Err(LeaseError::ReadOnly {
            holder: Some(holder),
        }) => assert_eq!(holder.desk_id, "desk-a"),
        other => panic!("expected read-only, got {other:?}"),
    }
    assert!(b.is_read_only());
}

#[test]
fn releasing_lets_another_desk_in_without_a_takeover() {
    let echo = Echo::start();
    let brain = brain(&echo);
    let s = session(&brain);
    let mut a = desk(&brain, "desk-a");
    a.acquire(&s, false).unwrap();
    a.release().unwrap();
    assert!(a.lease().is_none());
    assert!(!a.is_read_only());
    assert!(matches!(
        brain.get_lease(&s),
        Err(BrainFailure::Refused { status: 404, .. })
    ));

    let mut b = desk(&brain, "desk-b");
    assert_eq!(b.acquire(&s, false).unwrap().holder.desk_id, "desk-b");
}

#[test]
fn an_expired_lease_is_free_for_any_desk() {
    let echo = Echo::start();
    let brain = brain(&echo);
    let s = session(&brain);
    let mut a = desk(&brain, "desk-a");
    a.acquire(&s, false).unwrap();
    thread::sleep(Duration::from_millis(250));
    assert!(matches!(a.renew(), Err(LeaseError::Expired)));
    assert!(a.lease().is_none());
    assert!(!a.is_read_only());

    let mut b = desk(&brain, "desk-b");
    assert_eq!(b.acquire(&s, false).unwrap().holder.desk_id, "desk-b");
}

#[test]
fn a_takeover_leaves_the_previous_desk_read_only() {
    let echo = Echo::start();
    let brain = brain(&echo);
    let s = session(&brain);
    let mut a = desk(&brain, "desk-a");
    a.acquire(&s, false).unwrap();

    let mut b = desk(&brain, "desk-b");
    assert_eq!(b.acquire(&s, true).unwrap().holder.desk_id, "desk-b");
    assert!(matches!(a.renew(), Err(LeaseError::ReadOnly { .. })));
    assert!(a.is_read_only());
    assert!(matches!(a.ensure(), Err(LeaseError::ReadOnly { .. })));
    assert_eq!(brain.get_lease(&s).unwrap().holder.desk_id, "desk-b");
}
