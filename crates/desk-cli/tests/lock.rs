//! `desk plugin list --lock` (the lock file as it is, no desk needed) and `desk plugin sync` (plugins
//! turned on and off as `~/.desk/plugins.lock` says, through the desk socket), ADR 0079.
#![cfg(unix)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;

use desk_bridge::BridgeRequest;
use desk_core::{Core, Roots};
use desk_ipc::{CALLER, Listener};
use serde_json::{Value, json};

fn temp(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dcli-lock-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join(".desk")).unwrap();
    dir
}

fn desk(home: &Path, socket: Option<&Path>, args: &[&str]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_desk"));
    command.args(args).env("HOME", home);
    match socket {
        Some(socket) => command.env("DESK_SOCKET", socket),
        None => command.env("DESK_SOCKET", home.join("no-desk.sock")),
    };
    command.output().expect("desk runs")
}

const LOCK: &str = "# plugins.lock\nversion: 0\nplugins:\n  - { id: example.a, version: 0.1.0, source: builtin, sha256: 0000000000000000000000000000000000000000000000000000000000000000, enabled: false }\n  - { id: example.b, version: 0.1.0, source: \"folder:~/plugins/b\", sha256: 0000000000000000000000000000000000000000000000000000000000000000, enabled: true }\n  - { id: example.c, version: 0.2.0, source: builtin, sha256: 0000000000000000000000000000000000000000000000000000000000000000, enabled: true }\n  - { id: example.gone, version: 1.0.0, source: builtin, sha256: 0000000000000000000000000000000000000000000000000000000000000000, enabled: true }\n";

#[test]
fn plugin_list_lock_prints_the_file() {
    let home = temp("list");
    let out = desk(&home, None, &["plugin", "list", "--lock"]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("no plugins.lock"), "{stderr}");

    fs::write(home.join(".desk/plugins.lock"), LOCK).unwrap();
    let out = desk(&home, None, &["plugin", "list", "--lock"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        LOCK,
        "the file as it is"
    );

    let out = desk(&home, None, &["--json", "plugin", "list", "--lock"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let parsed: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(parsed["version"], 0);
    assert_eq!(parsed["plugins"][1]["source"], "folder:~/plugins/b");
    assert_eq!(parsed["plugins"].as_array().unwrap().len(), 4);
}

fn plugin(parent: &Path, id: &str, version: &str) -> PathBuf {
    let dir = parent.join(id);
    fs::create_dir_all(dir.join("ui")).unwrap();
    let manifest = json!({ "id": id, "version": version, "kind": "ui", "entry": "ui/index.html" });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>x</p>").unwrap();
    dir
}

fn enabled(core: &Core, id: &str) -> bool {
    core.plugins()
        .into_iter()
        .find(|p| p.id == id)
        .unwrap()
        .enabled
}

#[test]
fn plugin_sync_sends_set_enabled_and_reports_what_is_missing() {
    let home = temp("sync");
    let core = Arc::new(Core::new(Roots { home: home.clone() }));
    for permission in desk_ipc::grants() {
        core.grant(CALLER, permission);
    }
    for (id, version) in [
        ("example.a", "0.1.0"),
        ("example.b", "0.1.0"),
        ("example.c", "0.3.0"),
    ] {
        core.install_plugin(&plugin(&home.join("plugins"), id, version), false);
    }
    let off: BridgeRequest = serde_json::from_value(json!({ "id": 1, "method": "plugin.setEnabled",
        "params": { "plugin": "example.b", "enabled": false, "scope": { "permission": "plugin:manage" } } }))
    .unwrap();
    core.grant(
        "desk",
        serde_json::from_value(json!({ "permission": "plugin:manage" })).unwrap(),
    );
    core.handle("desk", off);
    fs::write(home.join(".desk/plugins.lock"), LOCK).unwrap();
    let socket = home.join("desk.sock");
    let _listener = Listener::bind(&socket, Arc::clone(&core)).expect("bind the desk socket");

    let out = desk(&home, Some(&socket), &["plugin", "sync"]);
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    assert_eq!(out.status.code(), Some(1), "a plugin is missing:\n{stdout}");
    assert_eq!(
        stdout,
        "disabled\texample.a\nenabled\texample.b\nversion\texample.c\t0.2.0\t0.3.0\nmissing\texample.gone\n"
    );
    assert!(!enabled(&core, "example.a"));
    assert!(enabled(&core, "example.b"));
    assert!(enabled(&core, "example.c"), "left alone");

    let trimmed: String = LOCK
        .lines()
        .filter(|l| !l.contains("example.gone"))
        .map(|l| format!("{l}\n"))
        .collect();
    fs::write(home.join(".desk/plugins.lock"), trimmed).unwrap();
    let out = desk(&home, Some(&socket), &["plugin", "sync"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "version\texample.c\t0.2.0\t0.3.0\n",
        "nothing left to change"
    );
}
