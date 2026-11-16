//! The microphone over the desk socket (ADR 0245): `audio.frame` and `audio.ended` reach only the
//! connection whose caller started the capture, never another one on the socket, and
//! `audio.capturing`, the runtime's, reaches none. A caller whose last connection closes leaves no
//! capture running.
#![cfg(unix)]

use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use desk_bridge::Permission;
use desk_core::{Core, Roots};
use desk_ipc::{AGENT_METHOD, CALLER, Listener};
use desk_sys::audio::InputDevice;
use desk_sys::audio::fake::FakeInput;
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);
const MIC: &str = "fake:mic";

fn mic() -> Arc<FakeInput> {
    Arc::new(FakeInput::new().with_devices(vec![InputDevice {
        id: MIC.to_owned(),
        name: "Fake mic".to_owned(),
        default: true,
        sample_rate: 16_000,
        channels: 1,
    }]))
}

fn serve(input: &Arc<FakeInput>) -> (Arc<Core>, Listener, PathBuf) {
    let core = Arc::new(
        Core::new(Roots {
            home: std::env::temp_dir(),
        })
        .with_audio(input.clone()),
    );
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("dipm-{}-{n}.sock", std::process::id()));
    let listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");
    (core, listener, path)
}

fn capture_scope() -> Value {
    json!({ "permission": "audio:capture" })
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

    /// Send one request and wait for its answer, keeping the event lines read on the way.
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

    /// Every event that arrives within a short wait, with those read already.
    fn events(&mut self) -> Vec<String> {
        while let Some(value) = self.next() {
            self.events.push(value);
        }
        self.events
            .iter()
            .filter_map(|e| e["event"].as_str().map(str::to_owned))
            .collect()
    }
}

fn wait(what: &str, done: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done() {
        assert!(Instant::now() < deadline, "{what} within 10 s");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn only_the_capturing_connection_hears_the_microphone() {
    let input = mic();
    let (core, _listener, path) = serve(&input);
    let scope: Permission = serde_json::from_value(capture_scope()).unwrap();
    core.grant(CALLER, scope);
    let mut capturing = Conn::open(&path);
    let mut other = Conn::open(&path);
    let agent = other.ask(json!({ "id": 1, "method": AGENT_METHOD, "params": { "agent": "x" } }));
    assert_eq!(agent["result"]["caller"], "agent:x", "{agent}");

    let started = capturing.ask(json!({ "id": 2, "method": "audio.capture.start",
        "params": { "scope": capture_scope() } }));
    let capture = started["result"]["captureId"].as_str().unwrap().to_owned();
    input.push(MIC, &[0.25; 640]);
    let stopped = capturing.ask(json!({ "id": 3, "method": "audio.capture.stop",
        "params": { "captureId": capture, "scope": capture_scope() } }));
    assert_eq!(stopped["result"], json!({}), "{stopped}");

    let heard = capturing.events();
    assert_eq!(
        heard.iter().filter(|e| *e == "audio.frame").count(),
        2,
        "{heard:?}"
    );
    assert!(heard.iter().any(|e| e == "audio.ended"), "{heard:?}");
    let overheard = other.events();
    assert!(
        overheard.iter().all(|e| !e.starts_with("audio.")),
        "another connection hears nothing of the microphone: {overheard:?}"
    );
    assert!(
        !heard.iter().any(|e| e == "audio.capturing"),
        "the runtime's alone"
    );
}

#[test]
fn a_callers_last_connection_closing_ends_its_captures() {
    let input = mic();
    let (core, _listener, path) = serve(&input);
    let scope: Permission = serde_json::from_value(capture_scope()).unwrap();
    core.grant("agent:x", scope);
    let mut first = Conn::open(&path);
    let mut second = Conn::open(&path);
    for (n, conn) in [&mut first, &mut second].into_iter().enumerate() {
        let id = n as u64 + 1;
        conn.ask(json!({ "id": id, "method": AGENT_METHOD, "params": { "agent": "x" } }));
    }
    first.ask(json!({ "id": 3, "method": "audio.capture.start",
        "params": { "scope": capture_scope() } }));
    assert_eq!(input.open_captures(MIC), 1);

    drop(first);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        input.open_captures(MIC),
        1,
        "agent:x still has a connection"
    );
    drop(second);
    wait("the capture ends with agent:x's last connection", || {
        input.open_captures(MIC) == 0
    });
    assert_eq!(core.capture_count(), 0);
}
