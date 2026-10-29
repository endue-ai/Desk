//! Turns: the model's stream becomes contract events, the conversation carries over, and tool calls
//! go out one at a time with their results sent back to the model.

mod support;

use desk_brain_local::{LocalBrain, LocalBrainOptions};
use serde_json::json;
use support::{
    FakeOllama, Folder, MODEL, Reply, brain, calls, done, kinds, open, refused, say, submit, text,
    turn,
};

#[test]
fn a_turn_streams_the_model_text_as_contract_events() {
    let ollama = FakeOllama::start(vec![Reply::Stream(vec![
        say("Hel"),
        say("lo"),
        done("stop"),
    ])]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "hi");
    result.unwrap();
    assert_eq!(
        kinds(&events),
        ["turn.started", "text.delta", "text.delta", "turn.completed"]
    );
    assert_eq!(text(&events), "Hello");
    assert_eq!(events[3]["stopReason"], "end_turn");
    let turn_id = &events[0]["turnId"];
    assert!(events.iter().all(|e| &e["turnId"] == turn_id));

    let requests = ollama.requests();
    assert_eq!(requests.len(), 1);
    let (path, body) = &requests[0];
    assert_eq!(path, "/api/chat");
    assert_eq!(body["model"], MODEL);
    assert_eq!(body["stream"], true);
    assert_eq!(
        body["messages"],
        json!([{ "role": "user", "content": "hi" }])
    );
}

#[test]
fn the_next_turn_carries_the_conversation() {
    let ollama = FakeOllama::start(vec![
        Reply::Stream(vec![say("Hello"), done("stop")]),
        Reply::Stream(vec![say("Still here"), done("stop")]),
    ]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, first) = turn(&brain, &session, &lease, "hi");
    result.unwrap();
    let (result, events) = turn(&brain, &session, &lease, "again");
    result.unwrap();
    assert_eq!(text(&events), "Still here");
    assert_ne!(
        events[0]["turnId"], first[0]["turnId"],
        "every turn has its own id"
    );

    assert_eq!(
        ollama.requests()[1].1["messages"],
        json!([
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": "Hello" },
            { "role": "user", "content": "again" },
        ])
    );
}

#[test]
fn tool_calls_stop_the_turn_and_their_results_go_back_to_the_model() {
    let ollama = FakeOllama::start(vec![
        Reply::Stream(vec![
            say("Checking. "),
            calls(&[("echo", json!({ "text": "a" })), ("clock", json!({}))]),
            done("stop"),
        ]),
        Reply::Stream(vec![say("Both done."), done("stop")]),
    ]);
    let folder = Folder::new();
    let tools = vec![json!({ "type": "function",
        "function": { "name": "echo", "parameters": { "type": "object" } } })];
    let options = LocalBrainOptions::new(MODEL)
        .with_base_url(&ollama.url)
        .with_tools(tools.clone());
    let brain = LocalBrain::open(folder.path(), options).unwrap();
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "check");
    result.unwrap();
    assert_eq!(
        kinds(&events),
        ["turn.started", "text.delta", "tool.call", "turn.completed"]
    );
    assert_eq!(events[2]["call"]["name"], "echo");
    assert_eq!(events[2]["call"]["arguments"], json!({ "text": "a" }));
    assert_eq!(events[3]["stopReason"], "tool_call");
    let turn_id = events[0]["turnId"].as_str().unwrap().to_owned();
    let first = events[2]["call"]["callId"].as_str().unwrap().to_owned();
    assert_eq!(ollama.requests()[0].1["tools"], json!(tools));

    // Only the call that is out can be answered.
    let wrong = submit(&brain, &session, &turn_id, &lease, "call-x", json!(1));
    assert_eq!(refused(wrong.0), (404, "not_found".to_owned()));

    let (result, events) = submit(
        &brain,
        &session,
        &turn_id,
        &lease,
        &first,
        json!({ "text": "a" }),
    );
    result.unwrap();
    assert_eq!(kinds(&events), ["tool.call", "turn.completed"]);
    assert_eq!(events[0]["turnId"], turn_id.as_str());
    assert_eq!(events[0]["call"]["name"], "clock");
    assert_eq!(events[0]["call"]["arguments"], json!({}));
    assert_eq!(events[1]["stopReason"], "tool_call");
    let second = events[0]["call"]["callId"].as_str().unwrap().to_owned();
    assert_ne!(first, second);
    assert_eq!(
        ollama.requests().len(),
        1,
        "no request until every result is in"
    );

    let (result, events) = submit(&brain, &session, &turn_id, &lease, &second, json!("12:00"));
    result.unwrap();
    assert_eq!(kinds(&events), ["text.delta", "turn.completed"]);
    assert_eq!(text(&events), "Both done.");
    assert_eq!(events[1]["stopReason"], "end_turn");
    assert!(events.iter().all(|e| e["turnId"] == turn_id.as_str()));

    assert_eq!(
        ollama.requests()[1].1["messages"],
        json!([
            { "role": "user", "content": "check" },
            { "role": "assistant", "content": "Checking. ", "tool_calls": [
                { "function": { "name": "echo", "arguments": { "text": "a" } } },
                { "function": { "name": "clock", "arguments": {} } },
            ] },
            { "role": "tool", "tool_name": "echo", "content": "{\"text\":\"a\"}" },
            { "role": "tool", "tool_name": "clock", "content": "12:00" },
        ])
    );
    let finished = submit(&brain, &session, &turn_id, &lease, &second, json!("again"));
    assert_eq!(refused(finished.0), (404, "not_found".to_owned()));
}

#[test]
fn a_length_stop_is_max_tokens() {
    let ollama = FakeOllama::start(vec![Reply::Stream(vec![say("Long"), done("length")])]);
    let folder = Folder::new();
    let brain = brain(&ollama.url, &folder);
    let (session, lease) = open(&brain, "desk-a");

    let (result, events) = turn(&brain, &session, &lease, "go on");
    result.unwrap();
    assert_eq!(events.last().unwrap()["stopReason"], "max_tokens");
}
