//! The episode Eris keeps of a turn (ADR 0096) is in her memory before the turn's completed event
//! goes out (#575), so whoever reads memory.list on completed finds it. The brain completes each
//! turn in words, then holds its stream open until the test lets go: while it holds, the desk cannot
//! have kept the episode, so it must not have said completed either. A turn whose episode cannot be
//! kept still completes.

mod common;
mod support;

use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::Echo;
use desk_brain::{
    Brain, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest,
    Session, ToolResultRequest, TurnEvent, TurnRequest,
};
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

/// brain-echo for sessions and leases. A turn echoes the line and completes, tells `completed` so,
/// and returns only once `release` says to (or the test is gone).
struct Holding {
    inner: HttpBrain,
    completed: Sender<()>,
    release: Mutex<Receiver<()>>,
}

macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

fn event(value: Value) -> TurnEvent {
    serde_json::from_value(value).unwrap()
}

impl Brain for Holding {
    pass! {
        create_session(request: &CreateSessionRequest) -> Session;
        get_session(session: &str) -> Session;
        get_lease(session: &str) -> Lease;
        acquire_lease(session: &str, request: &LeaseAcquireRequest) -> Lease;
        renew_lease(session: &str, lease: &str, request: &LeaseRenewRequest) -> Lease;
        release_lease(session: &str, lease: &str) -> ();
        submit_tool_result(session: &str, turn: &str, request: &ToolResultRequest,
            on: &mut dyn FnMut(TurnEvent)) -> ();
    }
    fn create_turn(
        &self,
        _: &str,
        request: &TurnRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let text = request.message.content[0].text.clone();
        on(event(json!({ "type": "turn.started", "turnId": "turn1" })));
        on(event(
            json!({ "type": "text.delta", "turnId": "turn1", "text": format!("echo: {text}") }),
        ));
        on(event(
            json!({ "type": "turn.completed", "turnId": "turn1", "stopReason": "end_turn" }),
        ));
        self.completed.send(()).unwrap();
        let _ = self.release.lock().unwrap().recv();
        Ok(())
    }
}

/// A shared core keeping memory under `home`, on a brain that holds each turn open; the brain's
/// "completed" signal and its release.
fn core_on(home: &Path, echo: &Echo) -> (Arc<Core>, Receiver<Delivery>, Receiver<()>, Sender<()>) {
    let (completed, said) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let brain = Arc::new(Holding {
        inner: HttpBrain::new(echo.url()).unwrap(),
        completed,
        release: Mutex::new(released),
    });
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(roots(home))
        .with_prompter(SayYes)
        .with_memory_dir(home.join("data/memory"))
        .with_brain(brain, options);
    let core = Arc::new(core);
    core.route_tools();
    for permission in ["brain:converse", "memory:read"] {
        grant(&core, "desk", json!({ "permission": permission }));
    }
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries, said, release)
}

fn say(core: &Core, text: &str) -> String {
    let params = json!({ "text": text, "scope": { "permission": "brain:converse" } });
    call(core, "desk", "brain.say", params).unwrap()["turnId"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn episodes(core: &Core) -> Vec<Value> {
    let params = json!({ "kind": "episode", "scope": { "permission": "memory:read" } });
    let listed = call(core, "desk", "memory.list", params).unwrap();
    listed["entries"].as_array().unwrap().clone()
}

/// The brain.turn kinds sent for `turn` among `seen`.
fn kinds(seen: &[Seen], turn: &str) -> Vec<String> {
    seen.iter()
        .filter(|s| s.name() == "brain.turn" && s.data()["turnId"] == turn)
        .map(|s| s.data()["kind"].as_str().unwrap_or_default().to_owned())
        .collect()
}

/// Wait for the turn's last event, completed or error, and say which.
fn end_of(deliveries: &Receiver<Delivery>, turn: &str) -> String {
    loop {
        let seen = wait_for(deliveries, "brain.turn");
        let kind = kinds(std::slice::from_ref(&seen), turn);
        if let Some(kind) = kind.into_iter().find(|k| k == "completed" || k == "error") {
            return kind;
        }
    }
}

#[test]
fn the_episode_is_in_memory_before_completed_is_sent() {
    let echo = Echo::start();
    let home = home("eris-episode-order");
    let (core, deliveries, said, release) = core_on(&home, &echo);

    let turn = say(&core, "what is on today?");
    said.recv_timeout(Duration::from_secs(10))
        .expect("the brain completes the turn within 10 s");
    // The brain holds its stream open, so the turn has kept no episode yet: what the desk has sent
    // so far must not say the turn completed.
    let sent = kinds(&drain(&deliveries), &turn);
    let kept = episodes(&core);
    release.send(()).unwrap();
    assert!(
        !sent.iter().any(|kind| kind == "completed") || kept.len() == 1,
        "completed went out before the episode was kept: sent {sent:?}, episodes {kept:?}"
    );

    assert_eq!(end_of(&deliveries, &turn), "completed");
    let kept = episodes(&core);
    assert_eq!(
        kept.len(),
        1,
        "the episode is in memory once completed is out"
    );
    assert_eq!(kept[0]["asked"], "what is on today?");
    assert_eq!(kept[0]["answered"], "echo: what is on today?");
    assert_eq!(kept[0]["by"], "eris");
}

#[test]
fn a_turn_whose_episode_cannot_be_kept_still_completes() {
    let echo = Echo::start();
    let home = home("eris-episode-unkept");
    let (core, deliveries, _said, release) = core_on(&home, &echo);
    // A file where the episodes folder goes: memory can no longer write (or read) episodes.
    std::fs::write(home.join("data/memory/episodes"), "not a folder").unwrap();
    release.send(()).unwrap();

    let turn = say(&core, "what is on today?");
    assert_eq!(end_of(&deliveries, &turn), "completed");
}
