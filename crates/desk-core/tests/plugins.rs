//! Plugin registry: install with validation, crash isolation, persisted state, file serving, hot reload.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeEvent, PluginChange, PluginStatus};
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
        "desk-plugins-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn plugin(parent: &Path, folder: &str, manifest: Value, files: &[(&str, &str)]) -> PathBuf {
    let dir = parent.join(folder);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("plugin.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
    for (path, contents) in files {
        let file = dir.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, contents).unwrap();
    }
    dir
}

fn hello(parent: &Path) -> PathBuf {
    plugin(
        parent,
        "hello",
        json!({ "id": "example.hello", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
                "surfaces": [{ "id": "main", "title": "Hello", "placement": "center" }] }),
        &[("ui/index.html", "<p>hello</p>")],
    )
}

#[test]
fn a_valid_plugin_is_installed_and_listed() {
    let mut registry = PluginRegistry::new(None);
    let info = registry.install(&hello(&temp_dir("valid")), false);
    assert_eq!(info.status, PluginStatus::Ready);
    assert_eq!(info.id, "example.hello");
    assert!(info.enabled, "new plugins start enabled");
    assert_eq!(info.manifest.unwrap().entry, "ui/index.html");
    assert_eq!(registry.list().len(), 1);
}

#[test]
fn an_invalid_manifest_is_listed_as_failed_with_the_reason() {
    let parent = temp_dir("invalid");
    let dir = plugin(
        &parent,
        "broken",
        json!({ "id": "example.broken", "version": "0.1.0", "kind": "ui" }),
        &[],
    );
    let mut registry = PluginRegistry::new(None);
    let info = registry.install(&dir, false);
    assert_eq!(info.status, PluginStatus::Failed);
    assert!(info.error.unwrap().contains("entry"));
    assert!(info.manifest.is_none());
}

#[test]
fn one_broken_plugin_does_not_stop_the_others() {
    let parent = temp_dir("isolation");
    hello(&parent);
    plugin(
        &parent,
        "no-entry",
        json!({ "id": "example.no-entry", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" }),
        &[],
    );
    fs::create_dir_all(parent.join("not-json")).unwrap();
    fs::write(parent.join("not-json/plugin.json"), "{ nope").unwrap();
    fs::create_dir_all(parent.join("no-manifest")).unwrap();

    let mut registry = PluginRegistry::new(None);
    let infos = registry.install_children(&parent, false);
    let status = |id: &str| infos.iter().find(|i| i.id == id).map(|i| i.status);
    assert_eq!(status("example.hello"), Some(PluginStatus::Ready));
    assert_eq!(status("example.no-entry"), Some(PluginStatus::Failed));
    assert_eq!(infos.len(), 3, "folders without plugin.json are skipped");
    let missing = infos.iter().find(|i| i.id == "example.no-entry").unwrap();
    assert!(missing.error.as_deref().unwrap().contains("ui/index.html"));
}

#[test]
fn enabled_flags_survive_a_new_registry_over_the_same_store() {
    let parent = temp_dir("store");
    let store = parent.join("plugins.json");
    let dir = hello(&parent);
    let mut first = PluginRegistry::new(Some(store.clone()));
    first.install(&dir, false);
    assert!(!first.set_enabled("example.hello", false).unwrap().enabled);

    let mut second = PluginRegistry::new(Some(store));
    assert!(!second.install(&dir, false).enabled);
}

#[test]
fn files_are_served_by_id_and_path_and_escapes_are_refused() {
    let parent = temp_dir("files");
    fs::write(parent.join("secret.txt"), "secret").unwrap();
    let mut registry = PluginRegistry::new(None);
    registry.install(&hello(&parent), false);
    assert_eq!(
        registry.file("example.hello", "ui/index.html").unwrap(),
        b"<p>hello</p>"
    );
    assert!(registry.file("example.hello", "../secret.txt").is_err());
    assert!(
        registry
            .file("example.hello", "ui/../../secret.txt")
            .is_err()
    );
    assert!(registry.file("example.missing", "ui/index.html").is_err());
}

#[test]
fn editing_a_watched_plugin_raises_plugin_changed_within_a_second() {
    let parent = temp_dir("watch");
    let dir = hello(&parent);
    let core = Arc::new(Core::new(Roots {
        home: parent.clone(),
    }));
    let before = core.install_plugin(&dir, false).revision;
    let events = core.events().subscribe();
    let _watcher = core.watch_plugins().expect("watcher starts");
    std::thread::sleep(Duration::from_millis(200));

    let started = Instant::now();
    fs::write(dir.join("ui/index.html"), "<p>hello again</p>").unwrap();
    loop {
        let left = Duration::from_secs(1).saturating_sub(started.elapsed());
        let event = events
            .recv_timeout(left)
            .expect("plugin.changed within a second");
        if let BridgeEvent::PluginChanged(changed) = event {
            assert_eq!(changed.data.plugin, "example.hello");
            assert_eq!(changed.data.change, PluginChange::Updated);
            assert_eq!(changed.data.revision, before + 1);
            break;
        }
    }
}
