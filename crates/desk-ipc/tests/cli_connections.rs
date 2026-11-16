//! Every `cli` connection on the desk socket is the same caller, but each hears only what its own
//! calls started (#377, ADR 0262): its command's `cmd.answered` and its capture's `audio.frame` and
//! `audio.ended` reach that connection alone, while what `cli` hears as a holder of grants
//! (`plugin.changed`) still reaches every `cli` connection.
#![cfg(unix)]

use std::fs;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use desk_bridge::{BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, Roots};
use desk_ipc::{CALLER, Listener};
use desk_sys::audio::InputDevice;
use desk_sys::audio::fake::FakeInput;
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);
const MIC: &str = "fake:mic";
/// The plugin that provides the command the connections run.
const NOTES: &str = "example.notes";

struct Desk {
    core: Arc<Core>,
    input: Arc<FakeInput>,
    home: PathBuf,
    path: PathBuf,
    _listener: Listener,
}

/// A desk with the app's `cli` grants, a fake microphone, and `cli` allowed to capture.
fn serve() -> Desk {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let home = std::env::temp_dir().join(format!("dipc-home-{}-{n}", std::process::id()));
    fs::create_dir_all(&home).unwrap();
    let input = Arc::new(FakeInput::new().with_devices(vec![InputDevice {
        id: MIC.to_owned(),
        name: "Fake mic".to_owned(),
        default: true,
        sample_rate: 16_000,
        channels: 1,
    }]));
    let core = Arc::new(
        Core::new(Roots { home: home.clone() }).with_audio(input.clone()),
    );
    for permission in desk_ipc::grants() {
        core.grant(CALLER, permission);
    }
    let capture: Permission = serde_json::from_value(capture_scope()).unwrap();
    core.grant(CALLER, capture);
    let path = std::env::temp_dir().join(format!("dipc-{}-{n}.sock", std::process::id()));
    let listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");
    Desk {
        core,
        input,
        home,
        path,
        _listener: listener,
    }
}

fn capture_scope() -> Value {
    json!({ "permission": "audio:capture" })
}

/// `caller`'s bridge call straight to the core, as a plugin's would come.
fn call(core: &Core, caller: &str, method: &str, params: Value) -> Value {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(err) => panic!("{method}: {:?}", err.error),
    }
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
            assert!(Instant::now() < deadline, "no {name} within 10 s: {:?}", self.events);
            if let Some(value) = self.next() {
                self.events.push(value);
            }
        }
    }
}

#[test]
fn a_cli_connection_hears_only_its_own_command_answer() {
    let desk = serve();
    call(&desk.core, NOTES, "cmd.register", json!({ "id": "example.notes.count", "title": "Count" }));
    let mut running = Conn::open(&desk.path);
    let mut other = Conn::open(&desk.path);
    other.ask(json!({ "id": 1, "method": "init.get", "params": {} }));

    let invoked = running.ask(json!({ "id": 2, "method": "cmd.invoke", "params": {
        "id": "example.notes.count", "args": {},
        "scope": { "permission": "cmd:invoke", "ids": ["example.notes.count"] } } }));
    let invocation = invoked["result"]["invocationId"].as_str().unwrap().to_owned();
    call(&desk.core, NOTES, "cmd.answer", json!({ "invocationId": invocation, "result": 3 }));

    running.wait_for("cmd.answered");
    let answered = running.events.iter().find(|e| e["event"] == "cmd.answered").unwrap();
    assert_eq!(answered["data"]["invocationId"], invocation.as_str(), "{answered}");
    let overheard = other.heard();
    assert!(
        !overheard.iter().any(|e| e == "cmd.answered"),
        "another cli connection does not hear the answer: {overheard:?}"
    );
}

#[test]
fn a_cli_connection_hears_only_its_own_capture() {
    let desk = serve();
    let mut capturing = Conn::open(&desk.path);
    let mut other = Conn::open(&desk.path);
    other.ask(json!({ "id": 1, "method": "init.get", "params": {} }));

    let started = capturing.ask(json!({ "id": 2, "method": "audio.capture.start",
        "params": { "scope": capture_scope() } }));
    let capture = started["result"]["captureId"].as_str().unwrap().to_owned();
    desk.input.push(MIC, &[0.25; 640]);
    capturing.ask(json!({ "id": 3, "method": "audio.capture.stop",
        "params": { "captureId": capture, "scope": capture_scope() } }));

    capturing.wait_for("audio.ended");
    assert!(capturing.heard().iter().any(|e| e == "audio.frame"));
    let overheard = other.heard();
    assert!(
        overheard.iter().all(|e| !e.starts_with("audio.")),
        "another cli connection hears nothing of the capture: {overheard:?}"
    );
}

#[test]
fn grant_events_still_reach_every_cli_connection() {
    let desk = serve();
    let mut first = Conn::open(&desk.path);
    let mut second = Conn::open(&desk.path);
    for conn in [&mut first, &mut second] {
        conn.ask(json!({ "id": 1, "method": "init.get", "params": {} }));
    }
    let dir = desk.home.join("plugins/hello");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    fs::write(
        dir.join("plugin.json"),
        r#"{ "id": "example.hello", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" }"#,
    )
    .unwrap();
    desk.core.install_plugin(&dir, false);
    first.wait_for("plugin.changed");
    second.wait_for("plugin.changed");
}
