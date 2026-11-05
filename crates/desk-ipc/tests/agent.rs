//! Agent connections (ADR 0086): `socket.agent` makes the rest of a connection call as
//! `agent:<id>`, with that agent's own grants and the default prompter's answer, while every other
//! connection stays `cli`. A connection that is an agent stays that agent.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use desk_bridge::{BridgeResponse, Permission};
use desk_core::{Core, Roots};
use desk_ipc::{AGENT_METHOD, CALLER, Client, Listener};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn serve() -> (Arc<Core>, Listener, PathBuf) {
    let core = Arc::new(Core::new(Roots {
        home: std::env::temp_dir(),
    }));
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("dipa-{}-{n}.sock", std::process::id()));
    let listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");
    (core, listener, path)
}

fn invoke_all() -> Permission {
    serde_json::from_value(json!({ "permission": "cmd:invoke", "ids": ["*"] })).unwrap()
}

struct Conn {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
}

impl Conn {
    fn open(path: &PathBuf) -> Self {
        let stream = UnixStream::connect(path).expect("connect to the desk socket");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        Self {
            reader: BufReader::new(stream.try_clone().unwrap()),
            writer: stream,
        }
    }

    /// Send one line and read the answer with its id, past event lines.
    fn ask(&mut self, request: Value) -> Value {
        let id = request["id"].clone();
        let mut line = request.to_string();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).unwrap();
        loop {
            let mut line = String::new();
            assert!(self.reader.read_line(&mut line).expect("a line in time") > 0);
            let value: Value = serde_json::from_str(&line).unwrap();
            if value.get("event").is_none() && value["id"] == id {
                return value;
            }
        }
    }

    fn become_agent(&mut self, id: u64, agent: &str) -> Value {
        self.ask(json!({ "id": id, "method": AGENT_METHOD, "params": { "agent": agent } }))
    }

    fn list(&mut self, id: u64) -> Value {
        let scope = json!({ "permission": "cmd:invoke", "ids": ["*"] });
        self.ask(json!({ "id": id, "method": "cmd.list", "params": { "scope": scope } }))
    }
}

#[test]
fn an_agent_connection_calls_with_the_agents_grants_not_the_clis() {
    let (core, _listener, path) = serve();
    core.grant(CALLER, invoke_all());
    let mut cli = Conn::open(&path);
    let mut agent = Conn::open(&path);

    let became = agent.become_agent(1, "claude-code");
    assert_eq!(became["ok"], true, "{became}");
    assert_eq!(became["result"]["caller"], "agent:claude-code");

    // The CLI's grant is not the agent's: nobody holds perm:manage, so the default prompter refuses.
    let refused = agent.list(2);
    assert_eq!(refused["error"]["code"], "permission_denied", "{refused}");
    assert_eq!(cli.list(1)["ok"], true, "the other connection is still cli");

    let grant = core.grant("agent:claude-code", invoke_all());
    assert_eq!(agent.list(3)["ok"], true);
    let own = agent.ask(json!({ "id": 4, "method": "perm.query", "params": {} }));
    let ids: Vec<&Value> = own["result"]["grants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| &g["grantId"])
        .collect();
    assert_eq!(ids, [&json!(grant.grant_id)], "only the agent's own grant");
}

#[test]
fn an_agent_connection_stays_the_agent_it_became() {
    let (core, _listener, path) = serve();
    core.grant("agent:one", invoke_all());
    let mut conn = Conn::open(&path);
    assert_eq!(conn.become_agent(1, "one")["ok"], true);
    let again = conn.become_agent(2, "two");
    assert_eq!(again["error"]["code"], "invalid_params", "{again}");
    assert!(
        again["error"]["message"]
            .as_str()
            .unwrap()
            .contains("agent:one")
    );
    assert_eq!(conn.list(3)["ok"], true, "still agent:one");
}

#[test]
fn an_id_desk_cannot_name_is_refused_and_the_connection_stays_cli() {
    let (core, _listener, path) = serve();
    core.grant(CALLER, invoke_all());
    let mut conn = Conn::open(&path);
    for (id, agent) in [(1, ""), (2, "-dash"), (3, "has space"), (4, "agent:x")] {
        let refused = conn.become_agent(id, agent);
        assert_eq!(
            refused["error"]["code"], "invalid_params",
            "{agent:?}: {refused}"
        );
    }
    let unnamed = conn.ask(json!({ "id": 5, "method": AGENT_METHOD, "params": {} }));
    assert_eq!(unnamed["error"]["code"], "invalid_params", "{unnamed}");
    let long = "a".repeat(123);
    assert_eq!(
        conn.become_agent(6, &long)["error"]["code"],
        "invalid_params"
    );
    assert_eq!(conn.list(7)["ok"], true, "still cli");
}

#[test]
fn the_client_becomes_an_agent() {
    let (core, _listener, path) = serve();
    core.grant("agent:scripts", invoke_all());
    let mut client = Client::connect(&path).expect("connect");
    match client.become_agent(1, "scripts").unwrap() {
        BridgeResponse::BridgeSuccess(ok) => assert_eq!(ok.result["caller"], "agent:scripts"),
        BridgeResponse::BridgeFailure(failure) => panic!("{failure:?}"),
    }
    let request = serde_json::from_value(json!({
        "id": 2,
        "method": "cmd.list",
        "params": { "scope": { "permission": "cmd:invoke", "ids": ["*"] } }
    }))
    .unwrap();
    assert!(matches!(
        client.call(request).unwrap(),
        BridgeResponse::BridgeSuccess(ok) if ok.id == 2
    ));
    assert!(matches!(
        client.become_agent(3, "other").unwrap(),
        BridgeResponse::BridgeFailure(failure) if failure.id == 3
    ));
}
