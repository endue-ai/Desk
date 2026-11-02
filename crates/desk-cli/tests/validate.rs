//! `desk plugin validate <dir>`: the checked-in plugins pass, a broken one fails and says why; view,
//! connector and library plugins validate as their kinds say.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn desk(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .output()
        .expect("desk runs")
}

#[test]
fn the_examples_and_built_in_plugins_validate() {
    for folder in ["examples/plugin-hello-ui", "plugins/sidebar"] {
        let dir = repo().join(folder);
        let out = desk(&["plugin", "validate", dir.to_str().unwrap()]);
        assert!(
            out.status.success(),
            "{folder}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(String::from_utf8_lossy(&out.stdout).starts_with("ok "));
    }
}

#[test]
fn hello_connector_validates_as_a_connector_plugin() {
    let dir = repo().join("examples/plugin-hello-connector");
    let out = desk(&["plugin", "validate", dir.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "ok example.hello-connector 0.1.0 (connector plugin)\n"
    );
}

/// A fresh plugin folder holding `manifest` as its plugin.json.
fn plugin_dir(name: &str, manifest: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-cli-{name}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("plugin.json"), manifest).unwrap();
    dir
}

#[test]
fn a_broken_plugin_exits_1_and_names_each_problem() {
    let dir = plugin_dir(
        "broken",
        r#"{ "id": "Bad", "version": "1", "kind": "gadget" }"#,
    );
    let out = desk(&["plugin", "validate", dir.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    for problem in ["/id", "/version", "/kind", "entry"] {
        assert!(stderr.contains(problem), "missing {problem} in:\n{stderr}");
    }
}

#[test]
fn a_theme_plugin_validates_and_says_it_is_a_theme() {
    let dir = plugin_dir(
        "theme",
        r##"{ "id": "example.ember", "version": "0.1.0", "kind": "theme",
             "theme": { "dark": { "colors": { "background": "#1a1210" } } } }"##,
    );
    let out = desk(&["plugin", "validate", dir.to_str().unwrap()]);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "{stderr}");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("ok example.ember 0.1.0 (theme plugin)"),
        "{stdout}"
    );
}

const TODAY: &str = r#"{
  "id": "example.today", "version": "0.1.0", "kind": "view",
  "permissions": [{ "permission": "data:read", "kinds": ["event"] }],
  "view": {
    "id": "example.today", "version": "0.1.0", "title": "Today",
    "requires": { "calendar": { "kinds": ["event"] } },
    "layout": { "type": "agenda", "range": "day", "binding": { "sources": ["$calendar"] } }
  }
}"#;

const FOLDER: &str = r#"{
  "id": "example.folder", "version": "0.1.0", "kind": "connector", "entry": "connector.wasm",
  "connector": {
    "binding": "http", "auth": { "kind": "none" }, "sync": { "mode": "pull" },
    "resources": [{ "kind": "note" }]
  }
}"#;

#[test]
fn a_view_manifest_without_an_entry_validates_and_a_connector_manifest_with_an_unknown_binding_fails()
 {
    let view = plugin_dir("view", TODAY);
    let out = desk(&["plugin", "validate", view.to_str().unwrap()]);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "{stderr}");
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "ok example.today 0.1.0 (view plugin)\n"
    );

    let connector = plugin_dir("connector", FOLDER);
    fs::write(connector.join("connector.wasm"), b"\0asm").unwrap();
    let out = desk(&["plugin", "validate", connector.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("/connector/binding"), "{stderr}");

    let fixed = plugin_dir("connector-wasm", &FOLDER.replace("http", "wasm"));
    fs::write(fixed.join("connector.wasm"), b"\0asm").unwrap();
    let out = desk(&["plugin", "validate", fixed.to_str().unwrap()]);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "ok example.folder 0.1.0 (connector plugin)\n",
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn a_view_plugin_fails_on_names_that_do_not_resolve_and_on_missing_view_files() {
    let unknown = plugin_dir("view-mail", &TODAY.replace("$calendar", "$mail"));
    let out = desk(&["plugin", "validate", unknown.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains(
            "plugin.json/view/layout/binding/sources/0: $mail is not one of the view's requires"
        ),
        "{stderr}"
    );

    let files = plugin_dir(
        "view-files",
        r#"{ "id": "example.boards", "version": "0.1.0", "kind": "view",
             "views": ["views/sprint.yaml", "views/gone.json"] }"#,
    );
    fs::create_dir_all(files.join("views")).unwrap();
    let sprint = "id: example.sprint\nversion: 0.1.0\ntitle: Sprint\nlayout: { type: list }\n";
    fs::write(files.join("views/sprint.yaml"), sprint).unwrap();
    let out = desk(&["plugin", "validate", files.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("views/gone.json does not exist"),
        "{stderr}"
    );
    assert!(!stderr.contains("views/sprint.yaml"), "{stderr}");
}

#[test]
fn a_library_validates_without_an_entry_and_endue_formats_is_one() {
    let dir = repo().join("plugins/formats");
    let out = desk(&["plugin", "validate", dir.to_str().unwrap()]);
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "ok endue.formats 0.1.0 (library plugin)\n",
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let plain = plugin_dir(
        "library",
        r#"{ "id": "example.lib", "version": "0.1.0", "kind": "library" }"#,
    );
    let out = desk(&["plugin", "validate", plain.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "ok example.lib 0.1.0 (library plugin)\n"
    );
}

#[test]
fn a_library_that_runs_contributes_or_asks_fails_and_names_each_field() {
    let dir = plugin_dir(
        "library-runs",
        r#"{ "id": "example.lib", "version": "0.1.0", "kind": "library", "entry": "lib/index.js",
             "permissions": [{ "permission": "ui:notify" }], "autoload": true,
             "contributes": { "commands": [{ "id": "example.lib.go", "title": "Go" }] } }"#,
    );
    fs::create_dir_all(dir.join("lib")).unwrap();
    fs::write(dir.join("lib/index.js"), "export {};\n").unwrap();
    let out = desk(&["plugin", "validate", dir.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    for field in ["/entry", "/permissions", "/autoload", "/contributes"] {
        assert!(stderr.contains(field), "missing {field} in:\n{stderr}");
    }
}

#[test]
fn usage_errors_exit_2() {
    assert_eq!(desk(&["plugin"]).status.code(), Some(2));
    assert_eq!(desk(&["nope"]).status.code(), Some(2));
}
