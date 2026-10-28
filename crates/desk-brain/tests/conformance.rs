//! Conformance: examples/brain-echo answers the way specs/brain/v0/openapi.yaml says. Every response
//! body and stream event is checked against the contract's component schemas (formats included), the
//! request vectors are accepted or refused as their folders say, and the HTTP client from
//! desk-brain-endue holds a whole conversation with it.

mod support;

use std::fs;
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

use desk_brain::{
    Brain, BrainErrorCode, BrainFailure, ClientInfo, CreateSessionRequest, LeaseAcquireRequest,
    LeaseHolder, TextPart, TurnEvent, TurnRequest, UserMessage,
};
use desk_brain_endue::HttpBrain;
use desk_brain_endue::http::send;
use serde_json::json;
use support::{Contract, Echo, Wire, kinds, said, text, vector, vector_doc, vectors_dir};

#[test]
fn a_whole_conversation_conforms_to_the_contract() {
    let echo = Echo::start();
    let wire = Wire::new(&echo);
    let contract = Contract::new();

    let (status, session) = wire.call(
        "POST",
        "/sessions",
        Some(vector("valid/create-session-request.json")),
    );
    assert_eq!(status, 201);
    contract.check("Session", &session);
    let id = session["id"].as_str().unwrap();
    let (status, read) = wire.call("GET", &format!("/sessions/{id}"), None);
    assert_eq!(status, 200);
    contract.check("Session", &read);

    let body = json!({ "holder": { "deskId": "desk-a", "name": "Studio" }, "ttlSeconds": 60 });
    let (status, lease) = wire.call("POST", &format!("/sessions/{id}/lease"), Some(body));
    assert_eq!(status, 200);
    contract.check("Lease", &lease);
    let lease_id = lease["leaseId"].as_str().unwrap();
    let (status, current) = wire.call("GET", &format!("/sessions/{id}/lease"), None);
    assert_eq!(status, 200);
    contract.check("Lease", &current);
    assert_eq!(current["leaseId"], lease["leaseId"]);

    let mut turn = vector("valid/turn-request.json");
    turn["leaseId"] = json!(lease_id);
    let events = wire.stream(&format!("/sessions/{id}/turns"), turn);
    for event in &events {
        contract.check("TurnEvent", event);
    }
    assert_eq!(kinds(&events).first(), Some(&"turn.started"));
    assert_eq!(events.last().unwrap()["stopReason"], "end_turn");
    assert_eq!(text(&events), "hello");

    // The echo tool's round trip: the turn stops at tool_call and finishes after the result.
    let events = wire.stream(
        &format!("/sessions/{id}/turns"),
        said("tool: ping", lease_id),
    );
    for event in &events {
        contract.check("TurnEvent", event);
    }
    let call = events
        .iter()
        .find(|e| e["type"] == "tool.call")
        .expect("a tool.call event");
    assert_eq!(call["call"]["name"], "echo");
    assert_eq!(call["call"]["arguments"], json!({ "text": "ping" }));
    assert_eq!(events.last().unwrap()["stopReason"], "tool_call");
    let mut result = vector("valid/tool-result-request.json");
    result["leaseId"] = json!(lease_id);
    result["callId"] = call["call"]["callId"].clone();
    result["output"] = call["call"]["arguments"].clone();
    let turn_id = call["turnId"].as_str().unwrap();
    let rest = wire.stream(
        &format!("/sessions/{id}/turns/{turn_id}/tool-results"),
        result,
    );
    for event in &rest {
        contract.check("TurnEvent", event);
    }
    assert_eq!(text(&rest), "The echo tool said: ping");
    assert_eq!(rest.last().unwrap()["stopReason"], "end_turn");

    let path = format!("/sessions/{id}/lease/{lease_id}");
    let (status, renewed) = wire.call("PUT", &path, Some(json!({ "ttlSeconds": 30 })));
    assert_eq!(status, 200);
    contract.check("Lease", &renewed);
    assert_eq!(renewed["ttlSeconds"], 30);
    assert_eq!(wire.call("DELETE", &path, None).0, 204);
    let (status, error) = wire.call("GET", &format!("/sessions/{id}/lease"), None);
    assert_eq!(status, 404);
    contract.check("BrainError", &error);
    assert_eq!(error["code"], "not_found");
}

#[test]
fn request_vectors_are_accepted_or_refused_as_their_folder_says() {
    let echo = Echo::start();
    let wire = Wire::new(&echo);
    let contract = Contract::new();
    let mut checked = 0;
    for (folder, valid) in [("valid", true), ("invalid", false)] {
        for entry in fs::read_dir(vectors_dir().join(folder)).unwrap() {
            let file = format!("{folder}/{}", entry.unwrap().file_name().to_string_lossy());
            let mut doc = vector_doc(&file);
            let mut body = doc["instance"].take();
            // Each vector gets a fresh session, its own lease and a waiting tool call.
            let session = wire.session();
            let lease = wire.acquire(&session, "desk-z", 60);
            let events = wire.stream(
                &format!("/sessions/{session}/turns"),
                said("tool: x", &lease),
            );
            let call = &events.iter().find(|e| e["type"] == "tool.call").unwrap();
            if body.get("leaseId").is_some() {
                body["leaseId"] = json!(lease);
            }
            if body.get("callId").is_some() {
                body["callId"] = call["call"]["callId"].clone();
            }
            let path = match doc["target"].as_str().unwrap() {
                "CreateSessionRequest" => "/sessions".to_owned(),
                "LeaseAcquireRequest" => format!("/sessions/{session}/lease"),
                "TurnRequest" => format!("/sessions/{session}/turns"),
                "ToolResultRequest" => {
                    format!(
                        "/sessions/{session}/turns/{}/tool-results",
                        call["turnId"].as_str().unwrap()
                    )
                }
                _ => continue,
            };
            let response = send(&wire.0, None, "POST", &path, Some(&body)).unwrap();
            let status = response.status;
            if valid {
                assert!(status < 300, "{file}: answered {status}");
            } else {
                let error = response.json().unwrap();
                assert_eq!(status, 400, "{file}: answered {status} {error}");
                contract.check("BrainError", &error);
                assert_eq!(error["code"], "invalid_request", "{file}");
            }
            checked += 1;
        }
    }
    assert!(checked >= 8, "only {checked} request vectors were sent");
}

#[test]
fn lease_conflicts_answer_with_the_contract_codes() {
    let echo = Echo::start();
    let wire = Wire::new(&echo);
    let contract = Contract::new();
    let session = wire.session();
    let a = wire.acquire(&session, "desk-a", 60);

    let body = json!({ "holder": { "deskId": "desk-b" }, "ttlSeconds": 60 });
    let (status, error) = wire.call("POST", &format!("/sessions/{session}/lease"), Some(body));
    assert_eq!(status, 409);
    contract.check("BrainError", &error);
    assert_eq!(error["code"], "lease_held");
    assert_eq!(error["holder"]["deskId"], "desk-a");

    let (status, lease) = wire.call(
        "POST",
        &format!("/sessions/{session}/lease"),
        Some(vector("valid/lease-acquire-takeover.json")),
    );
    assert_eq!(status, 200);
    assert_eq!(lease["holder"]["deskId"], "desk-b");
    let (status, error) = wire.call(
        "PUT",
        &format!("/sessions/{session}/lease/{a}"),
        Some(json!({})),
    );
    assert_eq!((status, error["code"].as_str()), (409, Some("lease_lost")));
    let (status, error) = wire.call(
        "POST",
        &format!("/sessions/{session}/turns"),
        Some(said("hi", &a)),
    );
    assert_eq!((status, error["code"].as_str()), (409, Some("lease_lost")));
    contract.check("BrainError", &error);

    // Five lease seconds are 100 ms here.
    let other = wire.session();
    let short = wire.acquire(&other, "desk-a", 5);
    thread::sleep(Duration::from_millis(250));
    let (status, error) = wire.call(
        "PUT",
        &format!("/sessions/{other}/lease/{short}"),
        Some(json!({})),
    );
    assert_eq!(
        (status, error["code"].as_str()),
        (409, Some("lease_expired"))
    );
    assert_eq!(
        wire.call("GET", &format!("/sessions/{other}/lease"), None)
            .0,
        404
    );
    wire.acquire(&other, "desk-c", 60);
}

#[test]
fn the_http_client_holds_a_conversation() {
    let echo = Echo::start();
    let brain = HttpBrain::new(&echo.url).unwrap();
    let client = ClientInfo {
        name: "conformance".to_owned(),
        version: "0".to_owned(),
    };
    let session = brain
        .create_session(&CreateSessionRequest {
            title: None,
            client: client.clone(),
        })
        .unwrap();
    let holder = |desk: &str| LeaseHolder {
        desk_id: desk.to_owned(),
        name: None,
    };
    let acquire = |desk: &str| LeaseAcquireRequest {
        holder: holder(desk),
        ttl_seconds: 60,
        takeover: None,
    };
    let lease = brain
        .acquire_lease(&session.id, &acquire("desk-a"))
        .unwrap();
    assert_eq!(
        brain.get_session(&session.id).unwrap().lease,
        Some(lease.clone())
    );

    let request = TurnRequest {
        lease_id: lease.lease_id.clone(),
        message: UserMessage {
            role: Default::default(),
            content: vec![TextPart {
                r#type: Default::default(),
                text: "hello there".to_owned(),
            }],
        },
    };
    let mut answer = String::new();
    let mut last = None;
    brain
        .create_turn(&session.id, &request, &mut |event| {
            if let TurnEvent::TextDelta(delta) = &event {
                answer.push_str(&delta.text);
            }
            last = Some(event);
        })
        .unwrap();
    assert_eq!(answer, "hello there");
    assert!(matches!(last, Some(TurnEvent::TurnCompleted(_))));

    match brain.acquire_lease(&session.id, &acquire("desk-b")) {
        Err(BrainFailure::Refused { status: 409, error }) => {
            assert_eq!(error.code, BrainErrorCode::LeaseHeld)
        }
        other => panic!("expected lease_held, got {other:?}"),
    }
    let closed = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let nobody = HttpBrain::new(&format!("http://127.0.0.1:{closed}/v0")).unwrap();
    assert!(matches!(
        nobody.create_session(&CreateSessionRequest {
            title: None,
            client
        }),
        Err(BrainFailure::Unreachable(_))
    ));
}
