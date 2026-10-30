//! Helpers for the perm and events tests: a home folder, bridge calls as a caller, grants,
//! prompters, an installed plugin, and the addressed deliveries a test has seen.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeError, BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, Delivery, Prompter, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub const NOTES: &str = "example.notes";
pub const CALENDAR: &str = "example.calendar";

/// A fresh home folder with `Documents/hello.md` and `Calendar/today.ics` in it.
pub fn home(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-{tag}-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("Documents")).unwrap();
    fs::create_dir_all(dir.join("Calendar")).unwrap();
    fs::write(dir.join("Documents/hello.md"), "# Hello").unwrap();
    fs::write(dir.join("Calendar/today.ics"), "BEGIN:VCALENDAR").unwrap();
    dir
}

pub fn roots(home: &Path) -> Roots {
    Roots {
        home: home.to_path_buf(),
    }
}

/// One bridge call as `caller`.
pub fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error),
    }
}

/// A session grant made as the person would, returning its id.
pub fn grant(core: &Core, caller: &str, permission: Value) -> String {
    let permission: Permission = serde_json::from_value(permission).unwrap();
    core.grant(caller, permission).grant_id
}

pub fn notes_read() -> Value {
    json!({ "permission": "fs:read", "paths": ["~/Documents/**"] })
}

pub fn calendar_read() -> Value {
    json!({ "permission": "fs:read", "paths": ["~/Calendar/**"] })
}

pub fn manage() -> Value {
    json!({ "permission": "perm:manage" })
}

pub fn plugin_manage() -> Value {
    json!({ "permission": "plugin:manage" })
}

/// fs.read of `~/Documents/hello.md` under `notes_read()`.
pub fn read_hello(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    call(
        core,
        caller,
        "fs.read",
        json!({ "path": "~/Documents/hello.md", "scope": notes_read() }),
    )
}

/// The caller's grants, as perm.query lists them.
pub fn query(core: &Core, caller: &str) -> Vec<Value> {
    call(core, caller, "perm.query", json!({})).unwrap()["grants"]
        .as_array()
        .unwrap()
        .clone()
}

/// The person says yes to everything.
pub struct SayYes;

impl Prompter for SayYes {
    fn ask(&self, _caller: &str, _permission: &Permission, _reason: &str) -> bool {
        true
    }
}

/// A prompter that must never be asked.
pub struct NeverAsk;

impl Prompter for NeverAsk {
    fn ask(&self, caller: &str, _permission: &Permission, _reason: &str) -> bool {
        panic!("the Prompter was asked for {caller}")
    }
}

/// A delivery as JSON: who it is for and the event.
#[derive(Debug, Clone, PartialEq)]
pub struct Seen {
    pub to: Option<Vec<String>>,
    pub event: Value,
}

impl Seen {
    pub fn name(&self) -> &str {
        self.event["event"].as_str().unwrap_or("")
    }

    pub fn data(&self) -> &Value {
        &self.event["data"]
    }

    pub fn is_for(&self, caller: &str) -> bool {
        self.to
            .as_ref()
            .is_none_or(|to| to.iter().any(|c| c == caller))
    }
}

fn seen(delivery: Delivery) -> Seen {
    Seen {
        to: delivery.to,
        event: serde_json::to_value(delivery.event).unwrap(),
    }
}

/// Everything delivered so far, without waiting.
pub fn drain(deliveries: &Receiver<Delivery>) -> Vec<Seen> {
    std::iter::from_fn(|| deliveries.try_recv().ok())
        .map(seen)
        .collect()
}

/// Every delivery of one event so far.
pub fn named(deliveries: &Receiver<Delivery>, name: &str) -> Vec<Seen> {
    drain(deliveries)
        .into_iter()
        .filter(|d| d.name() == name)
        .collect()
}

/// Wait for the next delivery of `name`, skipping others.
pub fn wait_for(deliveries: &Receiver<Delivery>, name: &str) -> Seen {
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| panic!("no {name} within 10 s"));
        let delivery = seen(delivery);
        if delivery.name() == name {
            return delivery;
        }
    }
}

pub fn strings(items: &[&str]) -> Option<Vec<String>> {
    Some(items.iter().map(|s| s.to_string()).collect())
}

/// Install `example.hello` (a UI plugin, not built in) from a folder under `home`.
pub fn install_hello(core: &Core, home: &Path) {
    let dir = home.join("plugins/hello");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    fs::write(
        dir.join("plugin.json"),
        r#"{ "id": "example.hello", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" }"#,
    )
    .unwrap();
    core.install_plugin(&dir, false);
}

/// plugin.setEnabled as `desk`, which must hold plugin:manage.
pub fn set_enabled(core: &Core, plugin: &str, enabled: bool) {
    call(
        core,
        "desk",
        "plugin.setEnabled",
        json!({ "plugin": plugin, "enabled": enabled, "scope": plugin_manage() }),
    )
    .unwrap();
}
