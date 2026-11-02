//! The updates folder: one verified build kept across restarts, checked on the way in and out.

mod support;

use std::fs;

use desk_update::Chosen;
use desk_update::stage::Stage;
use desk_update::verify::sha256_hex;
use support::{LINUX, artifact, dir};

fn chosen(version: &str, bytes: &[u8]) -> Chosen {
    Chosen {
        version: version.to_owned(),
        commit: Some("c46d12b".to_owned()),
        date: None,
        notes: None,
        target: LINUX.to_owned(),
        url: format!("https://releases.example.test/desk/releases/{version}/desk.bin"),
        file: "desk.bin".to_owned(),
        size: bytes.len() as u64,
        sha256: sha256_hex(bytes),
        signature: "sig".to_owned(),
        release: format!("https://releases.example.test/desk/releases/{version}/release.json"),
    }
}

#[test]
fn keeps_a_verified_build_across_restarts() {
    let folder = dir("stage-keep");
    let bytes = artifact("0.2.0", LINUX);
    let build = chosen("0.2.0", &bytes);
    Stage::open(&folder).unwrap().put(&build, &bytes).unwrap();
    let reopened = Stage::open(&folder).unwrap();
    assert_eq!(reopened.staged(), Some(build.clone()));
    assert_eq!(reopened.read(&build).unwrap(), bytes);
    assert!(folder.join("0.2.0/desk.bin").is_file());
}

#[test]
fn rejects_bytes_whose_size_or_sha256_differs() {
    let folder = dir("stage-reject");
    let stage = Stage::open(&folder).unwrap();
    let bytes = artifact("0.2.0", LINUX);
    let build = chosen("0.2.0", &bytes);
    let short = stage.put(&build, &bytes[1..]).unwrap_err();
    assert!(short.contains("bytes"), "{short}");
    let mut other = bytes.clone();
    other[0] ^= 1;
    let digest = stage.put(&build, &other).unwrap_err();
    assert!(digest.contains("sha256"), "{digest}");
    assert_eq!(stage.staged(), None);
    stage.put(&build, &bytes).unwrap();
    fs::write(folder.join("0.2.0/desk.bin"), &other).unwrap();
    assert!(
        stage.read(&build).unwrap_err().contains("sha256"),
        "changed on disk"
    );
}

#[test]
fn keeps_one_staged_build() {
    let folder = dir("stage-one");
    let stage = Stage::open(&folder).unwrap();
    let (first, second) = (artifact("0.2.0", LINUX), artifact("0.3.0", LINUX));
    stage.put(&chosen("0.2.0", &first), &first).unwrap();
    stage.put(&chosen("0.3.0", &second), &second).unwrap();
    assert_eq!(stage.staged().map(|c| c.version), Some("0.3.0".to_owned()));
    assert!(!folder.join("0.2.0").exists(), "the older build is gone");
    let salt = stage.salt();
    stage.discard();
    assert_eq!(stage.staged(), None);
    assert!(!folder.join("0.3.0").exists());
    assert_eq!(stage.salt(), salt, "the salt outlives the builds");
    assert_eq!(salt.len(), 16);
}
