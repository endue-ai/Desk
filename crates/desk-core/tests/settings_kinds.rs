//! Values checked against their settings (ADR 0080): every kind, choices, minimum, maximum and
//! pattern. A value in init.yaml or in settings.json that fails falls back to the default;
//! settings.set refuses one with invalid_value.

mod support;

use std::fs;
use std::path::Path;

use desk_bridge::{BridgeEvent, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const KINDS: &str = "example.kinds";

/// example.kinds declares one setting of each kind, with a range on the numbers and a pattern.
fn install_kinds(core: &Core, home: &Path) {
    let dir = home.join("plugins/kinds");
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({ "id": KINDS, "version": "0.1.0", "kind": "policy",
        "contributes": { "settings": {
            "example.kinds.flag": { "kind": "boolean", "default": false },
            "example.kinds.count": { "kind": "integer", "default": 3, "minimum": 0, "maximum": 10 },
            "example.kinds.ratio": { "kind": "number", "default": 0.5, "minimum": 0, "maximum": 1 },
            "example.kinds.mode": { "kind": "string", "default": "a", "choices": ["a", "b"] },
            "example.kinds.list": { "kind": "array", "default": [] },
            "example.kinds.map": { "kind": "object", "default": {} },
            "example.kinds.slug": { "kind": "string", "default": "notes", "pattern": "^[a-z]+$" } } } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    assert_eq!(core.install_plugin(&dir, false).error, None);
}

/// A core whose init.yaml holds `settings`, with example.kinds installed.
fn with_init(tag: &str, settings: &str) -> Core {
    let home = home(tag);
    let init = home.join(".desk/init.yaml");
    fs::create_dir_all(init.parent().unwrap()).unwrap();
    fs::write(&init, format!("settings:\n{settings}")).unwrap();
    let core = Core::new(roots(&home)).with_init_file(init);
    install_kinds(&core, &home);
    core
}

fn value(core: &Core, key: &str) -> Value {
    call(core, KINDS, "settings.get", json!({ "key": key })).unwrap()["value"].clone()
}

fn defaults() -> Vec<(&'static str, Value)> {
    vec![
        ("flag", json!(false)),
        ("count", json!(3)),
        ("ratio", json!(0.5)),
        ("mode", json!("a")),
        ("list", json!([])),
        ("map", json!({})),
        ("slug", json!("notes")),
    ]
}

#[test]
fn every_kind_falls_back_to_the_default() {
    let core = with_init(
        "kinds-wrong",
        "  example.kinds.flag: \"yes\"\n  example.kinds.count: 2.5\n  example.kinds.ratio: half\n  \
         example.kinds.mode: c\n  example.kinds.list: one\n  example.kinds.map: [1]\n",
    );
    for (key, default) in defaults() {
        assert_eq!(
            value(&core, key),
            default,
            "{key} falls back to its default"
        );
    }
    let init = call(&core, KINDS, "init.get", json!({})).unwrap();
    assert_eq!(
        init["settings"],
        json!({}),
        "init.get hands out no value that fails its setting"
    );
}

#[test]
fn range_and_pattern_fall_back() {
    let outside = with_init(
        "kinds-outside",
        "  example.kinds.count: 11\n  example.kinds.ratio: -0.1\n  example.kinds.slug: Not A Slug\n",
    );
    assert_eq!(value(&outside, "count"), json!(3), "above the maximum");
    assert_eq!(value(&outside, "ratio"), json!(0.5), "below the minimum");
    assert_eq!(
        value(&outside, "slug"),
        json!("notes"),
        "outside the pattern"
    );

    let inside = with_init(
        "kinds-inside",
        "  example.kinds.count: 10\n  example.kinds.ratio: 0\n  example.kinds.slug: abc\n  \
         example.kinds.flag: true\n  example.kinds.mode: b\n  example.kinds.list: [x]\n  \
         example.kinds.map: { a: 1 }\n",
    );
    assert_eq!(value(&inside, "count"), json!(10));
    assert_eq!(value(&inside, "ratio"), json!(0));
    assert_eq!(value(&inside, "slug"), json!("abc"));
    assert_eq!(value(&inside, "flag"), json!(true));
    assert_eq!(value(&inside, "mode"), json!("b"));
    assert_eq!(value(&inside, "list"), json!(["x"]));
    assert_eq!(value(&inside, "map"), json!({ "a": 1 }));
    let init = call(&inside, KINDS, "init.get", json!({})).unwrap();
    assert_eq!(init["settings"]["example.kinds.count"], json!(10));
}

#[test]
fn settings_set_refuses_an_invalid_value() {
    let home = home("kinds-set");
    let core = Core::new(roots(&home));
    install_kinds(&core, &home);
    let events = core.events().subscribe();
    let set = |key: &str, value: Value| {
        call(
            &core,
            KINDS,
            "settings.set",
            json!({ "key": key, "value": value }),
        )
    };
    for (key, bad) in [
        ("flag", json!("yes")),
        ("count", json!(11)),
        ("count", json!(1.5)),
        ("ratio", json!(2)),
        ("mode", json!("c")),
        ("list", json!({})),
        ("map", json!("x")),
        ("slug", json!("NO")),
    ] {
        let refused = set(key, bad.clone()).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidValue, "{key} = {bad}");
        assert!(!refused.message.is_empty());
    }
    for (key, default) in defaults() {
        assert_eq!(value(&core, key), default, "a refused set stores nothing");
    }
    let changed = |events: &std::sync::mpsc::Receiver<BridgeEvent>| {
        events
            .try_iter()
            .filter(|event| matches!(event, BridgeEvent::SettingsChanged(_)))
            .count()
    };
    assert_eq!(
        changed(&events),
        0,
        "a refused set sends no settings.changed"
    );

    assert_eq!(set("count", json!(5)).unwrap(), json!({}));
    assert_eq!(value(&core, "count"), json!(5));
    assert_eq!(changed(&events), 1);
    assert_eq!(
        set("undeclared", json!("anything")).unwrap(),
        json!({}),
        "a key the manifest does not declare takes any value"
    );
}

#[test]
fn a_set_value_that_fails_falls_back() {
    let home = home("kinds-file");
    let file = home.join("settings.json");
    fs::write(
        &file,
        r#"{ "example.kinds": { "count": 99, "mode": "b" } }"#,
    )
    .unwrap();
    let core = Core::new(roots(&home)).with_settings_file(file);
    install_kinds(&core, &home);
    let deliveries = core.events().subscribe_addressed();

    assert_eq!(value(&core, "count"), json!(3), "99 is above the maximum");
    assert_eq!(value(&core, "mode"), json!("b"));
    call(&core, "desk", "init.get", json!({})).unwrap();
    let invalid: Vec<Value> = deliveries
        .try_iter()
        .filter_map(|delivery| match delivery.event {
            BridgeEvent::SettingsInvalid(event) => Some(serde_json::to_value(event.data).unwrap()),
            _ => None,
        })
        .collect();
    assert_eq!(invalid.len(), 1, "{invalid:?}");
    assert_eq!(invalid[0]["owner"], KINDS);
    assert_eq!(invalid[0]["key"], "count");
    assert_eq!(invalid[0]["value"], 99);
    assert!(invalid[0]["reason"].as_str().unwrap().contains("10"));
    assert_eq!(invalid[0].get("file"), None, "a set value has no file");
    assert_eq!(invalid[0].get("line"), None);
}
