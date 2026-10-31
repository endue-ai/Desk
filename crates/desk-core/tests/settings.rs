//! settings.get, settings.set and settings.list (ADR 0031): keys per owner, read through three layers
//! (the manifest default, init.yaml, the set value), another owner's keys under `settings:read`,
//! `settings.changed` on the bus, and set values kept in one file across a restart.

mod support;

use std::fs;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const HELLO: &str = "example.hello";
const OTHER: &str = "example.other";
const WATCHER: &str = "example.watcher";
const NOSY: &str = "example.nosy";

fn read_scope(keys: &[&str]) -> Value {
    json!({ "permission": "settings:read", "keys": keys })
}

fn set(core: &Core, caller: &str, key: &str, value: Value) -> Result<Value, BridgeError> {
    call(
        core,
        caller,
        "settings.set",
        json!({ "key": key, "value": value }),
    )
}

fn get(core: &Core, caller: &str, params: Value) -> Result<Value, BridgeError> {
    call(core, caller, "settings.get", params)
}

fn list(core: &Core, caller: &str, params: Value) -> Result<Vec<Value>, BridgeError> {
    let listed = call(core, caller, "settings.list", params)?;
    Ok(listed["settings"].as_array().unwrap().clone())
}

fn setting(owner: &str, key: &str, value: Value) -> Value {
    json!({ "owner": owner, "key": key, "value": value })
}

/// example.hello installed from a folder whose plugin.json contributes `greeting` ("hi") and
/// `volume` (3), and one name outside its id; init.yaml sets `example.hello.greeting` to "hello".
fn layered(tag: &str) -> Core {
    let home = home(tag);
    let init = home.join(".desk/init.yaml");
    fs::create_dir_all(init.parent().unwrap()).unwrap();
    fs::write(&init, "settings:\n  example.hello.greeting: hello\n").unwrap();
    let core = Core::new(roots(&home)).with_init_file(init);
    let dir = home.join("plugins/hello");
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({ "id": HELLO, "version": "0.1.0", "kind": "policy",
        "contributes": { "settings": {
            "example.hello.greeting": { "kind": "string", "default": "hi" },
            "example.hello.volume": { "kind": "integer", "default": 3 },
            "example.other.stolen": { "kind": "string", "default": "not hello's" } } } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    let info = core.install_plugin(&dir, false);
    assert_eq!(info.error, None);
    core
}

#[test]
fn a_set_value_is_returned_to_its_owner_and_to_no_one_else_without_a_scope() {
    let core = Core::new(roots(&home("settings-own")));
    assert_eq!(
        set(&core, HELLO, "greeting", json!("hey")).unwrap(),
        json!({})
    );
    let own = json!({ "value": "hey" });
    assert_eq!(
        get(&core, HELLO, json!({ "key": "greeting" })).unwrap(),
        own
    );
    let named = get(&core, HELLO, json!({ "key": "greeting", "owner": HELLO }));
    assert_eq!(named.unwrap(), own);
    assert_eq!(
        get(&core, OTHER, json!({ "key": "greeting" })).unwrap(),
        json!({}),
        "example.other reads its own namespace"
    );

    let denied = get(&core, OTHER, json!({ "key": "greeting", "owner": HELLO })).unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    assert_eq!(
        serde_json::to_value(denied.permission).unwrap(),
        read_scope(&["example.hello/greeting"])
    );
}

#[test]
fn reading_resolves_the_manifest_default_then_init_yaml_then_the_set_value() {
    let core = layered("settings-layers");
    let read = |key: &str| get(&core, HELLO, json!({ "key": key })).unwrap();
    assert_eq!(read("greeting"), json!({ "value": "hello" }));
    assert_eq!(read("volume"), json!({ "value": 3 }));
    assert_eq!(read("missing"), json!({}));

    set(&core, HELLO, "greeting", json!("hey")).unwrap();
    assert_eq!(read("greeting"), json!({ "value": "hey" }));
    assert_eq!(read("volume"), json!({ "value": 3 }));

    let init = call(&core, HELLO, "init.get", json!({})).unwrap();
    assert_eq!(
        init["settings"],
        json!({ "example.hello.greeting": "hello" })
    );
    assert_eq!(
        get(&core, OTHER, json!({ "key": "stolen" })).unwrap(),
        json!({}),
        "a plugin's names outside its own id are ignored"
    );
}

#[test]
fn another_owners_setting_is_read_under_a_settings_read_scope_that_covers_it() {
    let core = layered("settings-scope");
    grant(&core, OTHER, read_scope(&["example.hello/*"]));
    let read = |scope: &[&str]| {
        get(
            &core,
            OTHER,
            json!({ "key": "greeting", "owner": HELLO, "scope": read_scope(scope) }),
        )
    };
    assert_eq!(
        read(&["example.hello/greeting"]).unwrap(),
        json!({ "value": "hello" })
    );
    for scope in [&["*/*"][..], &["example.hello/volume"][..]] {
        let denied = read(scope).unwrap_err();
        assert_eq!(denied.code, ErrorCode::PermissionDenied, "{scope:?}");
    }
}

#[test]
fn list_is_the_callers_own_by_key_or_everything_a_scope_covers_by_owner_then_key() {
    let core = layered("settings-list");
    set(&core, HELLO, "mood", json!("calm")).unwrap();
    set(&core, OTHER, "theme", json!("dark")).unwrap();
    let hellos = vec![
        setting(HELLO, "greeting", json!("hello")),
        setting(HELLO, "mood", json!("calm")),
        setting(HELLO, "volume", json!(3)),
    ];
    assert_eq!(list(&core, HELLO, json!({})).unwrap(), hellos);

    let everything = json!({ "scope": read_scope(&["*/*"]) });
    let denied = list(&core, OTHER, everything.clone()).unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    grant(&core, OTHER, read_scope(&["*/*"]));
    let mut all = hellos.clone();
    all.push(setting(OTHER, "theme", json!("dark")));
    assert_eq!(list(&core, OTHER, everything).unwrap(), all);

    let narrow = json!({ "scope": read_scope(&["example.hello/v*"]) });
    assert_eq!(
        list(&core, OTHER, narrow).unwrap(),
        vec![setting(HELLO, "volume", json!(3))]
    );
    assert_eq!(
        list(&core, OTHER, json!({})).unwrap(),
        vec![setting(OTHER, "theme", json!("dark"))]
    );
}

#[test]
fn settings_changed_reaches_the_bus_with_the_owner_key_and_value() {
    let core = Core::new(roots(&home("settings-changed")));
    let events = core.events().subscribe();
    set(&core, HELLO, "greeting", json!("hey")).unwrap();
    let changed: Vec<Value> = std::iter::from_fn(|| events.try_recv().ok())
        .map(|event| serde_json::to_value(event).unwrap())
        .filter(|event| event["event"] == "settings.changed")
        .collect();
    assert_eq!(
        changed,
        vec![json!({ "event": "settings.changed",
                     "data": { "owner": HELLO, "key": "greeting", "value": "hey" } })]
    );
}

#[test]
fn settings_changed_is_for_the_owner_and_subscribers_whose_settings_read_covers_it() {
    let core = Core::new(roots(&home("settings-to")));
    let names = ["settings.changed"];
    let subscribe = json!({ "names": names,
        "scope": { "permission": "events:subscribe", "names": names } });
    for caller in [WATCHER, NOSY] {
        grant(&core, caller, subscribe["scope"].clone());
        call(&core, caller, "events.subscribe", subscribe.clone()).unwrap();
    }
    grant(&core, WATCHER, read_scope(&["example.hello/*"]));
    let deliveries = core.events().subscribe_addressed();

    set(&core, HELLO, "greeting", json!("hey")).unwrap();
    set(&core, OTHER, "theme", json!("dark")).unwrap();
    let seen = named(&deliveries, "settings.changed");
    let to: Vec<_> = seen.iter().map(|d| d.to.clone()).collect();
    assert_eq!(to, vec![strings(&[HELLO, WATCHER]), strings(&[OTHER])]);
}

#[test]
fn keys_outside_the_pattern_and_values_over_64_kib_are_refused() {
    let core = Core::new(roots(&home("settings-refused")));
    let events = core.events().subscribe();
    let big = "x".repeat(70 * 1024);
    for (key, value) in [("Bad Key", json!("v")), ("big", json!(big))] {
        let refused = set(&core, HELLO, key, value).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidParams, "{key}");
    }
    assert_eq!(list(&core, HELLO, json!({})).unwrap(), Vec::<Value>::new());
    assert!(events.try_recv().is_err(), "no event for a refused set");
}

#[test]
fn set_values_survive_a_new_core_over_the_same_file() {
    let home = home("settings-file");
    let file = home.join("data/settings.json");
    let first = Core::new(roots(&home)).with_settings_file(file.clone());
    set(&first, HELLO, "greeting", json!("hey")).unwrap();
    drop(first);

    let again = Core::new(roots(&home)).with_settings_file(file.clone());
    let read = get(&again, HELLO, json!({ "key": "greeting" })).unwrap();
    assert_eq!(read, json!({ "value": "hey" }));
    let saved: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(saved, json!({ "example.hello": { "greeting": "hey" } }));
    let stored = call(&again, HELLO, "store.get", json!({ "key": "greeting" })).unwrap();
    assert_eq!(stored, json!({}), "settings are not store values");
}
