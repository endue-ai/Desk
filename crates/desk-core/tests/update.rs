//! update.* served from a `desk_update::Updater` (ADR 0054): the status mapped onto the bridge's
//! shape, the channel from the person's settings, `update.changed` for the holders of
//! `update:manage` and the subscribers, and refusals when nothing waits.

mod support;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use desk_update::stage::Stage;
use desk_update::verify::sha256_hex;
use desk_update::{Chosen, Config, Installer, Prefs, Transport, Updater};
use serde_json::{Value, json};
use support::*;

/// An origin that is never reachable, recording what was asked.
#[derive(Default)]
struct Offline(Mutex<Vec<String>>);

impl Transport for Offline {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        self.0.lock().unwrap().push(url.to_owned());
        Err("offline".to_owned())
    }

    fn download(&self, url: &str, _: &mut dyn FnMut(u64, Option<u64>)) -> Result<Vec<u8>, String> {
        self.get(url)
    }
}

struct Never;

impl Installer for Never {
    fn install(&self, _: &Chosen, _: &[u8]) -> Result<(), String> {
        Err("no installs in tests".to_owned())
    }
}

fn manage() -> Value {
    json!({ "permission": "update:manage" })
}

/// A build of 0.2.0 kept in `dir` as an earlier run would have left it.
fn stage_build(dir: &Path) {
    let bytes = b"endue Desk 0.2.0".repeat(64);
    let chosen = Chosen {
        version: "0.2.0".to_owned(),
        commit: Some("c46d12b".to_owned()),
        date: Some("2026-11-20T09:12:00Z".to_owned()),
        notes: Some("https://github.com/endue-ai/Desk/releases/tag/v0.2.0".to_owned()),
        target: "linux-x86_64".to_owned(),
        url: "https://releases.example.test/desk/releases/0.2.0/desk.AppImage".to_owned(),
        file: "desk.AppImage".to_owned(),
        size: bytes.len() as u64,
        sha256: sha256_hex(&bytes),
        signature: "unchecked here".to_owned(),
        release: "https://releases.example.test/desk/releases/0.2.0/release.json".to_owned(),
    };
    Stage::open(dir).unwrap().put(&chosen, &bytes).unwrap();
}

/// A core whose updater runs `version` with its updates folder under `home`, and the origin's log.
fn desk(home: &Path, version: &str, init: Option<&str>) -> (Core, Arc<Offline>) {
    let origin = Arc::new(Offline::default());
    let config = Config {
        base: "https://releases.example.test/desk".to_owned(),
        pubkey: String::new(),
        version: version.to_owned(),
        commit: Some("fa7a4af".to_owned()),
        targets: vec!["linux-x86_64".to_owned()],
        dir: home.join("updates"),
    };
    let updater = Updater::new(config, origin.clone(), Arc::new(Never), Prefs::default()).unwrap();
    let mut core = Core::new(roots(home));
    if let Some(text) = init {
        let file = home.join(".desk/init.yaml");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, text).unwrap();
        core = core.with_init_file(file);
    }
    let core = core.with_updater(updater);
    grant(&core, "desk", manage());
    (core, origin)
}

fn update(core: &Core, method: &str) -> Result<Value, BridgeError> {
    call(core, "desk", method, json!({ "scope": manage() }))
}

#[test]
fn status_maps_a_staged_build() {
    let home = home("update-staged");
    stage_build(&home.join("updates"));
    let (core, _) = desk(&home, "0.1.0", None);
    assert_eq!(
        update(&core, "update.status").unwrap(),
        json!({
            "state": "staged",
            "current": { "version": "0.1.0", "commit": "fa7a4af" },
            "channel": "stable",
            "release": {
                "version": "0.2.0",
                "commit": "c46d12b",
                "date": "2026-11-20T09:12:00Z",
                "notes": "https://github.com/endue-ai/Desk/releases/tag/v0.2.0"
            },
            "staged": true
        })
    );
}

#[test]
fn check_reads_the_channel_from_init_yaml() {
    let home = home("update-beta");
    let (core, origin) = desk(
        &home,
        "0.1.0",
        Some("settings:\n  desk.update.channel: beta\n"),
    );
    let answer = update(&core, "update.check").unwrap();
    assert_eq!(answer["state"], "checking");
    assert_eq!(answer["channel"], "beta");
    let started = Instant::now();
    while origin.0.lock().unwrap().is_empty() {
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the check never reached the origin"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    let asked = origin.0.lock().unwrap().clone();
    assert_eq!(
        asked[0],
        "https://releases.example.test/desk/channels/beta/index.json"
    );
}

#[test]
fn a_pre_release_follows_canary_by_default() {
    let (canary, _) = desk(&home("update-canary"), "0.2.1-pre.4", None);
    assert_eq!(
        update(&canary, "update.status").unwrap()["channel"],
        "canary"
    );
    let (stable, _) = desk(&home("update-stable"), "0.2.0", None);
    assert_eq!(
        update(&stable, "update.status").unwrap()["channel"],
        "stable"
    );
}

#[test]
fn update_changed_reaches_manage_holders_and_subscribers_only() {
    let home = home("update-changed");
    let (core, _) = desk(&home, "0.1.0", None);
    let watcher = "example.watcher";
    grant(
        &core,
        watcher,
        json!({ "permission": "events:subscribe", "names": ["update.changed"] }),
    );
    let scope = json!({ "permission": "events:subscribe", "names": ["update.changed"] });
    call(
        &core,
        watcher,
        "events.subscribe",
        json!({ "names": ["update.changed"], "scope": scope }),
    )
    .unwrap();
    let core = Arc::new(core);
    let deliveries = core.events().subscribe_addressed();
    core.start_updates();
    update(&core, "update.check").unwrap();
    let checking = wait_for(&deliveries, "update.changed");
    assert_eq!(checking.data()["state"], "checking");
    let failed = wait_for(&deliveries, "update.changed");
    assert_eq!(failed.data()["state"], "failed");
    assert!(
        failed.data()["reason"]
            .as_str()
            .unwrap()
            .contains("offline")
    );
    for seen in [&checking, &failed] {
        assert!(seen.is_for("desk") && seen.is_for(watcher), "{seen:?}");
        assert!(!seen.is_for("example.other"), "{seen:?}");
    }
}

#[test]
fn download_and_apply_refuse_when_nothing_waits() {
    let home = home("update-refuse");
    let (core, _) = desk(&home, "0.1.0", None);
    for method in ["update.download", "update.apply"] {
        let refused = update(&core, method).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidParams, "{method}");
    }
    let stranger = call(
        &core,
        "example.other",
        "update.status",
        json!({ "scope": manage() }),
    );
    assert_eq!(stranger.unwrap_err().code, ErrorCode::PermissionDenied);
}
