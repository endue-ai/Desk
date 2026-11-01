//! Library plugins: files other plugins import. The desk installs one like any plugin and serves its
//! files at `/<id>/<path>`; it has no entry and no surfaces, so nothing ever mounts it, and nothing
//! turns it off: not `plugin.setEnabled`, not a stored flag, not init.yaml's `plugins.disabled`.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{BridgeEvent, ErrorCode, PluginChange, PluginKind, PluginStatus};
use desk_core::{Core, PluginRegistry};
use serde_json::json;
use support::{call, grant, home, plugin_manage, roots};

const LIBRARY: &str = "example.formats";
const MODULE: &str = "export const answer = 42;\n";

/// A library folder under `parent`: a manifest and one module in `lib/`.
fn library(parent: &Path) -> PathBuf {
    let dir = parent.join("plugins/formats");
    fs::create_dir_all(dir.join("lib/codecs")).unwrap();
    fs::write(
        dir.join("plugin.json"),
        json!({ "id": LIBRARY, "name": "Formats", "version": "0.1.0", "kind": "library",
                "description": "Readers other plugins import." })
        .to_string(),
    )
    .unwrap();
    fs::write(dir.join("lib/codecs/index.js"), MODULE).unwrap();
    dir
}

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn a_library_installs_and_serves_its_files() {
    let home = home("library-serve");
    let core = Core::new(roots(&home));
    let events = core.events().subscribe();
    let dir = library(&home);
    fs::write(home.join("plugins/beside.txt"), "not the library's").unwrap();

    let info = core.install_plugin(&dir, true);
    assert_eq!(info.status, PluginStatus::Ready, "{:?}", info.error);
    let manifest = info.manifest.expect("a ready library has its manifest");
    assert_eq!(manifest.kind, PluginKind::Library);
    assert_eq!(manifest.entry, None, "a library has no entry");
    assert!(info.enabled && info.built_in);
    match events.try_recv().expect("plugin.changed for the install") {
        BridgeEvent::PluginChanged(changed) => {
            assert_eq!(changed.data.plugin, LIBRARY);
            assert_eq!(changed.data.change, PluginChange::Installed);
        }
        other => panic!("expected plugin.changed, got {other:?}"),
    }

    // The plugin scheme serves `/<id>/<path>` from here, as for any plugin.
    let served = core.plugin_file(LIBRARY, "lib/codecs/index.js").unwrap();
    assert_eq!(served, MODULE.as_bytes());
    assert!(core.plugin_file(LIBRARY, "lib/missing.js").is_err());
    assert!(core.plugin_file(LIBRARY, "../beside.txt").is_err());
    assert!(core.plugin_file(LIBRARY, "lib/../../beside.txt").is_err());

    // The built-in endue.formats is one: its codecs and 7z reader are served the same way.
    let formats = core.install_plugin(&repo().join("plugins/formats"), true);
    assert_eq!(formats.id, "endue.formats");
    assert_eq!(formats.status, PluginStatus::Ready, "{:?}", formats.error);
    let kind = formats.manifest.map(|m| m.kind);
    assert_eq!(kind, Some(PluginKind::Library));
    for module in ["lib/codecs/index.js", "lib/sevenzip/index.js"] {
        let bytes = core.plugin_file("endue.formats", module).unwrap();
        assert!(bytes.starts_with(b"// "), "{module} is served");
    }
}

#[test]
fn a_library_is_never_mounted_or_turned_off() {
    let home = home("library-on");
    let init = home.join("init.yaml");
    fs::write(&init, format!("plugins:\n  disabled: [{LIBRARY}]\n")).unwrap();
    let store = home.join("plugins.json");
    fs::write(&store, json!({ "enabled": { LIBRARY: false } }).to_string()).unwrap();
    let core = Core::new(roots(&home))
        .with_init_file(init)
        .with_plugin_store(store);

    let info = core.install_plugin(&library(&home), true);
    assert!(
        info.enabled,
        "neither init.yaml nor a stored flag holds a library off"
    );

    // Nothing to mount: no surface opens, even under a ui:surface grant.
    grant(&core, LIBRARY, json!({ "permission": "ui:surface" }));
    let mounted = call(
        &core,
        LIBRARY,
        "ui.surface.open",
        json!({ "surface": "main", "scope": { "permission": "ui:surface" } }),
    )
    .unwrap_err();
    assert_eq!(mounted.code, ErrorCode::InvalidParams);
    assert_eq!(core.surface_count(), 0);

    // plugin.setEnabled refuses to turn it off, and nothing changes.
    grant(&core, "desk", plugin_manage());
    let events = core.events().subscribe();
    let off = call(
        &core,
        "desk",
        "plugin.setEnabled",
        json!({ "plugin": LIBRARY, "enabled": false, "scope": plugin_manage() }),
    )
    .unwrap_err();
    assert_eq!(off.code, ErrorCode::Unsupported);
    assert!(
        off.message.contains(LIBRARY) && off.message.contains("library"),
        "{}",
        off.message
    );
    assert!(
        events.try_recv().is_err(),
        "no plugin.changed: it stayed on"
    );
    let on = call(
        &core,
        "desk",
        "plugin.setEnabled",
        json!({ "plugin": LIBRARY, "enabled": true, "scope": plugin_manage() }),
    )
    .unwrap();
    assert_eq!(on["plugin"]["enabled"], true);
    assert!(
        events.try_recv().is_err(),
        "turning on what is on changes nothing"
    );
    let listed = core.plugins();
    assert!(listed.iter().any(|p| p.id == LIBRARY && p.enabled));

    // The registry alone keeps it on too, and remembers no flag for it.
    let mut registry = PluginRegistry::new(Some(home.join("registry.json")));
    registry.install(&library(&home), true);
    assert!(registry.hold_off(LIBRARY).unwrap().enabled);
    assert!(registry.set_enabled(LIBRARY, false).unwrap().enabled);
    assert!(!home.join("registry.json").exists());
}

#[test]
fn plugin_list_reports_the_library_kind() {
    let home = home("library-list");
    let core = Core::new(roots(&home));
    core.install_plugin(&library(&home), true);
    grant(&core, "desk", plugin_manage());

    let listed = call(
        &core,
        "desk",
        "plugin.list",
        json!({ "scope": plugin_manage() }),
    )
    .unwrap();
    let plugins = listed["plugins"].as_array().unwrap();
    let formats = plugins.iter().find(|p| p["id"] == LIBRARY).unwrap();
    assert_eq!(formats["status"], "ready");
    assert_eq!(formats["enabled"], true);
    assert_eq!(formats["builtIn"], true);
    assert_eq!(formats["manifest"]["kind"], "library");
    assert!(formats["manifest"].get("entry").is_none());
    assert!(formats["manifest"].get("surfaces").is_none());
    assert!(formats.get("error").is_none());
}
