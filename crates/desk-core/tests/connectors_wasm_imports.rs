//! A Wasm connector's `net.fetch`, `settings.*` and `log.*` reach the core's bridge handlers as the
//! plugin, under its own grants (#589): a fetch goes out inside the person's `net:fetch` grant and is
//! refused outside it, its settings round-trip, and its log lines land in its own channel. Each
//! connector is component WAT (`connectors_wasm_imports/component.rs`) synced on an explicit tick;
//! every server is an in-process listener on 127.0.0.1, never the network.

#[path = "connectors_wasm_imports/component.rs"]
mod component;
mod layer;
#[path = "connectors_wasm_imports/listener.rs"]
mod listener;

use std::fs;
use std::time::Duration;

use component::{Level, Step};
use layer::Desk;
use listener::{assert_no_connection, serve, untouched};
use serde_json::{Value, json};

const CONNECTOR: &str = "example.imports-connector";
const WAIT: Duration = Duration::from_secs(5);

/// Install a connector plugin whose `sync` runs `steps`, declaring `permissions` in its manifest.
fn install(desk: &Desk, steps: &[Step], permissions: Value) {
    let dir = desk.home.join("plugins/imports-connector");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("connector.wasm"), component::connector(steps)).unwrap();
    let manifest = json!({
        "id": CONNECTOR,
        "name": "Imports connector",
        "version": "0.1.0",
        "kind": "connector",
        "entry": "connector.wasm",
        "permissions": permissions,
        "connector": {
            "binding": "wasm",
            "auth": { "kind": "none" },
            "resources": [{ "kind": "note" }],
            "sync": { "mode": "pull", "intervalSeconds": 300 }
        }
    });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    desk.core.install_plugin(&dir, false);
}

/// Connect the connector's default instance and run its first sync: its status after it.
fn synced(desk: &Desk) -> Value {
    desk.connect(json!({ "connector": CONNECTOR })).unwrap();
    desk.tick();
    let instances = desk.instances(CONNECTOR);
    assert_eq!(instances.len(), 1, "{instances:?}");
    instances[0]["status"].clone()
}

/// log.tail of one channel as `desk`, which gets `log:read` for it.
fn tail(desk: &Desk, channel: &str) -> Vec<Value> {
    desk.grant("desk", json!({ "permission": "log:read" }));
    let params = json!({ "channel": channel, "scope": { "permission": "log:read" } });
    let tail = desk.ok("desk", "log.tail", params);
    tail["entries"].as_array().unwrap().clone()
}

/// The messages of the connector's own channel, oldest first.
fn messages(desk: &Desk) -> Vec<String> {
    tail(desk, CONNECTOR)
        .iter()
        .map(|entry| entry["message"].as_str().unwrap().to_owned())
        .collect()
}

fn net_fetch(host: String) -> Value {
    json!({ "permission": "net:fetch", "hosts": [host] })
}

#[test]
fn a_wasm_connector_fetches_inside_its_net_fetch_grant() {
    let desk = Desk::new("wasm-imports-fetch", None);
    let body = r#"{"greeting":"hello"}"#;
    let (port, seen) = serve(body);
    let url = format!("http://127.0.0.1:{port}/hello");
    install(
        &desk,
        &[Step::FetchAndLog(&url)],
        json!([net_fetch("127.0.0.1".into())]),
    );
    desk.grant(CONNECTOR, net_fetch(format!("127.0.0.1:{port}")));

    let status = synced(&desk);
    assert_eq!(status["state"], "connected", "{status}");
    let seen = seen
        .recv_timeout(WAIT)
        .expect("the fetch reached the listener");
    assert_eq!(
        (seen.method.as_str(), seen.target.as_str()),
        ("GET", "/hello")
    );
    assert_eq!(
        messages(&desk),
        [body],
        "the guest read the body it fetched"
    );
}

#[test]
fn a_wasm_connector_fetch_outside_its_grant_is_refused() {
    let desk = Desk::new("wasm-imports-refused", None);
    let (listener, outside) = untouched();
    let (granted, _seen) = serve("{}");
    let url = format!("http://127.0.0.1:{outside}/hello");
    install(
        &desk,
        &[Step::FetchAndLog(&url)],
        json!([net_fetch("127.0.0.1".into())]),
    );
    desk.grant(CONNECTOR, net_fetch(format!("127.0.0.1:{granted}")));

    let status = synced(&desk);
    assert_eq!(status["state"], "error", "{status}");
    let message = status["error"]["message"].as_str().unwrap_or_default();
    assert!(
        message.starts_with("permission-denied: "),
        "the guest met the core's refusal: {status}"
    );
    assert_no_connection(&listener);
    assert!(
        messages(&desk).is_empty(),
        "the sync stopped at the refusal"
    );
}

#[test]
fn a_wasm_connectors_settings_round_trip() {
    let desk = Desk::new("wasm-imports-settings", None);
    let text = r#"{"hello":"world","n":2}"#;
    install(
        &desk,
        &[Step::Set("greeting", text), Step::GetAndLog("greeting")],
        json!([]),
    );

    let status = synced(&desk);
    assert_eq!(status["state"], "connected", "{status}");
    assert_eq!(messages(&desk), [text], "the guest read back what it set");
    let value = json!({ "hello": "world", "n": 2 });
    let got = desk.ok(CONNECTOR, "settings.get", json!({ "key": "greeting" }));
    assert_eq!(got["value"], value);
    let listed = desk.ok(CONNECTOR, "settings.list", json!({}));
    assert_eq!(
        listed["settings"],
        json!([{ "owner": CONNECTOR, "key": "greeting", "value": value }])
    );
}

#[test]
fn a_wasm_connectors_log_lines_land_in_its_own_channel() {
    let desk = Desk::new("wasm-imports-log", None);
    let line = "synced 3 notes";
    install(
        &desk,
        &[Step::Log(Level::Warn, line, Some(r#"{"notes":3}"#))],
        json!([]),
    );

    let status = synced(&desk);
    assert_eq!(status["state"], "connected", "{status}");
    let entries = tail(&desk, CONNECTOR);
    assert_eq!(entries.len(), 1, "{entries:?}");
    let entry = &entries[0];
    assert_eq!(entry["channel"], CONNECTOR);
    assert_eq!(entry["level"], "warn");
    assert_eq!(entry["message"], line);
    assert_eq!(entry["fields"], json!({ "notes": 3 }));
    let core = tail(&desk, "core");
    assert!(
        core.iter().all(|entry| entry["message"] != line),
        "not in the core's channel: {core:?}"
    );
}
