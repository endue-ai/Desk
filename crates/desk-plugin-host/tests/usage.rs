//! What each plugin uses, as the host measures it: the linear memory its store holds now, and since
//! install the time its guest ran less the time inside its imports, its calls into the guest and the
//! guest's imports. The numbers come from the host, so a mock that waits and counts proves them.

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use common::{Desk, HELLO, MockHost, PluginDir, component, fine, hello_connector_copy, hello_wasm};
use desk_bridge::ItemQuery;
use desk_plugin_host::{Limits, LogicHost, PluginError, Usage};
use serde_json::json;

/// One page of Wasm linear memory.
const PAGE: usize = 65_536;
const FILE: &str = "${plugin}/hello.txt";
const GREET: &str = "example.hello-wasm.greet";

fn logic(host: &std::sync::Arc<MockHost>, limits: Limits) -> LogicHost {
    LogicHost::new(host.clone(), limits).unwrap()
}

/// The calls the mock recorded from `plugin` whose method is one of `methods` (all when empty).
fn recorded(host: &MockHost, plugin: &str, methods: &[&str]) -> u64 {
    let calls = host.calls().into_iter().filter(|(from, method, _)| {
        from == plugin && (methods.is_empty() || methods.contains(&method.as_str()))
    });
    calls.count() as u64
}

/// examples/plugin-hello-connector/notes, as an absolute path without `..`.
fn sample_notes() -> PathBuf {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo = repo.ancestors().nth(2).unwrap();
    repo.join("examples/plugin-hello-connector/notes")
}

#[test]
fn usage_is_the_linear_memory_the_store_holds() {
    let grow = component("(drop (memory.grow (i32.const 16)))", "");
    let dir = PluginDir::logic("test.grow", json!([]), &grow);
    let mut logic = logic(&MockHost::new(), Limits::default());
    let id = logic.install(&dir.path).unwrap();
    assert_eq!(logic.usage(&id).unwrap().memory_bytes, PAGE);

    logic.start(&id).unwrap();
    assert_eq!(logic.usage(&id).unwrap().memory_bytes, 17 * PAGE);
}

#[test]
fn cpu_time_counts_guest_code_even_when_the_time_limit_stops_it() {
    let spin = component("(loop $forever (br $forever))", "");
    let dir = PluginDir::logic("test.spin", json!([]), &spin);
    let limits = Limits {
        time: Duration::from_millis(200),
        ..Limits::default()
    };
    let mut logic = logic(&MockHost::new(), limits);
    let id = logic.install(&dir.path).unwrap();

    let result = logic.start(&id);
    assert!(matches!(result, Err(PluginError::TimeLimit)), "{result:?}");
    let usage = logic.usage(&id).unwrap();
    assert!(usage.cpu_time >= Duration::from_millis(150), "{usage:?}");
    assert_eq!(usage.calls, 1, "{usage:?}");
}

#[test]
fn cpu_time_leaves_out_the_time_inside_imports() {
    let host = MockHost::with_file(FILE, b"Hi");
    host.delay("fs.read", Duration::from_millis(300));
    let mut logic = logic(&host, Limits::default());
    let id = logic.install(&hello_wasm()).unwrap();

    let started = Instant::now();
    logic.start(&id).unwrap();
    let wall = started.elapsed();
    assert!(wall >= Duration::from_millis(300), "{wall:?}");
    let usage = logic.usage(&id).unwrap();
    assert!(usage.cpu_time < Duration::from_millis(150), "{usage:?}");
}

#[test]
fn calls_and_imports_count_from_install() {
    let host = MockHost::with_file(FILE, b"Hi");
    let mut logic = logic(&host, Limits::default());
    let id = logic.install(&hello_wasm()).unwrap();
    let installed = logic.usage(&id).unwrap();
    assert_eq!(
        (installed.calls, installed.imports),
        (0, 0),
        "{installed:?}"
    );

    logic.start(&id).unwrap();
    let started = logic.usage(&id).unwrap();
    let imported = recorded(&host, &id, &[]);
    assert!(imported > 0, "{:?}", host.calls());
    assert_eq!((started.calls, started.imports), (1, imported));

    let args = json!({ "name": "Ada" });
    logic.deliver_command(&id, "inv-1", GREET, &args).unwrap();
    assert_eq!(logic.usage(&id).unwrap().calls, 2);
    logic.deliver_event(&id, "desk.test", &json!({})).unwrap();
    let delivered = logic.usage(&id).unwrap();
    assert_eq!(delivered.calls, 3);
    assert_eq!(delivered.imports, recorded(&host, &id, &[]));
}

#[test]
fn a_trap_frees_the_memory_and_a_reload_keeps_counting() {
    let dir = PluginDir::logic("test.trap", json!([]), &component("unreachable", ""));
    let mut logic = logic(&MockHost::new(), Limits::default());
    let id = logic.install(&dir.path).unwrap();
    let result = logic.start(&id);
    assert!(matches!(result, Err(PluginError::Trap(_))), "{result:?}");
    let trapped = logic.usage(&id).unwrap();
    assert_eq!((trapped.memory_bytes, trapped.calls), (0, 1), "{trapped:?}");

    dir.write("plugin.wasm", &fine());
    logic.reload(&id).unwrap();
    let reloaded = logic.usage(&id).unwrap();
    assert_eq!((reloaded.memory_bytes, reloaded.calls), (PAGE, 2));
    assert!(reloaded.cpu_time >= trapped.cpu_time, "{reloaded:?}");
}

#[test]
fn usages_lists_every_installed_plugin_by_id() {
    let mut logic = logic(&MockHost::new(), Limits::default());
    let (b, a) = (fine(), fine());
    let b = PluginDir::logic("test.b", json!([]), &b);
    let a = PluginDir::logic("test.a", json!([]), &a);
    logic.install(&b.path).unwrap();
    logic.install(&a.path).unwrap();
    let ids =
        |usages: Vec<(String, Usage)>| usages.into_iter().map(|(id, _)| id).collect::<Vec<_>>();
    assert_eq!(ids(logic.usages()), ["test.a", "test.b"]);
    let (usage_a, usage_b) = (logic.usage("test.a"), logic.usage("test.b"));
    let expected = vec![
        ("test.a".into(), usage_a.unwrap()),
        ("test.b".into(), usage_b.unwrap()),
    ];
    assert_eq!(logic.usages(), expected);

    assert!(logic.remove("test.a"));
    let gone = logic.usage("test.a");
    assert_eq!(gone, Err(PluginError::NotInstalled("test.a".into())));
    assert_eq!(ids(logic.usages()), ["test.b"]);
}

#[test]
fn a_connector_usage_covers_its_store_and_every_guest_call() {
    let desk = Desk::new(Limits::default());
    let open = "example.hello-connector.open";
    let declared = hello_connector_copy(|m| {
        m["connector"]["resources"][0]["actions"] = json!([open]);
        m["contributes"] = json!({ "commands": [{ "id": open, "title": "Open" }] });
    });
    let connectors = &desk.connectors;
    connectors.install(&declared.path).unwrap();
    let installed = connectors.usage(HELLO).unwrap();
    assert!(installed.memory_bytes > 0, "{installed:?}");
    assert_eq!(
        (installed.calls, installed.imports),
        (0, 0),
        "{installed:?}"
    );
    let calls = || connectors.usage(HELLO).unwrap().calls;

    let folder = json!({ "folder": sample_notes().to_str().unwrap() });
    connectors
        .create_instance(HELLO, "default", folder)
        .unwrap();
    assert_eq!(calls(), 1, "status");
    assert_eq!(desk.tick_at(0).len(), 1);
    assert_eq!(calls(), 2, "one sync round");
    connectors.sync_now(HELLO, "default").unwrap();
    assert_eq!(calls(), 3, "one more sync round");
    let query: ItemQuery = serde_json::from_value(json!({ "kinds": ["note"] })).unwrap();
    assert!(connectors.query(HELLO, "default", &query).is_err());
    assert_eq!(calls(), 4, "query");
    assert!(connectors.act(HELLO, "default", open, &json!({})).is_err());
    assert_eq!(calls(), 5, "act");
    assert!(
        connectors
            .act(HELLO, "default", "undeclared", &json!({}))
            .is_err()
    );
    assert_eq!(calls(), 5, "an undeclared action never reaches the guest");

    let usage = connectors.usage(HELLO).unwrap();
    let guest = recorded(&desk.host, HELLO, &["fs.list", "fs.read"]);
    let own = recorded(&desk.host, HELLO, &["store.get", "store.set"]);
    assert!(guest > 0 && own > 0, "{:?}", desk.host.calls());
    assert_eq!(recorded(&desk.host, HELLO, &[]), guest + own);
    assert_eq!(usage.imports, guest, "{:?}", desk.host.calls());
    assert!(usage.cpu_time > Duration::ZERO, "{usage:?}");
    assert_eq!(connectors.usages(), [(HELLO.to_owned(), usage)]);

    let missing = connectors.usage("test.none");
    assert_eq!(missing, Err(PluginError::NotInstalled("test.none".into())));
}
