//! Autoload plugins (ADR 0046): installed but off until the desk needs one. With no stored enabled
//! flag an autoload plugin starts off; a stored flag and init.yaml's `plugins.disabled` decide as for
//! every other plugin, and a plugin without the field still starts on.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::PluginStatus;
use desk_core::{Core, PluginRegistry, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "desk-autoload-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A UI plugin that opens `*.csv`, with `autoload` as given (absent when None).
fn sheets(parent: &Path, autoload: Option<bool>) -> PathBuf {
    let dir = parent.join("sheets");
    fs::create_dir_all(dir.join("ui")).unwrap();
    let mut manifest: Value = json!({ "id": "example.sheets", "version": "0.1.0", "kind": "ui",
        "entry": "ui/index.html",
        "surfaces": [{ "id": "main", "title": "Sheets", "placement": "center" }],
        "contributes": { "files": [{ "pattern": "*.csv", "plugin": "example.sheets" }] } });
    if let Some(autoload) = autoload {
        manifest["autoload"] = json!(autoload);
    }
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>sheets</p>").unwrap();
    dir
}

#[test]
fn an_autoload_plugin_starts_off() {
    let dir = temp_dir("off");
    let store = dir.join("plugins.json");
    let mut registry = PluginRegistry::new(Some(store.clone()));
    let info = registry.install(&sheets(&dir, Some(true)), true);
    assert_eq!(info.status, PluginStatus::Ready);
    assert_eq!(info.manifest.and_then(|m| m.autoload), Some(true));
    assert!(
        !info.enabled,
        "an autoload plugin is off until the desk needs it"
    );
    assert!(
        !store.exists(),
        "starting off writes no flag: the plugin is off by its manifest"
    );
}

#[test]
fn a_stored_flag_still_wins() {
    let dir = temp_dir("stored");
    let store = dir.join("plugins.json");
    fs::write(&store, r#"{ "enabled": { "example.sheets": true } }"#).unwrap();
    let mut registry = PluginRegistry::new(Some(store.clone()));
    assert!(
        registry.install(&sheets(&dir, Some(true)), true).enabled,
        "enabled true in plugins.json keeps it on"
    );

    // Turned off again, the next start reads the stored false.
    assert!(
        !registry
            .set_enabled("example.sheets", false)
            .unwrap()
            .enabled
    );
    let mut next = PluginRegistry::new(Some(store));
    assert!(!next.install(&sheets(&dir, Some(true)), true).enabled);
}

#[test]
fn init_disabled_still_holds_a_plugin_off() {
    let dir = temp_dir("init");
    let init = dir.join("init.yaml");
    fs::write(&init, "plugins:\n  disabled: [example.sheets]\n").unwrap();
    let store = dir.join("plugins.json");
    fs::write(&store, r#"{ "enabled": { "example.sheets": true } }"#).unwrap();
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_init_file(init)
    .with_plugin_store(store);
    assert!(
        !core.install_plugin(&sheets(&dir, Some(true)), true).enabled,
        "init.yaml holds it off over the stored flag, as for any plugin"
    );
}

#[test]
fn a_plain_plugin_still_starts_on() {
    let dir = temp_dir("plain");
    let mut registry = PluginRegistry::new(None);
    assert!(
        registry.install(&sheets(&dir, None), true).enabled,
        "no autoload field: on at start"
    );
    let other = temp_dir("plain-false");
    let mut registry = PluginRegistry::new(None);
    assert!(
        registry.install(&sheets(&other, Some(false)), true).enabled,
        "autoload false: on at start"
    );
}
