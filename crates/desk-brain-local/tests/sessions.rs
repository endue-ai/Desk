//! Sessions and leases: local, kept in one JSON file, with the contract's lease rules.

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use desk_brain::{
    Brain, ClientInfo, CreateSessionRequest, LeaseHolder, LeaseRenewRequest, TextPart, TurnRequest,
    UserMessage,
};
use desk_brain_local::LocalBrain;
use serde_json::json;
use support::{
    Contract, FakeOllama, Folder, Reply, acquire, brain, closed_url, done, open, options, refused,
    say, turn,
};

fn new_session(brain: &LocalBrain, title: Option<&str>) -> String {
    brain
        .create_session(&CreateSessionRequest {
            title: title.map(str::to_owned),
            client: ClientInfo {
                name: "tests".to_owned(),
                version: "0".to_owned(),
            },
        })
        .unwrap()
        .id
}

#[test]
fn sessions_and_leases_survive_reopening_the_folder() {
    let contract = Contract::new();
    let folder = Folder::new();
    let first = FakeOllama::start(vec![Reply::Stream(vec![say("Hello"), done("stop")])]);
    let (id, lease, session) = {
        let brain = brain(&first.url, &folder);
        let id = new_session(&brain, Some("Notes"));
        let lease = brain
            .acquire_lease(&id, &acquire("desk-a", 60, false))
            .unwrap();
        turn(&brain, &id, &lease.lease_id, "hi").0.unwrap();
        let session = brain.get_session(&id).unwrap();
        contract.check("Session", &serde_json::to_value(&session).unwrap());
        contract.check("Lease", &serde_json::to_value(&lease).unwrap());
        assert_eq!(session.title.as_deref(), Some("Notes"));
        assert_eq!(session.lease.as_ref(), Some(&lease));
        (id, lease, session)
    };
    assert_eq!(folder.files(), ["local-brain.json"]);

    let second = FakeOllama::start(vec![Reply::Stream(vec![say("Again"), done("stop")])]);
    let brain = brain(&second.url, &folder);
    assert_eq!(brain.get_session(&id).unwrap(), session);
    assert_eq!(brain.get_lease(&id).unwrap(), lease);
    turn(&brain, &id, &lease.lease_id, "more").0.unwrap();
    assert_eq!(
        second.requests()[0].1["messages"],
        json!([
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": "Hello" },
            { "role": "user", "content": "more" },
        ])
    );
    assert_ne!(new_session(&brain, None), id, "ids are not reused");
}

#[test]
fn lease_conflicts_answer_with_the_contract_codes() {
    let contract = Contract::new();
    let folder = Folder::new();
    let now = Arc::new(AtomicU64::new(1_793_088_000_000));
    let clock = Arc::clone(&now);
    // Nothing listens, so a turn that got past the lease check would be Unreachable instead.
    let brain = LocalBrain::open(folder.path(), options(&closed_url()))
        .unwrap()
        .with_clock(move || clock.load(Ordering::SeqCst));
    let session = new_session(&brain, None);
    let a = brain
        .acquire_lease(&session, &acquire("desk-a", 60, false))
        .unwrap();
    contract.check("Lease", &serde_json::to_value(&a).unwrap());
    assert_eq!(a.acquired_at, "2026-10-27T08:00:00.000Z");
    assert_eq!(a.expires_at, "2026-10-27T08:01:00.000Z");

    match brain.acquire_lease(&session, &acquire("desk-b", 60, false)) {
        Err(desk_brain::BrainFailure::Refused { status, error }) => {
            assert_eq!(status, 409);
            contract.check("BrainError", &serde_json::to_value(&error).unwrap());
            assert_eq!(error.code, desk_brain::BrainErrorCode::LeaseHeld);
            assert_eq!(error.holder.map(|h| h.desk_id), Some("desk-a".to_owned()));
        }
        other => panic!("expected lease_held, got {other:?}"),
    }

    let b = brain
        .acquire_lease(&session, &acquire("desk-b", 60, true))
        .unwrap();
    assert_eq!(b.holder.desk_id, "desk-b");
    let renew = LeaseRenewRequest { ttl_seconds: None };
    assert_eq!(
        refused(brain.renew_lease(&session, &a.lease_id, &renew)),
        (409, "lease_lost".to_owned())
    );
    assert_eq!(
        refused(turn(&brain, &session, &a.lease_id, "hi").0),
        (409, "lease_lost".to_owned())
    );
    assert_eq!(
        refused(brain.release_lease(&session, &a.lease_id)),
        (409, "lease_lost".to_owned())
    );

    now.fetch_add(30_000, Ordering::SeqCst);
    let renewed = brain
        .renew_lease(&session, &b.lease_id, &LeaseRenewRequest { ttl_seconds: Some(5) })
        .unwrap();
    assert_eq!(renewed.ttl_seconds, 5);
    assert_eq!(renewed.expires_at, "2026-10-27T08:00:35.000Z");
    now.fetch_add(5_000, Ordering::SeqCst);
    assert_eq!(
        refused(brain.renew_lease(&session, &b.lease_id, &renew)),
        (409, "lease_expired".to_owned())
    );
    assert_eq!(refused(brain.get_lease(&session)), (404, "not_found".to_owned()));
    assert_eq!(brain.get_session(&session).unwrap().lease, None);

    let c = brain
        .acquire_lease(&session, &acquire("desk-c", 60, false))
        .unwrap();
    brain.release_lease(&session, &c.lease_id).unwrap();
    assert_eq!(refused(brain.get_lease(&session)), (404, "not_found".to_owned()));
}

#[test]
fn bad_requests_are_invalid_and_unknown_sessions_not_found() {
    let folder = Folder::new();
    let brain = brain(&closed_url(), &folder);
    let invalid = (400, "invalid_request".to_owned());
    let not_found = (404, "not_found".to_owned());

    assert_eq!(refused(brain.get_session("nope")), not_found);
    assert_eq!(
        refused(brain.acquire_lease("nope", &acquire("desk-a", 60, false))),
        not_found
    );
    let (session, lease) = open(&brain, "desk-a");
    let other = new_session(&brain, None);
    assert_eq!(
        refused(brain.acquire_lease(&other, &acquire("desk-a", 4, false))),
        invalid
    );
    assert_eq!(
        refused(brain.acquire_lease(&other, &acquire("desk-a", 3601, false))),
        invalid
    );
    let short = LeaseRenewRequest { ttl_seconds: Some(2) };
    assert_eq!(refused(brain.renew_lease(&session, &lease, &short)), invalid);
    let no_desk = desk_brain::LeaseAcquireRequest {
        holder: LeaseHolder {
            desk_id: String::new(),
            name: None,
        },
        ttl_seconds: 60,
        takeover: None,
    };
    assert_eq!(refused(brain.acquire_lease(&other, &no_desk)), invalid);

    let empty = TurnRequest {
        lease_id: lease.clone(),
        message: UserMessage {
            role: Default::default(),
            content: Vec::<TextPart>::new(),
        },
    };
    assert_eq!(
        refused(brain.create_turn(&session, &empty, &mut |_| {})),
        invalid
    );
    assert_eq!(
        refused(turn(&brain, "nope", &lease, "hi").0),
        not_found
    );
}
