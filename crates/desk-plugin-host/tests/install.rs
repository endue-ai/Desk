//! Installing reads plugin.json and the component its entry names, inside the plugin folder.

mod common;

use common::{MockHost, PluginDir, fine};
use desk_plugin_host::{Limits, LogicHost, PluginError};
use serde_json::json;

fn install(dir: &PluginDir) -> Result<String, PluginError> {
    LogicHost::new(MockHost::new(), Limits::default())
        .unwrap()
        .install(&dir.path)
}

fn manifest(kind: &str, entry: &str) -> serde_json::Value {
    json!({ "id": "test.install", "version": "0.1.0", "kind": kind, "entry": entry })
}

#[test]
fn install_needs_a_logic_plugin_with_its_entry_inside_the_folder() {
    let ok = PluginDir::logic("test.install", json!([]), &fine());
    assert_eq!(install(&ok).unwrap(), "test.install");

    let ui = PluginDir::manifest(manifest("ui", "plugin.wasm"));
    ui.write("plugin.wasm", &fine());
    assert!(matches!(install(&ui), Err(PluginError::Manifest(_))));

    let missing = PluginDir::manifest(manifest("logic", "plugin.wasm"));
    assert!(matches!(install(&missing), Err(PluginError::Manifest(_))));

    let outside = PluginDir::manifest(manifest("logic", "../plugin.wasm"));
    assert!(matches!(install(&outside), Err(PluginError::Manifest(_))));

    let nothing = PluginDir::manifest(json!({ "id": "test.install" }));
    assert!(matches!(install(&nothing), Err(PluginError::Manifest(_))));

    let text = PluginDir::logic("test.install", json!([]), b"not wasm");
    assert!(matches!(install(&text), Err(PluginError::Compile(_))));

    let core_module = wat::parse_str("(module)").unwrap();
    let module = PluginDir::logic("test.install", json!([]), &core_module);
    assert!(matches!(install(&module), Err(PluginError::Compile(_))));
}

#[test]
fn a_logic_plugin_without_an_entry_is_a_manifest_error() {
    let dir =
        PluginDir::manifest(json!({ "id": "test.install", "version": "0.1.0", "kind": "logic" }));
    dir.write("plugin.wasm", &fine());
    let Err(PluginError::Manifest(message)) = install(&dir) else {
        panic!("a logic plugin without an entry installed");
    };
    assert!(message.contains("names no entry"), "{message}");
}
