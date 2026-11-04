//! A desk and an MCP client for the tests: a real `Core` behind a real desk socket, with two plugins
//! (`example.git`, whose `push` its manifest marks irreversible, and `example.notes`, whose `open`
//! takes a path) and the runtime's `desk.theme.toggle`, every invocation answered with what it was
//! and who called it; and `desk_mcp::serve` on pipes, spoken to as an MCP client would.
#![allow(dead_code)]

use std::fs;
use std::io::{BufRead, BufReader, PipeWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, Roots};
use desk_ipc::{CALLER, Listener};
use desk_mcp::Options;
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub const AGENT: &str = "tester";

pub fn call(core: &Core, caller: &str, method: &str, params: Value) -> Value {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(failure) => panic!("{method}: {failure:?}"),
    }
}

pub fn permission(value: Value) -> Permission {
    serde_json::from_value(value).unwrap()
}

/// A path nothing serves.
pub fn nowhere() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("dmcp-none-{}-{n}.sock", std::process::id()))
}

pub struct Desk {
    pub core: Arc<Core>,
    pub path: PathBuf,
    _listener: Listener,
}

impl Desk {
    pub fn start() -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let home = std::env::temp_dir().join(format!("dmcp-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        let core = Arc::new(Core::new(Roots { home: home.clone() }));
        for grant in desk_ipc::grants() {
            core.grant(CALLER, grant);
        }
        plugin(
            &core,
            &home,
            "example.git",
            &[("status", false), ("push", true)],
        );
        plugin(&core, &home, "example.notes", &[("open", false)]);
        let open = json!({ "id": "example.notes.open", "title": "Notes: open", "description":
            "Open a note.", "argsSchema": { "type": "object", "properties": { "path":
            { "type": "string" } }, "required": ["path"] } });
        call(&core, "example.notes", "cmd.register", open);
        let toggle = json!({ "id": "desk.theme.toggle", "title": "Switch theme" });
        call(&core, "desk", "cmd.register", toggle);
        answer_every_invocation(&core);
        let path = std::env::temp_dir().join(format!("dmcp-{}-{n}.sock", std::process::id()));
        let listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");
        Self {
            core,
            path,
            _listener: listener,
        }
    }

    /// Grant the test agent `cmd:invoke` for `ids`.
    pub fn allow(&self, ids: &[&str]) {
        let scope = permission(json!({ "permission": "cmd:invoke", "ids": ids }));
        self.core.grant(&format!("agent:{AGENT}"), scope);
    }

    pub fn options(&self, plugins: &[&str]) -> Options {
        Options {
            agent: AGENT.to_owned(),
            plugins: plugins.iter().map(|p| (*p).to_owned()).collect(),
            socket: Some(self.path.clone()),
        }
    }
}

/// Install plugin `id` with `commands` (name, irreversible) in its manifest and register them.
fn plugin(core: &Core, home: &Path, id: &str, commands: &[(&str, bool)]) {
    let dir = home.join("plugins").join(id);
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>example</p>").unwrap();
    let declared: Vec<Value> = commands
        .iter()
        .map(|(name, irreversible)| {
            json!({ "id": format!("{id}.{name}"), "title": name, "irreversible": irreversible })
        })
        .collect();
    let manifest = json!({ "id": id, "name": id, "version": "0.1.0", "kind": "ui",
        "entry": "ui/index.html", "description": format!("The {id} example"),
        "contributes": { "commands": declared } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    for (name, _) in commands {
        let keywords = if *name == "status" {
            json!(["repository"])
        } else {
            json!([])
        };
        let title = format!("{id}: {name}");
        let params = json!({ "id": format!("{id}.{name}"), "title": title, "keywords": keywords });
        call(core, id, "cmd.register", params);
    }
}

/// Every provider answers `{ ran, args, caller }`.
fn answer_every_invocation(core: &Arc<Core>) {
    let events = core.events().subscribe();
    let core = Arc::clone(core);
    thread::spawn(move || {
        for event in events {
            let BridgeEvent::CmdInvoked(invoked) = event else {
                continue;
            };
            let data = invoked.data;
            let provider = data.id.rsplit_once('.').map(|(p, _)| p).unwrap_or_default();
            let provider = if provider == "desk.theme" {
                "desk"
            } else {
                provider
            };
            let result = json!({ "ran": data.id, "args": data.args, "caller": data.caller });
            let answer = json!({ "invocationId": data.invocation_id, "result": result });
            call(&core, provider, "cmd.answer", answer);
        }
    });
}

/// The MCP client's end of `desk_mcp::serve`.
pub struct Mcp {
    input: Option<PipeWriter>,
    lines: Receiver<Value>,
    next: u64,
    /// Notifications that arrived while waiting for answers.
    pub notes: Vec<Value>,
}

impl Mcp {
    pub fn start(options: Options) -> Self {
        let (input_read, input) = std::io::pipe().unwrap();
        let (output_read, output) = std::io::pipe().unwrap();
        thread::spawn(move || desk_mcp::serve(BufReader::new(input_read), output, options));
        let (sender, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(output_read).lines() {
                let Ok(line) = line else { break };
                let value = serde_json::from_str(&line).expect("each line is one JSON message");
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        Self {
            input: Some(input),
            lines,
            next: 0,
            notes: Vec::new(),
        }
    }

    /// `initialize` as `version`, then `notifications/initialized`; the initialize result.
    pub fn initialized(options: Options, version: &str) -> (Self, Value) {
        let mut mcp = Self::start(options);
        let params = json!({ "protocolVersion": version, "capabilities": {},
            "clientInfo": { "name": "test", "version": "0" } });
        let result = mcp.request("initialize", params)["result"].clone();
        mcp.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        (mcp, result)
    }

    pub fn send(&mut self, message: &Value) {
        self.send_line(&message.to_string());
    }

    pub fn send_line(&mut self, line: &str) {
        let input = self.input.as_mut().expect("stdin is open");
        input.write_all(line.as_bytes()).unwrap();
        input.write_all(b"\n").unwrap();
    }

    /// Send a request and wait for its answer, keeping the notifications that come first.
    pub fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let id = self.next;
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        loop {
            let message = self
                .receive(Duration::from_secs(10))
                .expect("an answer in time");
            if message["id"] == id {
                assert_eq!(message["jsonrpc"], "2.0");
                return message;
            }
            self.notes.push(message);
        }
    }

    /// `tools/call`, and the JSON its text content holds, with whether it is an error.
    pub fn tool(&mut self, name: &str, arguments: Value) -> (Value, bool) {
        let answer = self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
        );
        let result = &answer["result"];
        let text = result["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("{answer}"));
        assert_eq!(result["content"][0]["type"], "text");
        (
            serde_json::from_str(text).unwrap(),
            result["isError"] == true,
        )
    }

    /// The next message within `wait`.
    pub fn receive(&mut self, wait: Duration) -> Option<Value> {
        self.lines.recv_timeout(wait).ok()
    }

    /// Close stdin, as a client does to end the session.
    pub fn close(&mut self) {
        self.input = None;
    }
}
