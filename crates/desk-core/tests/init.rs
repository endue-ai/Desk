//! init.yaml (specs/init/v0): written from the template when missing, read at start, checked against
//! the spec, never overwritten when broken, and the plugins it disables start disabled.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse, Permission};
use desk_core::{Core, INIT_TEMPLATE, Init, Roots};
use serde_json::{Value, json};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "desk-init-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn core(init: &Path) -> Core {
    Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_init_file(init.to_path_buf())
}

fn hello(parent: &Path) -> PathBuf {
    let dir = parent.join("hello");
    fs::create_dir_all(dir.join("ui")).unwrap();
    let manifest: Value = json!({ "id": "example.hello", "version": "0.1.0", "kind": "ui",
        "entry": "ui/index.html", "surfaces": [{ "id": "main", "title": "Hello", "placement": "center" }] });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    dir
}

#[test]
fn a_missing_init_yaml_is_written_from_the_template() {
    let path = temp_dir("missing").join(".desk/init.yaml");
    let core = core(&path);
    assert_eq!(fs::read_to_string(&path).unwrap(), INIT_TEMPLATE);
    assert_eq!(core.init(), Init::default());
    assert_eq!(core.init_problem(), None);
}

#[test]
fn the_template_is_the_spec_template_and_holds_the_defaults() {
    let vector = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../specs/init/v0/vectors/valid/template.json"),
    )
    .unwrap();
    let vector: Value = serde_json::from_str(&vector).unwrap();
    let parsed: Value = yaml_serde::from_str(INIT_TEMPLATE).unwrap();
    assert_eq!(parsed, vector["instance"]);
    assert_eq!(Init::parse(INIT_TEMPLATE), Ok(Init::default()));
}

#[test]
fn an_init_yaml_outside_the_spec_is_refused_with_where() {
    let path = temp_dir("outside").join("init.yaml");
    fs::write(&path, "mode: focus\nplugins:\n  disabled: [Sidebar]\n").unwrap();
    let core = core(&path);
    assert_eq!(core.init(), Init::default());
    let problem = core.init_problem().expect("the problem is reported");
    assert!(
        problem.starts_with("init.yaml/plugins/disabled/0: "),
        "{problem}"
    );
}

#[test]
fn an_existing_init_yaml_is_read_and_left_as_it_is() {
    let path = temp_dir("existing").join("init.yaml");
    let text = "# mine\nmode: focus\nsettings:\n  eris.voice: true\n";
    fs::write(&path, text).unwrap();
    let core = core(&path);
    assert_eq!(core.init().mode, "focus");
    assert_eq!(core.init().setting("eris.voice"), Some(&json!(true)));
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn a_broken_init_yaml_starts_with_the_defaults_and_is_not_overwritten() {
    let path = temp_dir("broken").join("init.yaml");
    fs::write(&path, "mode: [\n").unwrap();
    let core = core(&path);
    assert_eq!(core.init(), Init::default());
    let problem = core.init_problem().expect("the problem is reported");
    assert!(problem.contains("line"), "names where: {problem}");
    assert_eq!(fs::read_to_string(&path).unwrap(), "mode: [\n");
}

#[test]
fn plugins_init_yaml_disables_start_disabled_until_enabled() {
    let dir = temp_dir("plugins");
    let path = dir.join("init.yaml");
    fs::write(&path, "plugins:\n  disabled: [example.hello]\n").unwrap();
    let store = dir.join("plugins.json");
    let first = core(&path).with_plugin_store(store.clone());
    let info = first.install_plugin(&hello(&dir), true);
    assert!(!info.enabled);
    assert!(
        !store.exists(),
        "holding a plugin off does not touch its persisted flag"
    );

    let permission: Permission =
        serde_json::from_value(json!({ "permission": "plugin:manage" })).unwrap();
    first.grant("desk", permission);
    let request: BridgeRequest = serde_json::from_value(json!({ "id": 1, "method": "plugin.setEnabled",
        "params": { "plugin": "example.hello", "enabled": true, "scope": { "permission": "plugin:manage" } } }))
    .unwrap();
    assert!(matches!(
        first.handle("desk", request),
        BridgeResponse::BridgeSuccess(_)
    ));
    assert!(
        first.plugins()[0].enabled,
        "the person can turn it on for this run"
    );

    fs::write(&path, "plugins:\n  disabled: [example.hello]\n").unwrap();
    let next = core(&path).with_plugin_store(store.clone());
    assert!(
        !next.install_plugin(&hello(&dir), true).enabled,
        "init.yaml applies again at start"
    );

    fs::write(&path, "plugins:\n  disabled: []\n").unwrap();
    let after = core(&path).with_plugin_store(store);
    assert!(after.install_plugin(&hello(&dir), true).enabled);
}
