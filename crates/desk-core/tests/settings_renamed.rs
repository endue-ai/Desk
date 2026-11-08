//! Renamed settings and unknown keys (ADR 0080): a layer's value under an earlier name is read when
//! the setting's own name is absent and reported as migratedFrom; a key a known owner does not
//! declare is a warning naming the nearest declared key; a key under an unknown owner is kept.

mod support;

use std::fs;
use std::path::Path;

use desk_bridge::BridgeEvent;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const THEME: &str = "desk.theme";
const READER: &str = "example.reader";

/// A core whose init.yaml holds `settings`, with a desk.theme whose `scheme` was called
/// `desk.theme.mode` and, before that, `desk.scheme`.
fn renamed(tag: &str, settings: &str) -> Core {
    let home = home(tag);
    let init = home.join(".desk/init.yaml");
    fs::create_dir_all(init.parent().unwrap()).unwrap();
    fs::write(&init, format!("settings:\n{settings}")).unwrap();
    let core = Core::new(roots(&home)).with_init_file(init);
    install_theme(&core, &home);
    grant(&core, READER, json!({ "permission": "log:read" }));
    core
}

fn install_theme(core: &Core, home: &Path) {
    let dir = home.join("plugins/theme");
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({ "id": THEME, "version": "0.1.0", "kind": "policy",
        "contributes": { "settings": {
            "desk.theme.scheme": { "kind": "string", "default": "dark",
                "choices": ["system", "light", "dark"],
                "renamed": ["desk.theme.mode", "desk.scheme"] },
            "desk.theme.contrast": { "kind": "string", "default": "system" } } } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    assert_eq!(core.install_plugin(&dir, false).error, None);
}

fn get(core: &Core, key: &str) -> Value {
    call(core, THEME, "settings.get", json!({ "key": key })).unwrap()
}

/// The core channel's entries, as (level, message, fields).
fn entries(core: &Core) -> Vec<(String, String, Value)> {
    let scope = json!({ "permission": "log:read" });
    let tail = call(
        core,
        READER,
        "log.tail",
        json!({ "channel": "core", "count": 1000, "scope": scope }),
    )
    .unwrap();
    tail["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry["level"].as_str().unwrap().to_owned(),
                entry["message"].as_str().unwrap().to_owned(),
                entry.get("fields").cloned().unwrap_or(Value::Null),
            )
        })
        .collect()
}

#[test]
fn renamed_reads_the_old_key_and_reports_migrated_from() {
    let core = renamed("renamed-old", "  desk.theme.mode: light\n");
    assert_eq!(
        get(&core, "scheme"),
        json!({ "value": "light", "migratedFrom": "desk.theme.mode" })
    );
    let listed = call(&core, THEME, "settings.list", json!({})).unwrap();
    assert_eq!(
        listed["settings"],
        json!([
            { "owner": THEME, "key": "contrast", "value": "system" },
            { "owner": THEME, "key": "scheme", "value": "light", "migratedFrom": "desk.theme.mode" }
        ]),
        "the old name is not listed on its own"
    );
    let init = call(&core, THEME, "init.get", json!({})).unwrap();
    assert_eq!(init["settings"], json!({ "desk.theme.scheme": "light" }));

    let older = renamed("renamed-older", "  desk.scheme: system\n");
    assert_eq!(
        get(&older, "scheme"),
        json!({ "value": "system", "migratedFrom": "desk.scheme" })
    );

    let both = renamed(
        "renamed-both",
        "  desk.theme.scheme: system\n  desk.theme.mode: light\n",
    );
    assert_eq!(
        get(&both, "scheme"),
        json!({ "value": "system" }),
        "the new name wins"
    );

    let failing = renamed("renamed-failing", "  desk.theme.mode: purple\n");
    let deliveries = failing.events().subscribe_addressed();
    assert_eq!(get(&failing, "scheme"), json!({ "value": "dark" }));
    call(&failing, "desk", "init.get", json!({})).unwrap();
    let invalid: Vec<Value> = deliveries
        .try_iter()
        .filter_map(|delivery| match delivery.event {
            BridgeEvent::SettingsInvalid(event) => Some(serde_json::to_value(event.data).unwrap()),
            _ => None,
        })
        .collect();
    assert_eq!(invalid.len(), 1, "{invalid:?}");
    assert_eq!(
        (
            &invalid[0]["owner"],
            &invalid[0]["key"],
            &invalid[0]["line"]
        ),
        (&json!(THEME), &json!("scheme"), &json!(2))
    );
}

#[test]
fn an_unknown_key_under_a_known_owner_names_the_nearest() {
    let core = renamed("renamed-unknown", "  desk.theme.schme: light\n");
    let deliveries = core.events().subscribe_addressed();
    call(&core, "desk", "init.get", json!({})).unwrap();
    let warned: Vec<(String, String, Value)> = entries(&core)
        .into_iter()
        .filter(|(level, _, _)| level == "warn")
        .collect();
    assert_eq!(warned.len(), 1, "{warned:?}");
    let (_, message, fields) = &warned[0];
    assert!(message.contains("desk.theme.schme"), "{message}");
    assert!(message.contains("desk.theme.scheme"), "{message}");
    assert_eq!(fields["nearest"], "desk.theme.scheme");
    assert_eq!(fields["line"], 2);
    assert!(
        !deliveries
            .try_iter()
            .any(|delivery| matches!(delivery.event, BridgeEvent::SettingsInvalid(_))),
        "nothing fell back, so no settings.invalid"
    );
    assert_eq!(get(&core, "scheme"), json!({ "value": "dark" }));
}

#[test]
fn a_key_under_an_unknown_owner_is_kept_silently() {
    let core = renamed(
        "renamed-silent",
        "  someone.later.key: 1\n  desk.something: true\n",
    );
    call(&core, "desk", "init.get", json!({})).unwrap();
    let noisy: Vec<(String, String, Value)> = entries(&core)
        .into_iter()
        .filter(|(level, message, _)| {
            level == "warn"
                && (message.contains("someone.later") || message.contains("desk.something"))
        })
        .collect();
    assert_eq!(noisy, vec![], "a plugin may be installed later");
    let init = call(&core, "someone.later", "init.get", json!({})).unwrap();
    assert_eq!(init["settings"], json!({ "someone.later.key": 1 }));
    let desk = call(&core, "desk", "init.get", json!({})).unwrap();
    assert_eq!(desk["settings"]["desk.something"], true);
}
