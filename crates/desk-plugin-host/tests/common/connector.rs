//! What the connector tests share: a fake clock from 2026-10-30T00:00:00Z, a sink that records what
//! reaches the index, folders of notes with chosen modification times, connector plugin folders,
//! and a desk that holds them together.

use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_bridge::{ConnectorState, ConnectorStatus, Item, ItemSource};
use desk_plugin_host::{Clock, ConnectorHost, ErrorCode, IndexSink, Limits, PluginError, rfc3339};
use serde_json::{Value, json};

use super::{MockHost, PluginDir};

/// The example connector's id.
pub const HELLO: &str = "example.hello-connector";
/// 2026-10-30T00:00:00Z, in seconds since the Unix epoch.
const T0: u64 = 1_793_318_400;

/// t0 plus `secs`, which may be negative.
pub fn time(secs: i64) -> SystemTime {
    let t0 = UNIX_EPOCH + Duration::from_secs(T0);
    let by = Duration::from_secs(secs.unsigned_abs());
    if secs < 0 { t0 - by } else { t0 + by }
}

/// `time(secs)` in RFC 3339, as the host writes times.
pub fn at(secs: i64) -> String {
    rfc3339(time(secs))
}

/// A clock that stays where a test sets it.
pub struct FakeClock(Mutex<SystemTime>);

impl FakeClock {
    pub fn set(&self, secs: i64) {
        *self.0.lock().unwrap() = time(secs);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> SystemTime {
        *self.0.lock().unwrap()
    }
}

/// One call that reached the sink; upserted items as JSON.
#[derive(Debug, Clone, PartialEq)]
pub enum Sent {
    Upsert(Vec<Value>),
    Remove(ItemSource, Vec<String>),
    Clear(ItemSource),
}

type Probe = Box<dyn Fn() -> Option<Value> + Send + Sync>;

/// An `IndexSink` that records every call, and can look at something (the stored cursor) at each
/// upsert.
#[derive(Default)]
pub struct RecordingSink {
    sent: Mutex<Vec<Sent>>,
    probe: Mutex<Option<Probe>>,
    probed: Mutex<Vec<Option<Value>>>,
}

impl RecordingSink {
    /// Every call since the last `take`.
    pub fn take(&self) -> Vec<Sent> {
        std::mem::take(&mut *self.sent.lock().unwrap())
    }

    pub fn is_empty(&self) -> bool {
        self.sent.lock().unwrap().is_empty()
    }

    /// Run `probe` at every upsert, before recording it.
    pub fn probe(&self, probe: impl Fn() -> Option<Value> + Send + Sync + 'static) {
        *self.probe.lock().unwrap() = Some(Box::new(probe));
    }

    pub fn probed(&self) -> Vec<Option<Value>> {
        self.probed.lock().unwrap().clone()
    }

    fn record(&self, sent: Sent) -> Result<(), String> {
        self.sent.lock().unwrap().push(sent);
        Ok(())
    }
}

impl IndexSink for RecordingSink {
    fn upsert(&self, items: &[Item]) -> Result<(), String> {
        if let Some(probe) = &*self.probe.lock().unwrap() {
            self.probed.lock().unwrap().push(probe());
        }
        let items = items.iter().map(|i| serde_json::to_value(i).unwrap());
        self.record(Sent::Upsert(items.collect()))
    }

    fn remove(&self, source: &ItemSource, ids: &[String]) -> Result<(), String> {
        self.record(Sent::Remove(source.clone(), ids.to_vec()))
    }

    fn clear(&self, source: &ItemSource) -> Result<(), String> {
        self.record(Sent::Clear(source.clone()))
    }
}

/// A temporary folder for notes, removed when dropped.
pub struct Folder {
    pub path: PathBuf,
}

impl Folder {
    pub fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let name = format!("desk-notes-{}-{n}", std::process::id());
        let folder = Self {
            path: std::env::temp_dir().join(name),
        };
        let _ = fs::remove_dir_all(&folder.path);
        folder.create();
        folder
    }

    /// The `folder` setting of an instance on this folder.
    pub fn settings(&self) -> Value {
        json!({ "folder": self.path.to_str().unwrap() })
    }

    /// Write `name` with `text`, last modified at `time(secs)`.
    pub fn write(&self, name: &str, text: &str, secs: i64) {
        let path = self.path.join(name);
        fs::write(&path, text).unwrap();
        let file = File::options().write(true).open(&path).unwrap();
        file.set_modified(time(secs)).unwrap();
    }

    pub fn remove(&self, name: &str) {
        fs::remove_file(self.path.join(name)).unwrap();
    }

    pub fn delete(&self) {
        fs::remove_dir_all(&self.path).unwrap();
    }

    pub fn create(&self) {
        fs::create_dir_all(&self.path).unwrap();
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// examples/plugin-hello-connector, with its committed component.
pub fn hello_connector() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plugin-hello-connector")
}

/// A copy of examples/plugin-hello-connector with its component, whose plugin.json `change` edits.
pub fn hello_connector_copy(change: impl FnOnce(&mut Value)) -> PluginDir {
    let example = hello_connector();
    let text = fs::read_to_string(example.join("plugin.json")).unwrap();
    let mut manifest: Value = serde_json::from_str(&text).unwrap();
    let entry = manifest["entry"].as_str().unwrap().to_owned();
    change(&mut manifest);
    let dir = PluginDir::manifest(manifest);
    fs::create_dir_all(dir.path.join(&entry).parent().unwrap()).unwrap();
    fs::copy(example.join(&entry), dir.path.join(&entry)).unwrap();
    dir
}

/// A Wasm connector `id` whose entry plugin.wasm holds `bytes`: notes, pulled every 300 s.
pub fn connector_dir(id: &str, bytes: &[u8]) -> PluginDir {
    let dir = PluginDir::manifest(json!({
        "id": id,
        "version": "0.1.0",
        "kind": "connector",
        "entry": "plugin.wasm",
        "connector": {
            "binding": "wasm",
            "auth": { "kind": "none" },
            "resources": [{ "kind": "note" }],
            "sync": { "mode": "pull", "intervalSeconds": 300 },
        },
    }));
    dir.write("plugin.wasm", bytes);
    dir
}

/// The pairs `tick` returns, from (connector, instance) names.
pub fn ran(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    let pairs = pairs
        .iter()
        .map(|(c, i)| ((*c).to_owned(), (*i).to_owned()));
    pairs.collect()
}

/// A connector host on a mock host (files on disk for absolute paths), a recording sink and a fake
/// clock at t0.
pub struct Desk {
    pub host: Arc<MockHost>,
    pub sink: Arc<RecordingSink>,
    pub clock: Arc<FakeClock>,
    pub connectors: ConnectorHost,
}

impl Desk {
    pub fn new(limits: Limits) -> Self {
        let host = MockHost::new();
        let sink = Arc::new(RecordingSink::default());
        let clock = Arc::new(FakeClock(Mutex::new(time(0))));
        let connectors =
            ConnectorHost::new(host.clone(), sink.clone(), clock.clone(), limits).unwrap();
        Self {
            host,
            sink,
            clock,
            connectors,
        }
    }

    /// Another connector host on the same host, sink and clock, as after a restart.
    pub fn again(&self) -> ConnectorHost {
        let (host, sink, clock) = (self.host.clone(), self.sink.clone(), self.clock.clone());
        ConnectorHost::new(host, sink, clock, Limits::default()).unwrap()
    }

    /// Install the example (again) and connect `instance` to `folder`.
    pub fn hello(&self, instance: &str, folder: &Folder) -> ConnectorStatus {
        self.connectors.install(&hello_connector()).unwrap();
        let created = self
            .connectors
            .create_instance(HELLO, instance, folder.settings());
        created.unwrap()
    }

    /// Move the clock to `time(secs)` and tick: the pairs that ran.
    pub fn tick_at(&self, secs: i64) -> Vec<(String, String)> {
        self.clock.set(secs);
        self.connectors.tick()
    }
}

/// The example's source for `instance`.
pub fn source(instance: &str) -> ItemSource {
    let (connector, instance) = (HELLO.to_owned(), instance.to_owned());
    ItemSource {
        connector,
        instance,
    }
}

/// The upserts and removes of one sync, in order, with each upsert as its items' ids.
pub fn ids(sent: &[Sent]) -> Vec<(&'static str, Vec<String>)> {
    let id = |item: &Value| item["id"].as_str().unwrap().to_owned();
    let call = |sent: &Sent| match sent {
        Sent::Upsert(items) => ("upsert", items.iter().map(id).collect()),
        Sent::Remove(_, ids) => ("remove", ids.clone()),
        Sent::Clear(_) => ("clear", vec![]),
    };
    sent.iter().map(call).collect()
}

pub fn host_error(result: Result<impl std::fmt::Debug, PluginError>, code: ErrorCode) {
    match result {
        Err(PluginError::Host(error)) => assert_eq!(error.code, code, "{error:?}"),
        other => panic!("expected the host's {code:?}, got {other:?}"),
    }
}

pub fn guest_error(result: Result<impl std::fmt::Debug, PluginError>, code: ErrorCode) {
    match result {
        Err(PluginError::Guest(error)) => assert_eq!(error.code, code, "{error:?}"),
        other => panic!("expected the guest's {code:?}, got {other:?}"),
    }
}

/// The state and error message of one instance.
pub fn state(desk: &Desk, connector: &str, instance: &str) -> (ConnectorState, String) {
    let status = desk.connectors.status(connector, instance).unwrap();
    (
        status.state,
        status.error.map(|e| e.message).unwrap_or_default(),
    )
}
