//! Safe mode: when it starts, and what a safe-mode core lets plugins do.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::{Core, LaunchGuard, Prompt, Prompter, Roots, SafeReason, UNREADY_LIMIT};
use serde_json::{Value, json};

struct Yes;

impl Prompter for Yes {
    fn ask(&self, _prompt: &Prompt) -> bool {
        true
    }
}

fn temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-safe-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn a_normal_launch_that_reaches_ready_stays_normal() {
    let guard = LaunchGuard::new(temp_dir().join("launch.json"));
    for _ in 0..5 {
        assert_eq!(guard.begin(false), None);
        guard.ready();
    }
}

#[test]
fn launches_that_never_reach_ready_lead_to_safe_mode() {
    let guard = LaunchGuard::new(temp_dir().join("launch.json"));
    for _ in 0..UNREADY_LIMIT {
        assert_eq!(guard.begin(false), None);
    }
    assert_eq!(
        guard.begin(false),
        Some(SafeReason::FailedLaunches(UNREADY_LIMIT))
    );
    guard.ready();
    assert_eq!(guard.begin(false), None, "one good launch clears the count");
}

#[test]
fn asking_and_restarting_in_safe_mode() {
    let guard = LaunchGuard::new(temp_dir().join("launch.json"));
    assert_eq!(guard.begin(true), Some(SafeReason::Asked));
    guard.ready();
    guard.safe_next();
    assert_eq!(guard.begin(false), Some(SafeReason::Restarted));
    guard.ready();
    assert_eq!(
        guard.begin(false),
        None,
        "a restart in safe mode is used once"
    );
}

fn plugin(home: &Path, folder: &str, id: &str) -> PathBuf {
    let dir = home.join(folder);
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hi</p>").unwrap();
    fs::write(
        dir.join("plugin.json"),
        json!({
            "id": id, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
            "permissions": [{ "permission": "ui:notify" }]
        })
        .to_string(),
    )
    .unwrap();
    dir
}

fn ask_notify(core: &Core, caller: &str) -> Value {
    let request: BridgeRequest = serde_json::from_value(json!({
        "id": 1, "method": "perm.request",
        "params": { "permission": { "permission": "ui:notify" }, "reason": "hello" }
    }))
    .unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(err) => panic!("{:?}", err.error),
    }
}

#[test]
fn in_safe_mode_only_built_in_plugins_get_permissions() {
    let home = temp_dir();
    let core = Core::new(Roots { home: home.clone() })
        .with_prompter(Yes)
        .with_safe_mode(true);
    assert!(core.safe_mode());
    let built_in = core.install_plugin(&plugin(&home, "a", "endue.notes"), true);
    let community = core.install_plugin(&plugin(&home, "b", "example.notes"), false);

    assert_eq!(
        core.grants_of(&built_in.id).len(),
        1,
        "built-ins are granted their manifest as usual"
    );
    assert_eq!(ask_notify(&core, &community.id)["granted"], false);
    assert!(core.grants_of(&community.id).is_empty());
    let listed: Vec<String> = core.plugins().into_iter().map(|p| p.id).collect();
    assert!(
        listed.contains(&community.id),
        "other plugins stay listed so they can be turned off"
    );
}

#[test]
fn outside_safe_mode_the_same_plugin_may_ask() {
    let home = temp_dir();
    let core = Core::new(Roots { home: home.clone() }).with_prompter(Yes);
    let community = core.install_plugin(&plugin(&home, "b", "example.notes"), false);
    assert_eq!(ask_notify(&core, &community.id)["granted"], true);
}
