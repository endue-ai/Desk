//! Where a value that fails its setting is written (ADR 0080): init.yaml, a saved profile file and
//! a contributed profile name their file and line in one warning each and in settings.invalid, which
//! reaches the owner and desk; init.get from desk sends every problem in force again.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;

use desk_bridge::BridgeEvent;
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const READER: &str = "example.reader";

/// The built-in plugin folder `name` of this repository.
fn built_in(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../plugins")
        .join(name)
}

/// A core on `home` whose init.yaml is `text`, with desk.theme and desk.notify installed.
fn desk(home: &Path, text: &str) -> Core {
    let init = home.join(".desk/init.yaml");
    fs::create_dir_all(init.parent().unwrap()).unwrap();
    fs::write(&init, text).unwrap();
    let core = Core::new(roots(home)).with_init_file(init);
    for name in ["theme", "notify"] {
        assert_eq!(core.install_plugin(&built_in(name), true).error, None);
    }
    core
}

/// The settings.invalid deliveries seen so far: (recipients, data).
fn invalid(deliveries: &Receiver<Delivery>) -> Vec<(Vec<String>, Value)> {
    deliveries
        .try_iter()
        .filter_map(|delivery| match delivery.event {
            BridgeEvent::SettingsInvalid(event) => Some((
                delivery.to.unwrap_or_default(),
                serde_json::to_value(event.data).unwrap(),
            )),
            _ => None,
        })
        .collect()
}

/// The core channel's warnings, as (message, fields).
fn warnings(core: &Core) -> Vec<(String, Value)> {
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
        .filter(|entry| entry["level"] == "warn")
        .map(|entry| {
            let message = entry["message"].as_str().unwrap().to_owned();
            (message, entry.get("fields").cloned().unwrap_or(Value::Null))
        })
        .collect()
}

/// The 1-based line of the first line of `text` that holds `needle`.
fn line_of(text: &str, needle: &str) -> u64 {
    let index = text.lines().position(|line| line.contains(needle));
    index.expect("the text holds the needle") as u64 + 1
}

const BAD: &str =
    "version: 0\nsettings:\n  desk.theme.scheme: purple\n  desk.notify.dnd: \"yes\"\n";

#[test]
fn init_yaml_values_name_owner_key_file_and_line() {
    let home = home("files-init");
    let core = desk(&home, BAD);
    grant(&core, READER, json!({ "permission": "log:read" }));
    call(&core, "desk", "init.get", json!({})).unwrap();

    let warned = warnings(&core);
    for (owner, key, line) in [("desk.theme", "scheme", 3), ("desk.notify", "dnd", 4)] {
        let about: Vec<&(String, Value)> = warned
            .iter()
            .filter(|(_, fields)| fields["owner"] == owner && fields["key"] == key)
            .collect();
        assert_eq!(about.len(), 1, "one warning for {owner}.{key}: {warned:?}");
        let (message, fields) = about[0];
        assert_eq!(fields["file"], "~/.desk/init.yaml");
        assert_eq!(fields["line"], line);
        assert!(message.contains(&format!("{owner}.{key}")), "{message}");
        assert!(message.contains(&format!("init.yaml:{line}")), "{message}");
    }

    call(&core, "desk", "init.get", json!({})).unwrap();
    call(&core, "desk.theme", "settings.list", json!({})).unwrap();
    assert_eq!(
        warnings(&core).len(),
        warned.len(),
        "a problem is logged once"
    );
    let scheme = call(
        &core,
        "desk.theme",
        "settings.get",
        json!({ "key": "scheme" }),
    );
    assert_eq!(scheme.unwrap()["value"], "dark");
    let dnd = call(
        &core,
        "desk.notify",
        "settings.get",
        json!({ "key": "dnd" }),
    );
    assert_eq!(dnd.unwrap()["value"], false);
}

#[test]
fn settings_invalid_reaches_the_owner_and_the_desk() {
    let home = home("files-event");
    let core = desk(&home, BAD);
    let deliveries = core.events().subscribe_addressed();

    call(&core, "desk", "init.get", json!({})).unwrap();
    let first = invalid(&deliveries);
    assert_eq!(first.len(), 2, "{first:?}");
    let scheme = first
        .iter()
        .find(|(_, data)| data["key"] == "scheme")
        .expect("desk.theme.scheme is reported");
    assert_eq!(scheme.0, ["desk", "desk.theme"]);
    assert_eq!(
        scheme.1,
        json!({ "owner": "desk.theme", "key": "scheme", "value": "purple",
            "reason": scheme.1["reason"], "file": "~/.desk/init.yaml", "line": 3 })
    );
    assert!(
        scheme.1["reason"]
            .as_str()
            .unwrap()
            .contains("system, light, dark")
    );
    let dnd = first.iter().find(|(_, data)| data["key"] == "dnd").unwrap();
    assert_eq!(dnd.0, ["desk", "desk.notify"]);
    assert_eq!(dnd.1["line"], 4);

    call(&core, "endue.terminal", "init.get", json!({})).unwrap();
    assert_eq!(
        invalid(&deliveries),
        vec![],
        "another caller's init.get sends nothing again"
    );
    call(&core, "desk", "init.get", json!({})).unwrap();
    let again = invalid(&deliveries);
    assert_eq!(again.len(), 2, "desk hears every problem in force again");
    assert!(again.iter().all(|(to, _)| to == &["desk"]));
}

#[test]
fn profile_values_name_their_file_and_line() {
    let home = home("files-profiles");
    let core = desk(&home, "version: 0\n");
    let saved = "name: Focus\ndescription: Quiet\nsettings:\n  desk.notify.dnd: \"yes\"\n";
    fs::create_dir_all(home.join(".desk/profiles")).unwrap();
    fs::write(home.join(".desk/profiles/focus.yaml"), saved).unwrap();
    let dir = home.join("plugins/loud");
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({ "id": "example.loud", "version": "0.1.0", "kind": "policy",
        "contributes": { "profiles": [{ "id": "loud", "name": "Loud",
            "settings": { "desk.notify.dnd": "yes", "desk.theme.contrast": "high" } }] } });
    let manifest = serde_json::to_string_pretty(&manifest).unwrap();
    fs::write(dir.join("plugin.json"), &manifest).unwrap();
    assert_eq!(core.install_plugin(&dir, false).error, None);
    let deliveries = core.events().subscribe_addressed();

    call(&core, "desk", "init.get", json!({})).unwrap();
    let mut seen: Vec<Value> = invalid(&deliveries)
        .into_iter()
        .map(|(_, data)| data)
        .collect();
    seen.sort_by_key(|data| data["file"].as_str().unwrap_or_default().to_owned());
    assert_eq!(seen.len(), 2, "{seen:?}");
    assert_eq!(seen[0]["file"], "~/.desk/profiles/focus.yaml");
    assert_eq!(seen[0]["line"], 4);
    assert_eq!(seen[1]["file"], "~/plugins/loud/plugin.json");
    assert_eq!(seen[1]["line"], line_of(&manifest, "desk.notify.dnd"));
    for data in &seen {
        assert_eq!(
            (&data["owner"], &data["key"]),
            (&json!("desk.notify"), &json!("dnd"))
        );
        assert_eq!(data["value"], "yes");
    }
}

#[test]
fn the_bad_values_vector_still_loads() {
    let vector = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../specs/init/v0/vectors/valid/bad-values.json");
    let vector: Value = serde_json::from_str(&fs::read_to_string(vector).unwrap()).unwrap();
    let text = yaml_serde::to_string(&vector["instance"]).unwrap();
    let home = home("files-vector");
    let core = desk(&home, &text);
    assert_eq!(core.init_problem(), None, "the file is in force");
    let deliveries = core.events().subscribe_addressed();
    call(&core, "desk", "init.get", json!({})).unwrap();

    let get = |owner: &str, key: &str| {
        call(&core, owner, "settings.get", json!({ "key": key })).unwrap()["value"].clone()
    };
    assert_eq!(get("desk.theme", "scheme"), "dark");
    assert_eq!(get("desk.theme", "contrast"), "high", "a valid value stays");
    assert_eq!(get("desk.notify", "dnd"), false);
    assert_eq!(get("desk.notify", "info-ms"), 4000);
    assert_eq!(get("desk.notify", "dnd-allows"), json!(["error"]));

    let reported = invalid(&deliveries);
    let names: Vec<String> = reported
        .iter()
        .map(|(_, data)| {
            format!(
                "{}.{}",
                data["owner"].as_str().unwrap(),
                data["key"].as_str().unwrap()
            )
        })
        .collect();
    for name in [
        "desk.theme.scheme",
        "desk.notify.dnd",
        "desk.notify.info-ms",
        "desk.notify.dnd-allows",
    ] {
        let (_, data) = &reported[names.iter().position(|n| n == name).expect(name)];
        assert_eq!(data["line"], line_of(&text, &format!("{name}:")), "{name}");
    }
    assert_eq!(reported.len(), 4, "{names:?}");
}
