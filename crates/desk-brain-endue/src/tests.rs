//! HttpBrain against a one-request server on std's TcpListener.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::thread;

use desk_brain::{
    A2ATaskStatus, AgentStatus, NamedToolChoice, TextPart, ToolChoice, ToolDefinition, UserMessage,
};
use serde_json::json;

use super::*;

/// A brain that takes one request, answers a two-event turn and hands back what it was sent.
fn one_turn() -> (String, thread::JoinHandle<(String, Value)>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v0", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let (mut first, mut length) = (String::new(), 0);
        reader.read_line(&mut first).unwrap();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse().unwrap();
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        let events = concat!(
            "data: {\"type\":\"turn.started\",\"turnId\":\"t1\"}\n\n",
            "data: {\"type\":\"turn.completed\",\"turnId\":\"t1\",\"stopReason\":\"end_turn\"}\n\n",
        );
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close";
        let length = events.len();
        write!(
            &stream,
            "{head}\r\nContent-Length: {length}\r\n\r\n{events}"
        )
        .unwrap();
        (first, serde_json::from_slice(&body).unwrap())
    });
    (url, server)
}

#[test]
fn a_turn_sends_its_tools_and_tool_choice_in_the_contract_form() {
    let (url, server) = one_turn();
    let schema = json!({ "type": "object", "required": ["name"] });
    let request = TurnRequest {
        lease_id: "l1".to_owned(),
        message: UserMessage {
            role: Default::default(),
            content: vec![TextPart {
                r#type: Default::default(),
                text: "warm paper".to_owned(),
            }],
        },
        tools: Some(vec![ToolDefinition {
            name: "propose_theme".to_owned(),
            description: "Propose a desk theme.".to_owned(),
            schema: schema.as_object().unwrap().clone(),
        }]),
        tool_choice: Some(ToolChoice::NamedTool(NamedToolChoice {
            r#type: Default::default(),
            name: "propose_theme".to_owned(),
        })),
        context: None,
    };
    let mut events = 0;
    let brain = HttpBrain::new(&url).unwrap();
    brain
        .create_turn("s1", &request, &mut |_| events += 1)
        .unwrap();
    let (first, body) = server.join().unwrap();
    assert!(
        first.starts_with("POST /v0/sessions/s1/turns HTTP/1.1"),
        "{first}"
    );
    assert_eq!(events, 2);
    let tools = json!([{ "name": "propose_theme", "description": "Propose a desk theme.", "schema": schema }]);
    assert_eq!(body["tools"], tools);
    assert_eq!(
        body["toolChoice"],
        json!({ "type": "tool", "name": "propose_theme" })
    );
    assert_eq!(body["leaseId"], "l1");
}

#[test]
fn query_strings_leave_absent_parameters_out() {
    assert_eq!(agents_path(&AgentQuery::default()).unwrap(), "/agents");
    assert_eq!(tasks_path(&TaskQuery::default()).unwrap(), "/a2a/tasks");
    let agents = AgentQuery {
        status: Some(AgentStatus::Inactive),
        page: Some(2),
        ..AgentQuery::default()
    };
    assert_eq!(
        agents_path(&agents).unwrap(),
        "/agents?status=inactive&page=2"
    );
}

#[test]
fn query_values_are_encoded_and_enums_spelled_as_the_contract_does() {
    let tasks = TaskQuery {
        target_agent_id: Some("ag 1&page=9".to_owned()),
        status: Some(A2ATaskStatus::InputRequired),
        page: None,
        limit: Some(5),
    };
    assert_eq!(
        tasks_path(&tasks).unwrap(),
        "/a2a/tasks?targetAgentId=ag%201%26page%3D9&status=input_required&limit=5"
    );
}

/// A brain that answers one request with `{ "items": [] }` and hands back the request's headers.
fn one_answer() -> (String, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v0", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut headers = Vec::new();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            headers.push(line.trim_end().to_owned());
        }
        let body = r#"{"items":[]}"#;
        let head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close";
        write!(
            &stream,
            "{head}\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        headers
    });
    (url, server)
}

#[test]
fn every_request_carries_the_token_its_source_answers_now() {
    let token = Arc::new(std::sync::Mutex::new(None::<String>));
    let source = Arc::clone(&token);
    let brain = HttpBrain::new("http://127.0.0.1:1/v0")
        .unwrap()
        .with_token_source(Arc::new(move || source.lock().unwrap().clone()));
    // Signed out: no Authorization header at all.
    let (url, server) = one_answer();
    let signed_out = HttpBrain {
        endpoint: Endpoint::parse(&url).unwrap(),
        ..brain.clone()
    };
    signed_out.list_spaces().unwrap();
    let headers = server.join().unwrap();
    assert!(
        headers
            .iter()
            .all(|h| !h.to_ascii_lowercase().starts_with("authorization"))
    );
    // Signed in: the token as it is now.
    *token.lock().unwrap() = Some("access1".to_owned());
    let (url, server) = one_answer();
    let signed_in = HttpBrain {
        endpoint: Endpoint::parse(&url).unwrap(),
        ..brain
    };
    signed_in.list_spaces().unwrap();
    let headers = server.join().unwrap();
    assert!(
        headers.contains(&"Authorization: Bearer access1".to_owned()),
        "{headers:?}"
    );
}
