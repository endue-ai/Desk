//! `desk doctor` (ADR 0061): offline, it lists the plugins the runtime quarantined (`desk`'s store
//! key `plugins.quarantined` in store.json) and every `.broken` file in the data folder and the views
//! folder. It always exits 0; `--json` prints `{ quarantined, broken }`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

fn temp(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-doctor-{tag}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// `desk doctor` on `data` with `home` as the home folder (for `~/.desk/views`).
fn doctor(home: &Path, data: &Path, json: bool) -> std::process::Output {
    let mut args = vec!["doctor", "--data", data.to_str().unwrap()];
    if json {
        args.push("--json");
    }
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("HOME", home)
        .env("USERPROFILE", home)
        .output()
        .expect("desk runs")
}

#[test]
fn doctor_lists_quarantined_plugins_and_broken_files() {
    let home = temp("lists");
    let data = home.join("data");
    let views = home.join(".desk/views");
    fs::create_dir_all(&data).unwrap();
    fs::create_dir_all(&views).unwrap();
    let store = json!({ "desk": { "plugins.quarantined": [
        { "id": "example.throws", "version": "0.1.0", "at": "2026-11-02T09:00:00Z" }
    ] } });
    fs::write(data.join("store.json"), store.to_string()).unwrap();
    fs::write(data.join("plugins.json.broken"), "{").unwrap();
    fs::write(views.join("torn.yaml.broken"), "id: [").unwrap();

    let out = doctor(&home, &data, false);
    assert!(out.status.success());
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("quarantined\texample.throws\t0.1.0"), "{text}");
    assert!(text.contains("plugins.json.broken"), "{text}");
    assert!(text.contains("torn.yaml.broken"), "{text}");

    let out = doctor(&home, &data, true);
    assert!(out.status.success());
    let answer: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(answer["quarantined"][0]["id"], "example.throws");
    assert_eq!(answer["quarantined"][0]["version"], "0.1.0");
    let broken: Vec<String> = answer["broken"]
        .as_array()
        .unwrap()
        .iter()
        .map(|path| path.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(broken.len(), 2, "{broken:?}");
    assert!(broken.iter().any(|path| path.ends_with("plugins.json.broken")));
    assert!(broken.iter().any(|path| path.ends_with("torn.yaml.broken")));
}

#[test]
fn doctor_says_ok_when_there_is_nothing_to_report() {
    let home = temp("ok");
    let data = home.join("data");
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join("store.json"), "{}").unwrap();

    let out = doctor(&home, &data, false);
    assert!(out.status.success());
    assert!(String::from_utf8_lossy(&out.stdout).starts_with("ok"));

    let out = doctor(&home, &home.join("no-data-yet"), true);
    assert!(out.status.success(), "a desk that never ran is fine too");
    let answer: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(answer, json!({ "quarantined": [], "broken": [] }));
}
