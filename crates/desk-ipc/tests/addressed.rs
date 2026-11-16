//! Who hears what on the desk socket (ADR 0262): an addressed event only the connections whose
//! caller it names, an owned one only the connection whose call started it, a command's answer only
//! its caller, and an event for nobody in particular every connection.
#![cfg(unix)]

use std::fs;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use desk_bridge::BridgeEvent;
use desk_core::{Core, Roots};
use desk_ipc::{AGENT_METHOD, CALLER, Listener};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn home() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("dipx-home-{}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("watched")).unwrap();
    dir
}

fn serve(home: &PathBuf) -> (Arc<Core>, Listener, PathBuf) {
    let core = Arc::new(Core::new(Roots { home: home.clone() }));
    for permission in desk_ipc::grants() {
        core.grant(CALLER, permission);
    }
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("dipx-{}-{n}.sock", std::process::id()));
    let listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");
    (core, listener, path)
}

fn event(value: Value) -> BridgeEvent {
    serde_json::from_value(value).unwrap()
}

fn notice(n: u64) -> BridgeEvent {
    event(
        json!({ "event": "ui.notified", "data": { "notificationId": format!("n-{n}"),
        "caller": "example.notes", "title": "Saved", "level": "info" } }),
    )
}

struct Conn {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    events: Vec<Value>,
}

impl Conn {
    fn open(path: &PathBuf) -> Self {
        let stream = UnixStream::connect(path).expect("connect to the desk socket");
        stream
            .set_read_timeout(Some(Duration::from_millis(300)))
            .unwrap();
        Self {
            reader: BufReader::new(stream.try_clone().unwrap()),
            writer: stream,
            events: Vec::new(),
        }
    }

    fn agent(path: &PathBuf, agent: &str) -> Self {
        let mut conn = Self::open(path);
        let answer =
            conn.ask(json!({ "id": 1, "method": AGENT_METHOD, "params": { "agent": agent } }));
        assert_eq!(
            answer["result"]["caller"],
            format!("agent:{agent}"),
            "{answer}"
        );
        conn
    }

    /// Send one request and wait for its answer, keeping the events read on the way.
    fn ask(&mut self, request: Value) -> Value {
        let id = request["id"].clone();
        let mut line = request.to_string();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Some(value) = self.next() {
                if value.get("event").is_some() {
                    self.events.push(value);
                } else if value["id"] == id {
                    return value;
                }
            }
        }
        panic!("no answer to {id}");
    }

    fn next(&mut self) -> Option<Value> {
        let mut line = String::new();
        match self.reader.read_line(&mut line) {
            Ok(0) => None,
            Ok(_) => Some(serde_json::from_str(&line).unwrap()),
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => None,
            Err(e) => panic!("{e}"),
        }
    }

    /// The names of every event heard so far, waiting a little for more.
    fn heard(&mut self) -> Vec<String> {
        while let Some(value) = self.next() {
            self.events.push(value);
        }
        self.events
            .iter()
            .filter_map(|e| e["event"].as_str().map(str::to_owned))
            .collect()
    }

    /// Wait until an event named `name` has come, or fail after 10 s.
    fn wait_for(&mut self, name: &str) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !self.events.iter().any(|e| e["event"] == name) {
            assert!(
                Instant::now() < deadline,
                "no {name} within 10 s: {:?}",
                self.events
            );
            if let Some(value) = self.next() {
                self.events.push(value);
            }
        }
    }
}

#[test]
fn an_addressed_event_reaches_only_the_connections_it_names() {
    let home = home();
    let (core, _listener, path) = serve(&home);
    let mut cli = Conn::open(&path);
    let mut agent = Conn::agent(&path, "x");
    cli.ask(json!({ "id": 2, "method": "init.get", "params": {} }));
    core.events()
        .publish_to(vec!["agent:x".to_owned()], notice(1));
    agent.wait_for("ui.notified");
    assert!(
        cli.heard().is_empty(),
        "a cli connection hears nothing for agent:x"
    );
}

#[test]
fn an_event_for_nobody_in_particular_reaches_every_connection() {
    let home = home();
    let (core, _listener, path) = serve(&home);
    let mut first = Conn::open(&path);
    let mut second = Conn::agent(&path, "x");
    first.ask(json!({ "id": 2, "method": "init.get", "params": {} }));
    core.events().publish(notice(2));
    first.wait_for("ui.notified");
    second.wait_for("ui.notified");
}

#[test]
fn a_watch_reports_only_to_the_connection_that_started_it() {
    let home = home();
    let (_core, _listener, path) = serve(&home);
    let mut watching = Conn::open(&path);
    let mut other = Conn::open(&path);
    let dir = home.join("watched");
    let scope = json!({ "permission": "fs:read", "paths": ["/**", "~/**"] });
    let started = watching.ask(json!({ "id": 2, "method": "fs.watch",
        "params": { "path": dir.display().to_string(), "scope": scope } }));
    assert!(started["result"]["watchId"].is_string(), "{started}");
    other.ask(json!({ "id": 3, "method": "init.get", "params": {} }));
    fs::write(dir.join("note.txt"), "hello").unwrap();
    watching.wait_for("fs.changed");
    let overheard = other.heard();
    assert!(
        !overheard.iter().any(|e| e == "fs.changed"),
        "another cli connection hears none of the watch: {overheard:?}"
    );
}

#[test]
fn a_command_answer_reaches_only_the_caller_that_ran_it() {
    let home = home();
    let (core, _listener, path) = serve(&home);
    let mut cli = Conn::open(&path);
    let mut agent = Conn::agent(&path, "x");
    cli.ask(json!({ "id": 2, "method": "init.get", "params": {} }));
    let answered = |caller: &str, n: u64| {
        event(
            json!({ "event": "cmd.answered", "data": { "invocationId": format!("i-{n}"),
            "id": "example.notes.count", "caller": caller, "ok": true } }),
        )
    };
    core.events().publish(answered("agent:x", 1));
    agent.wait_for("cmd.answered");
    assert!(cli.heard().is_empty(), "agent:x's answer is its own");
    core.events().publish(answered(CALLER, 2));
    cli.wait_for("cmd.answered");
    let agents: Vec<&Value> = agent
        .events
        .iter()
        .filter(|e| e["event"] == "cmd.answered")
        .collect();
    assert_eq!(
        agents.len(),
        1,
        "agent:x does not hear cli's answer: {agents:?}"
    );
}

#[test]
fn plugin_changes_still_reach_cli() {
    let home = home();
    let (core, _listener, path) = serve(&home);
    let mut cli = Conn::open(&path);
    cli.ask(json!({ "id": 2, "method": "init.get", "params": {} }));
    let dir = home.join("plugins/hello");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    fs::write(
        dir.join("plugin.json"),
        r#"{ "id": "example.hello", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" }"#,
    )
    .unwrap();
    core.install_plugin(&dir, false);
    cli.wait_for("plugin.changed");
}
