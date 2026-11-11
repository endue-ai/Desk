//! `desk doctor` (ADR 0061): offline, it lists the plugins the runtime quarantined (`desk`'s store
//! key `plugins.quarantined` in store.json) and every `.broken` file in the data folder and the views
//! folder. It exits 0 unless `--data` names no folder; `--json` prints `{ quarantined, broken }`.

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
    let dir =
        std::env::temp_dir().join(format!("desk-doctor-{tag}-{}-{nanos}", std::process::id()));
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
    assert!(
        text.contains("quarantined\texample.throws\t0.1.0"),
        "{text}"
    );
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
    assert!(
        broken
            .iter()
            .any(|path| path.ends_with("plugins.json.broken"))
    );
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
}

/// `desk doctor` on this HOME's own data folder (no `--data`), with nothing else naming one.
#[cfg(unix)]
fn doctor_at_home(home: &Path, json: bool) -> std::process::Output {
    let mut args = vec!["doctor"];
    if json {
        args.push("--json");
    }
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("HOME", home)
        .env_remove("XDG_DATA_HOME")
        .output()
        .expect("desk runs")
}

#[cfg(unix)]
#[test]
fn a_desk_that_never_ran_is_fine_and_says_so() {
    let home = temp("never-ran");
    let out = doctor_at_home(&home, false);
    assert!(out.status.success(), "a desk that never ran is fine");
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.starts_with("ok: no data folder at "), "{text}");
    assert!(text.contains("no desk has run as this user"), "{text}");

    let out = doctor_at_home(&home, true);
    assert!(out.status.success());
    let answer: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        answer,
        json!({ "quarantined": [], "broken": [], "files": [] })
    );
}

#[test]
fn a_data_folder_named_that_is_not_there_fails() {
    let home = temp("no-such");
    let missing = home.join("no/such/dir");
    for args in [
        &["doctor", "--data", missing.to_str().unwrap()][..],
        &[
            "doctor",
            "--last-crash",
            "--data",
            missing.to_str().unwrap(),
        ],
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_desk"))
            .args(args)
            .env("HOME", &home)
            .output()
            .expect("desk runs");
        assert_eq!(out.status.code(), Some(1), "{args:?}");
        let said = String::from_utf8_lossy(&out.stderr);
        assert!(said.contains("no such folder"), "{args:?}: {said}");
        assert!(
            out.stdout.is_empty(),
            "{args:?}: no ok for a folder that is not there"
        );
    }
    let out = doctor(&home, &missing, true);
    assert_eq!(out.status.code(), Some(1));
    let answer: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(answer["ok"], false);
    assert_eq!(answer["error"]["code"], "not_found");

    let file = home.join("a-file");
    fs::write(&file, "").unwrap();
    let out = doctor(&home, &file, false);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("is not a folder"));
}
