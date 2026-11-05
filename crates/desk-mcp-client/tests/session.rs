//! The client against the fixture server (`tests/fixture/server.rs`), started as a real process over
//! stdio: the handshake in a version both know, every page of tools, tool calls and error results,
//! and a server that sees only the environment it was given.

use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use desk_mcp_client::{
    Connection, Failure, Notification, PROTOCOLS, Server, ServerConfig, Session,
};
use serde_json::{Map, Value, json};

const WAIT: Duration = Duration::from_secs(20);

fn config(args: &[&str], env: &[&str]) -> ServerConfig {
    ServerConfig {
        name: "fixture".to_owned(),
        command: env!("CARGO_BIN_EXE_desk-mcp-fixture").to_owned(),
        args: args.iter().map(|a| (*a).to_owned()).collect(),
        env: env.iter().map(|e| (*e).to_owned()).collect(),
    }
}

/// The fixture started, connected and shaken hands with, and the lines it wrote to stderr.
fn open(args: &[&str], env: &[&str]) -> (Server, Result<Session, Failure>, mpsc::Receiver<String>) {
    let (said, stderr) = mpsc::channel();
    let cwd = std::env::temp_dir();
    let (server, stdout, stdin) = Server::spawn(&config(args, env), &cwd, move |line| {
        let _ = said.send(line);
    })
    .unwrap();
    let sink = Box::new(|_: Option<Notification>| {});
    let connection = Connection::start(stdout, stdin, sink).unwrap();
    (server, Session::open(Arc::clone(&connection), WAIT), stderr)
}

fn args(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap()
}

#[test]
fn speaks_a_protocol_version_both_know() {
    let (_server, session, stderr) = open(&[], &[]);
    let session = session.unwrap();
    assert_eq!(session.protocol(), PROTOCOLS[0]);
    assert_eq!(session.server(), "desk-mcp-fixture");
    let line = stderr.recv_timeout(WAIT).unwrap();
    assert_eq!(line, "desk-mcp-fixture: started");

    let (_older, older, _) = open(&["--protocol", "2024-11-05"], &[]);
    assert_eq!(older.unwrap().protocol(), "2024-11-05");
    let (_unknown, unknown, _) = open(&["--protocol", "1999-01-01"], &[]);
    let Err(Failure::Protocol(why)) = unknown else {
        panic!("a version Desk does not speak is refused");
    };
    assert!(why.contains("1999-01-01"), "{why}");
}

#[test]
fn lists_every_page_of_tools() {
    let (_server, session, _) = open(&[], &[]);
    let tools = session.unwrap().tools(WAIT).unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, ["echo", "add_note", "fail", "env", "grow"]);
    let echo = &tools[0];
    assert!(echo.read_only);
    assert_eq!(
        echo.description.as_deref(),
        Some("Answers the text it is given.")
    );
    assert_eq!(echo.input_schema["required"], json!(["text"]));
    let note = &tools[1];
    assert!(!note.read_only);
    assert_eq!(note.title.as_deref(), Some("Add a note"));
    assert!(note.output_schema.is_some());
}

#[test]
fn calls_a_tool_and_reads_an_error_result() {
    let (_server, session, _) = open(&[], &[]);
    let session = session.unwrap();
    let echoed = session
        .call("echo", args(json!({ "text": "hello" })), WAIT)
        .unwrap();
    assert!(!echoed.is_error);
    assert_eq!(echoed.text(), "hello");
    let saved = session
        .call("add_note", args(json!({ "title": "milk" })), WAIT)
        .unwrap();
    assert_eq!(saved.structured, Some(json!({ "saved": "milk" })));
    let failed = session.call("fail", Map::new(), WAIT).unwrap();
    assert!(failed.is_error);
    assert_eq!(failed.text(), "it failed on purpose");
    let unknown = session.call("nope", Map::new(), WAIT).unwrap_err();
    assert!(
        matches!(unknown, Failure::Rpc { code: -32602, .. }),
        "{unknown:?}"
    );
}

#[test]
fn the_server_sees_only_the_named_environment() {
    // Cargo sets both for the test process; only the named one may reach the server.
    assert!(std::env::var("CARGO_PKG_NAME").is_ok() && std::env::var("CARGO_MANIFEST_DIR").is_ok());
    let (_server, session, _) = open(&[], &["CARGO_PKG_NAME"]);
    let session = session.unwrap();
    let read = |name: &str| {
        let answer = session
            .call("env", args(json!({ "name": name })), WAIT)
            .unwrap();
        answer.text()
    };
    assert_eq!(read("CARGO_PKG_NAME"), "desk-mcp-client");
    assert_eq!(read("CARGO_MANIFEST_DIR"), "(unset)");
    assert_ne!(read("PATH"), "(unset)");
}

#[test]
fn a_stopped_server_fails_what_waits_and_closes() {
    let (server, session, _) = open(&[], &[]);
    let session = session.unwrap();
    server.stop(Duration::ZERO);
    assert!(server.ended());
    let after = session
        .call("echo", args(json!({ "text": "late" })), WAIT)
        .unwrap_err();
    assert!(
        matches!(after, Failure::Closed | Failure::Io(_)),
        "{after:?}"
    );
}
