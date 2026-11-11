//! A value that fails its setting is told in the desk (ADR 0080, ADR 0187): the first init.get from
//! desk, the runtime's at its start, brings one notice (ui.notified, caller `core`, level warning)
//! that names every value that fell back with its file and line. The person is told once: a later
//! init.get tells only a value that is wrong in a new way, and a clean file tells nothing.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;

use desk_bridge::BridgeEvent;
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

fn built_in(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../plugins")
        .join(name)
}

fn desk(home: &Path, text: &str) -> (Core, PathBuf) {
    let init = home.join(".desk/init.yaml");
    fs::create_dir_all(init.parent().unwrap()).unwrap();
    fs::write(&init, text).unwrap();
    let core = Core::new(roots(home)).with_init_file(init.clone());
    for name in ["theme", "notify"] {
        assert_eq!(core.install_plugin(&built_in(name), true).error, None);
    }
    (core, init)
}

/// The ui.notified events seen so far, as their data.
fn notices(deliveries: &Receiver<Delivery>) -> Vec<Value> {
    deliveries
        .try_iter()
        .filter_map(|delivery| match delivery.event {
            BridgeEvent::UiNotified(event) => Some(serde_json::to_value(event.data).unwrap()),
            _ => None,
        })
        .collect()
}

const BAD: &str =
    "version: 0\nsettings:\n  desk.theme.scheme: purple\n  desk.notify.dnd: \"yes\"\n";

#[test]
fn the_runtimes_first_init_get_brings_one_notice_naming_each_line() {
    let home = home("notice-init");
    let (core, _) = desk(&home, BAD);
    // The app logs the problems at start, before the runtime listens: that tells nobody.
    assert_eq!(core.settings_problems().len(), 2);
    let deliveries = core.events().subscribe_addressed();

    call(&core, "desk", "init.get", json!({})).unwrap();
    let told = notices(&deliveries);
    assert_eq!(told.len(), 1, "{told:?}");
    let notice = &told[0];
    assert_eq!(notice["caller"], "core");
    assert_eq!(notice["level"], "warning");
    assert_eq!(notice["title"], "2 setting values are not used");
    let body = notice["body"].as_str().unwrap();
    for (line, name) in [(3, "desk.theme.scheme"), (4, "desk.notify.dnd")] {
        let named = format!("~/.desk/init.yaml:{line}: {name}: ");
        assert!(body.contains(&named), "{named} in {body}");
    }
    assert!(body.contains("the default \"dark\" is used"), "{body}");

    call(&core, "desk", "init.get", json!({})).unwrap();
    assert!(notices(&deliveries).is_empty(), "the person is told once");
}

#[test]
fn a_plugins_own_init_get_tells_nobody() {
    let home = home("notice-plugin");
    let (core, _) = desk(&home, BAD);
    let deliveries = core.events().subscribe_addressed();
    call(&core, "desk.theme", "init.get", json!({})).unwrap();
    assert!(notices(&deliveries).is_empty());
}

#[test]
fn a_value_wrong_in_a_new_way_is_told_and_a_clean_file_tells_nothing() {
    let home = home("notice-new");
    let (core, _) = desk(
        &home,
        "version: 0\nsettings:\n  desk.theme.scheme: purple\n",
    );
    let deliveries = core.events().subscribe_addressed();
    call(&core, "desk", "init.get", json!({})).unwrap();
    let first = notices(&deliveries);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0]["title"], "A setting value is not used");

    // A saved profile is read again on every report: its wrong value is new, init.yaml's is not.
    let profiles = home.join(".desk/profiles");
    fs::create_dir_all(&profiles).unwrap();
    let profile = "id: focus\nname: Focus\nsettings:\n  desk.notify.dnd: \"yes\"\n";
    fs::write(profiles.join("focus.yaml"), profile).unwrap();
    call(&core, "desk", "init.get", json!({})).unwrap();
    let second = notices(&deliveries);
    assert_eq!(second.len(), 1, "{second:?}");
    let body = second[0]["body"].as_str().unwrap();
    assert!(body.contains("focus.yaml:4: desk.notify.dnd"), "{body}");
    assert!(!body.contains("purple"), "{body}");

    let clean = home.join("clean");
    let (core, _) = desk(
        &clean,
        "version: 0\nsettings:\n  desk.theme.scheme: light\n",
    );
    let deliveries = core.events().subscribe_addressed();
    call(&core, "desk", "init.get", json!({})).unwrap();
    assert!(notices(&deliveries).is_empty());
}
