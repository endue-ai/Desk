//! Helpers for the integration layer's tests (data, connectors, views, catalog): a desk with an item
//! index on a temp file, a fake calendar, a fake clock, a temp home and a data folder; bridge calls
//! and grants; the addressed deliveries seen so far; and copies of examples/plugin-hello-connector.
#![allow(dead_code)]

pub mod fixtures;

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeError, BridgeRequest, BridgeResponse, ErrorCode, Item, Permission};
use desk_core::{Core, Delivery, Prompter, Roots};
use desk_index::{Index, ItemIndex};
use desk_plugin_host::{Clock, rfc3339};
use desk_sys::calendar::CalendarSource;
use serde_json::{Value, json};

/// 2026-10-30T00:00:00Z: where every fake clock starts.
pub const NOW: u64 = 1_793_318_400;
pub const HOUR: u64 = 3_600;
pub const DAY: u64 = 86_400;
pub const HELLO: &str = "example.hello-connector";

/// RFC 3339 for seconds since the epoch, as the core writes it.
pub fn time(secs: u64) -> String {
    rfc3339(UNIX_EPOCH + Duration::from_secs(secs))
}

/// A clock that moves only when a test moves it.
pub struct FakeClock(Mutex<SystemTime>);

impl FakeClock {
    pub fn new() -> Self {
        Self(Mutex::new(UNIX_EPOCH + Duration::from_secs(NOW)))
    }

    pub fn advance(&self, secs: u64) {
        *self.0.lock().unwrap() += Duration::from_secs(secs);
    }

    pub fn text(&self) -> String {
        rfc3339(self.now())
    }
}

impl Clock for FakeClock {
    fn now(&self) -> SystemTime {
        *self.0.lock().unwrap()
    }
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A fresh empty folder under the temp folder.
pub fn temp(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("desk-{tag}-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A desk as the app builds one, with its files in `data`, connectors started and every addressed
/// delivery recorded in `seen`.
pub struct Desk {
    pub core: Arc<Core>,
    pub home: PathBuf,
    pub data: PathBuf,
    pub clock: Arc<FakeClock>,
    pub index: Arc<Index>,
    pub seen: Receiver<Delivery>,
}

impl Desk {
    /// A desk with `calendar` as its OS calendar, or none.
    pub fn new(tag: &str, calendar: Option<Arc<dyn CalendarSource>>) -> Self {
        let root = temp(tag);
        let (home, data) = (root.join("home"), root.join("data"));
        fs::create_dir_all(&home).unwrap();
        Self::open(home, data, Arc::new(FakeClock::new()), calendar, false)
    }

    /// A desk without a calendar whose person says yes to every perm.request.
    pub fn saying_yes(tag: &str) -> Self {
        let root = temp(tag);
        let (home, data) = (root.join("home"), root.join("data"));
        fs::create_dir_all(&home).unwrap();
        Self::open(home, data, Arc::new(FakeClock::new()), None, true)
    }

    /// A second desk over the same home, clock and files (store, secrets, plugins, index), as after
    /// a restart. The first one is dropped first.
    pub fn restart(self, calendar: Option<Arc<dyn CalendarSource>>) -> Self {
        let Desk {
            core,
            home,
            data,
            clock,
            index,
            seen,
        } = self;
        drop((core, index, seen));
        Self::open(home, data, clock, calendar, false)
    }

    fn open(
        home: PathBuf,
        data: PathBuf,
        clock: Arc<FakeClock>,
        calendar: Option<Arc<dyn CalendarSource>>,
        yes: bool,
    ) -> Self {
        let index = Arc::new(Index::open(data.join("index.sqlite")).unwrap());
        let shared: Arc<dyn ItemIndex> = index.clone();
        let mut core = Core::new(Roots { home: home.clone() })
            .with_plugin_store(data.join("plugins.json"))
            .with_store_file(data.join("store.json"))
            .with_secrets_file(data.join("secrets.json"))
            .with_index(shared)
            .with_clock(clock.clone());
        if let Some(calendar) = calendar {
            core = core.with_calendar(calendar);
        }
        if yes {
            core = core.with_prompter(SayYes);
        }
        let core = Arc::new(core);
        let seen = core.events().subscribe_addressed();
        core.start_connectors();
        Self {
            core,
            home,
            data,
            clock,
            index,
            seen,
        }
    }

    pub fn call(&self, caller: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
        call(&self.core, caller, method, params)
    }

    /// A call that must succeed.
    pub fn ok(&self, caller: &str, method: &str, params: Value) -> Value {
        self.call(caller, method, params)
            .unwrap_or_else(|e| panic!("{method} as {caller}: {e:?}"))
    }

    /// A call that must fail with `code`; returns the error.
    pub fn fails(&self, caller: &str, method: &str, params: Value, code: ErrorCode) -> BridgeError {
        let error = match self.call(caller, method, params) {
            Ok(result) => panic!("{method} as {caller} answered {result}"),
            Err(error) => error,
        };
        assert_eq!(error.code, code, "{method} as {caller}: {}", error.message);
        error
    }

    /// A session grant, as the person would make it; returns its id.
    pub fn grant(&self, caller: &str, permission: Value) -> String {
        let permission: Permission = serde_json::from_value(permission).unwrap();
        self.core.grant(caller, permission).grant_id
    }

    /// Run every due sync, as the scheduler does each second.
    pub fn tick(&self) {
        self.core.tick_connectors();
    }

    /// Put items straight into the index, as a connector's sync would.
    pub fn upsert(&self, items: &[Value]) {
        let items: Vec<Item> = items.iter().map(|i| item(i.clone())).collect();
        self.index.upsert(&items).unwrap();
    }

    /// Every delivery so far, without waiting.
    pub fn drain(&self) -> Vec<(Option<Vec<String>>, Value)> {
        std::iter::from_fn(|| self.seen.try_recv().ok())
            .map(|d| (d.to, serde_json::to_value(d.event).unwrap()))
            .collect()
    }

    /// Every delivery of the event `name` so far, after waiting `settle` for stragglers.
    pub fn named(&self, name: &str, settle: Duration) -> Vec<(Option<Vec<String>>, Value)> {
        std::thread::sleep(settle);
        self.drain()
            .into_iter()
            .filter(|(_, event)| event["event"] == name)
            .collect()
    }

    /// Wait for the next delivery of `name`, skipping others: who it is for, and its data.
    pub fn wait_for(&self, name: &str) -> (Option<Vec<String>>, Value) {
        loop {
            let delivery = self
                .seen
                .recv_timeout(Duration::from_secs(10))
                .unwrap_or_else(|_| panic!("no {name} within 10 s"));
            let event = serde_json::to_value(delivery.event).unwrap();
            if event["event"] == name {
                return (delivery.to, event["data"].clone());
            }
        }
    }

    /// data.query as `desk`, which gets an unlimited data:read grant for it.
    pub fn items(&self, query: Value) -> Vec<Value> {
        self.grant("desk", json!({ "permission": "data:read" }));
        let scope = json!({ "permission": "data:read" });
        let page = self.ok(
            "desk",
            "data.query",
            json!({ "query": query, "scope": scope }),
        );
        page["items"].as_array().unwrap().clone()
    }

    /// connector.list as `desk`, which gets connector:manage for it.
    pub fn connectors(&self) -> Vec<Value> {
        self.grant("desk", connector_manage());
        let scope = connector_manage();
        let listed = self.ok("desk", "connector.list", json!({ "scope": scope }));
        listed["connectors"].as_array().unwrap().clone()
    }

    /// The instances of one connector as connector.list lists them.
    pub fn instances(&self, connector: &str) -> Vec<Value> {
        let all = self.connectors();
        let found = all.iter().find(|c| c["id"] == connector);
        let found = found.unwrap_or_else(|| panic!("{connector} is not listed: {all:?}"));
        found["instances"].as_array().unwrap().clone()
    }

    /// connector.connect as `desk` (granted connector:manage); the answer.
    pub fn connect(&self, params: Value) -> Result<Value, BridgeError> {
        self.grant("desk", connector_manage());
        let mut params = params;
        params["scope"] = connector_manage();
        self.call("desk", "connector.connect", params)
    }
}

/// The person says yes to everything.
pub struct SayYes;

impl Prompter for SayYes {
    fn ask(&self, _caller: &str, _permission: &Permission, _reason: &str) -> bool {
        true
    }
}

/// One bridge call as `caller`.
pub fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, BridgeError> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params }))
            .unwrap_or_else(|e| panic!("{method} is not a bridge request: {e}"));
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err(err.error),
    }
}

pub fn connector_manage() -> Value {
    json!({ "permission": "connector:manage" })
}

pub fn view_manage() -> Value {
    json!({ "permission": "view:manage" })
}

pub fn item(value: Value) -> Item {
    serde_json::from_value(value.clone()).unwrap_or_else(|e| panic!("not an item ({e}): {value}"))
}

pub fn source(connector: &str, instance: &str) -> Value {
    json!({ "connector": connector, "instance": instance })
}

/// The ids of a list of items, in order.
pub fn ids(items: &[Value]) -> Vec<String> {
    items
        .iter()
        .map(|i| i["id"].as_str().unwrap().to_owned())
        .collect()
}
