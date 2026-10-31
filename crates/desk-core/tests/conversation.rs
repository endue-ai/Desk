//! brain.say against examples/brain-echo: the echo comes back as brain.turn events, the echo tool's
//! round trip runs inside the core, an unreachable brain gets the offline line and the turn resumes
//! on reconnection, a desk whose session was taken over answers read-only, and the session survives
//! a restart.

mod common;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use common::{Echo, free_port};
use desk_brain_endue::HttpBrain;
use desk_bridge::{
    BrainConversePermission, BrainTurnData, BrainTurnKind, BridgeEvent, BridgeRequest,
    BridgeResponse, ErrorCode, Permission,
};
use desk_core::{BrainOptions, Core, OFFLINE_LINE, READ_ONLY_LINE, Roots};
use serde_json::json;

const ERIS: &str = "endue.eris";

fn core(url: &str, state_file: Option<PathBuf>) -> Core {
    let brain = Arc::new(HttpBrain::new(url).unwrap());
    let options = BrainOptions {
        state_file,
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_brain(brain, options);
    core.grant(
        ERIS,
        Permission::BrainConverse(BrainConversePermission {
            permission: Default::default(),
        }),
    );
    core
}

fn request(text: &str) -> BridgeRequest {
    serde_json::from_value(json!({
        "id": 1,
        "method": "brain.say",
        "params": { "text": text, "scope": { "permission": "brain:converse" } }
    }))
    .unwrap()
}

/// Say `text` as Eris; returns the turn id.
fn say(core: &Core, text: &str) -> String {
    match core.handle(ERIS, request(text)) {
        BridgeResponse::BridgeSuccess(ok) => ok.result["turnId"].as_str().unwrap().to_owned(),
        BridgeResponse::BridgeFailure(err) => panic!("brain.say failed: {:?}", err.error),
    }
}

/// The brain.turn events of `turn`, up to and including `last`.
fn until(events: &Receiver<BridgeEvent>, turn: &str, last: BrainTurnKind) -> Vec<BrainTurnData> {
    let mut seen = Vec::new();
    loop {
        let event = events
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| panic!("no {last:?} for {turn}; saw {seen:?}"));
        if let BridgeEvent::BrainTurn(event) = event
            && event.data.turn_id == turn
        {
            let kind = event.data.kind;
            seen.push(event.data);
            if kind == last || kind == BrainTurnKind::Error {
                return seen;
            }
        }
    }
}

fn kinds(data: &[BrainTurnData]) -> Vec<BrainTurnKind> {
    data.iter().map(|d| d.kind).collect()
}

fn answer(data: &[BrainTurnData]) -> String {
    data.iter()
        .filter(|d| d.kind == BrainTurnKind::Delta)
        .filter_map(|d| d.text.as_deref())
        .collect()
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A `brain.json` in a folder of its own; the counter keeps tests running in parallel apart.
fn temp_file() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir()
        .join(format!("desk-brain-{}-{nanos}-{n}", std::process::id()))
        .join("brain.json")
}

#[test]
fn the_echo_comes_back_as_brain_turn_events() {
    let echo = Echo::start();
    let core = core(echo.url(), None);
    let events = core.events().subscribe();
    let turn = say(&core, "hello");
    let data = until(&events, &turn, BrainTurnKind::Completed);
    assert_eq!(data.first().map(|d| d.kind), Some(BrainTurnKind::Started));
    assert_eq!(data.last().map(|d| d.kind), Some(BrainTurnKind::Completed));
    assert_eq!(answer(&data), "hello");
}

#[test]
fn brain_say_needs_brain_converse() {
    let echo = Echo::start();
    let core = core(echo.url(), None);
    match core.handle("endue.other", request("hello")) {
        BridgeResponse::BridgeFailure(err) => {
            assert_eq!(err.error.code, ErrorCode::PermissionDenied);
            assert!(matches!(
                err.error.permission,
                Some(Permission::BrainConverse(_))
            ));
        }
        other => panic!("expected permission_denied, got {other:?}"),
    }
}

#[test]
fn the_echo_tool_round_trip_runs_inside_the_core() {
    let echo = Echo::start();
    let core = core(echo.url(), None);
    let events = core.events().subscribe();
    let turn = say(&core, "tool: ping");
    let data = until(&events, &turn, BrainTurnKind::Completed);
    assert_eq!(
        answer(&data),
        "Let me ask the echo tool. The echo tool said: ping"
    );
    let completed = kinds(&data)
        .into_iter()
        .filter(|k| *k == BrainTurnKind::Completed)
        .count();
    assert_eq!(completed, 1, "a tool call does not end the turn: {data:?}");
}

#[test]
fn an_unreachable_brain_gets_the_offline_line_and_the_turn_resumes() {
    let port = free_port();
    let core = core(&format!("http://127.0.0.1:{port}/v0"), None);
    let events = core.events().subscribe();
    let turn = say(&core, "hello");
    let offline = until(&events, &turn, BrainTurnKind::Offline);
    assert_eq!(
        offline.last().and_then(|d| d.text.as_deref()),
        Some(
            "I can't reach endue right now. Check your connection, and I'll pick up where we left off."
        )
    );
    assert_eq!(OFFLINE_LINE, offline[0].text.as_deref().unwrap());

    let _echo = Echo::start_on(port);
    let rest = until(&events, &turn, BrainTurnKind::Completed);
    assert_eq!(rest.first().map(|d| d.kind), Some(BrainTurnKind::Online));
    assert_eq!(answer(&rest), "hello");
}

#[test]
fn a_desk_whose_session_was_taken_over_is_read_only() {
    let echo = Echo::start();
    let a = core(echo.url(), None);
    let b = core(echo.url(), None);
    let on_a = a.events().subscribe();
    let turn = say(&a, "hello");
    until(&on_a, &turn, BrainTurnKind::Completed);
    let session = a.brain_session().expect("desk a remembers its session");

    b.open_session(&session).unwrap();
    let turn = say(&a, "still there?");
    let data = until(&on_a, &turn, BrainTurnKind::Error);
    assert_eq!(data.last().map(|d| d.kind), Some(BrainTurnKind::Error));
    assert_eq!(
        data.last().and_then(|d| d.text.as_deref()),
        Some(READ_ONLY_LINE)
    );

    let on_b = b.events().subscribe();
    let turn = say(&b, "hello from b");
    let data = until(&on_b, &turn, BrainTurnKind::Completed);
    assert_eq!(answer(&data), "hello from b");
    assert_eq!(b.brain_session().as_deref(), Some(session.as_str()));
}

#[test]
fn the_session_survives_a_restart() {
    let echo = Echo::start();
    let file = temp_file();
    let first = core(echo.url(), Some(file.clone()));
    let events = first.events().subscribe();
    let turn = say(&first, "hello");
    until(&events, &turn, BrainTurnKind::Completed);
    let session = first.brain_session().unwrap();
    drop(first);

    let again = core(echo.url(), Some(file));
    assert_eq!(again.brain_session().as_deref(), Some(session.as_str()));
    let events = again.events().subscribe();
    let turn = say(&again, "back again");
    let data = until(&events, &turn, BrainTurnKind::Completed);
    assert_eq!(answer(&data), "back again");
    assert_eq!(again.brain_session().as_deref(), Some(session.as_str()));
}
