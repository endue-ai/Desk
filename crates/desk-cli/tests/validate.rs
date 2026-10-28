//! `desk plugin validate <dir>`: the checked-in plugins pass, a broken one fails and says why.

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
fn a_broken_plugin_exits_1_and_names_each_problem() {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-cli-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("plugin.json"),
        r#"{ "id": "Bad", "version": "1", "kind": "theme" }"#,
    )
    .unwrap();
    let out = desk(&["plugin", "validate", dir.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    for problem in ["/id", "/version", "/kind", "entry"] {
        assert!(stderr.contains(problem), "missing {problem} in:\n{stderr}");
    }
}

#[test]
fn usage_errors_exit_2() {
    assert_eq!(desk(&["plugin"]).status.code(), Some(2));
    assert_eq!(desk(&["nope"]).status.code(), Some(2));
}
