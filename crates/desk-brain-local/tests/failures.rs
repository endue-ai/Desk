//! Failures: what each way of going wrong becomes, and that a failed request leaves the turn where
//! it was.

mod support;

use desk_brain::{BrainErrorCode, BrainFailure};
use serde_json::json;
use support::{
    FakeOllama, Folder, Reply, brain, calls, closed_url, done, kinds, open, refused, say, submit,
    text, turn,
};

#[test]
fn an_unreachable_server_is_unreachable() {
    let folder = Folder::new();
    let brain = brain(&closed_url(), &folder);
    // Sessions and leases are local, so they work without the server.
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "hi");
    assert!(
        matches!(result, Err(BrainFailure::Unreachable(_))),
        "{result:?}"
    );
    assert!(events.is_empty(), "{events:?}");
}

#[test]
fn an_error_body_is_refused() {
    let body = r#"{"error":"model \"test-model\" not found, try pulling it first"}"#;
    let ollama = FakeOllama::start(vec![Reply::Error(404, body.to_owned())]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "hi");
    match result {
        Err(BrainFailure::Refused { status, error }) => {
            assert_eq!(status, 404);
            assert_eq!(error.code, BrainErrorCode::NotFound);
            assert!(error.message.contains("not found"), "{}", error.message);
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    assert!(events.is_empty(), "{events:?}");
}

#[test]
fn an_error_line_in_the_stream_is_refused() {
    let ollama = FakeOllama::start(vec![Reply::Stream(vec![
        say("Hel"),
        json!({ "error": "the runner stopped" }).to_string(),
    ])]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "hi");
    assert_eq!(refused(result), (500, "internal".to_owned()));
    assert!(!kinds(&events).contains(&"turn.completed"));
}

#[test]
fn a_malformed_stream_is_a_protocol_failure() {
    let ollama = FakeOllama::start(vec![Reply::Stream(vec![
        say("Hel"),
        "this is not json".to_owned(),
    ])]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "hi");
    assert!(
        matches!(result, Err(BrainFailure::Protocol(_))),
        "{result:?}"
    );
    assert!(!kinds(&events).contains(&"turn.completed"));
}

#[test]
fn a_stream_that_stops_early_is_unreachable() {
    let ollama = FakeOllama::start(vec![Reply::Cut(vec![say("Hel")])]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "hi");
    assert!(
        matches!(result, Err(BrainFailure::Unreachable(_))),
        "{result:?}"
    );
    assert!(!kinds(&events).contains(&"turn.completed"));
}

#[test]
fn a_failed_follow_up_keeps_the_last_tool_result_open() {
    let ollama = FakeOllama::start(vec![
        Reply::Stream(vec![
            calls(&[("echo", json!({ "text": "a" }))]),
            done("stop"),
        ]),
        Reply::Error(500, r#"{"error":"out of memory"}"#.to_owned()),
        Reply::Stream(vec![say("Done."), done("stop")]),
    ]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "check");
    result.unwrap();
    let turn_id = events[0]["turnId"].as_str().unwrap().to_owned();
    let call = events[1]["call"]["callId"].as_str().unwrap().to_owned();

    let (result, events) = submit(&brain, &session, &turn_id, &lease, &call, json!("a"));
    assert_eq!(refused(result), (500, "internal".to_owned()));
    assert!(events.is_empty(), "{events:?}");

    let (result, events) = submit(&brain, &session, &turn_id, &lease, &call, json!("a"));
    result.unwrap();
    assert_eq!(text(&events), "Done.");
    assert_eq!(events.last().unwrap()["stopReason"], "end_turn");
    let messages = &ollama.requests()[2].1["messages"];
    let tools = messages
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "tool")
        .count();
    assert_eq!(tools, 1, "the retried result is sent once: {messages}");
}
