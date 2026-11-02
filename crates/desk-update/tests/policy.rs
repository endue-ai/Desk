//! Which build a desk moves to next: newer, for its target, by the update path, inside the rollout,
//! never down.

use desk_update::manifest::{self, Index};
use desk_update::policy::{bucket, choose, target};
use semver::Version;
use serde_json::{Value, json};

const LINUX: &str = "linux-x86_64";
const MAC: &str = "darwin-aarch64";

fn listed(version: &str, min_from: Option<&str>, targets: &[&str]) -> Value {
    let mut entry = json!({ "version": version, "targets": targets, "release": "r.json" });
    if let Some(min) = min_from {
        entry["minFrom"] = json!(min);
    }
    entry
}

fn index(releases: Vec<Value>) -> Index {
    let index = json!({ "channel": "stable", "serial": 1, "releases": releases });
    manifest::index(&serde_json::to_vec(&index).unwrap()).unwrap()
}

fn pick(index: &Index, current: &str, targets: &[&str]) -> Option<String> {
    let targets: Vec<String> = targets.iter().map(|t| t.to_string()).collect();
    let current = Version::parse(current).unwrap();
    choose(index, &current, &targets, |_| 0).map(|l| l.version.clone())
}

#[test]
fn picks_the_newest_listed_release_for_my_target() {
    let index = index(vec![
        listed("0.3.0", None, &[MAC]),
        listed("0.2.0", None, &[MAC, LINUX]),
        listed("0.1.0", None, &[MAC, LINUX]),
    ]);
    assert_eq!(pick(&index, "0.1.0", &[LINUX]).as_deref(), Some("0.2.0"));
    assert_eq!(pick(&index, "0.1.0", &[MAC]).as_deref(), Some("0.3.0"));
}

#[test]
fn walks_a_stepping_stone_when_min_from_is_above_me() {
    let index = index(vec![
        listed("0.3.0", Some("0.2.0"), &[LINUX]),
        listed("0.2.0", Some("0.1.0"), &[LINUX]),
    ]);
    assert_eq!(pick(&index, "0.1.5", &[LINUX]).as_deref(), Some("0.2.0"));
    assert_eq!(pick(&index, "0.2.0", &[LINUX]).as_deref(), Some("0.3.0"));
    assert_eq!(pick(&index, "0.0.9", &[LINUX]), None, "no step takes 0.0.9");
}

#[test]
fn never_downgrades_or_reinstalls() {
    let stable = index(vec![
        listed("0.2.0", None, &[LINUX]),
        listed("0.1.0", None, &[LINUX]),
    ]);
    assert_eq!(pick(&stable, "0.2.0", &[LINUX]), None);
    assert_eq!(pick(&stable, "0.3.0", &[LINUX]), None);
    // A canary build is above the last tag and below the next one.
    assert_eq!(pick(&stable, "0.2.1-pre.5", &[LINUX]), None);
    let canary = index(vec![
        listed("0.2.1-pre.6", None, &[LINUX]),
        listed("0.2.1-pre.5", None, &[LINUX]),
    ]);
    assert_eq!(
        pick(&canary, "0.2.1-pre.5", &[LINUX]).as_deref(),
        Some("0.2.1-pre.6")
    );
    let tagged = index(vec![listed("0.2.1", None, &[LINUX])]);
    assert_eq!(
        pick(&tagged, "0.2.1-pre.6", &[LINUX]).as_deref(),
        Some("0.2.1")
    );
}

#[test]
fn skips_releases_without_my_target() {
    let index = index(vec![listed("0.2.0", None, &[MAC])]);
    assert_eq!(pick(&index, "0.1.0", &[LINUX, "linux-x86_64-deb"]), None);
    let release = manifest::release(
        &serde_json::to_vec(&json!({
            "version": "0.2.0",
            "platforms": {
                "linux-x86_64-appimage": { "url": "a", "signature": "s" },
                "linux-x86_64-deb": { "url": "d", "signature": "s" },
                "linux-x86_64": { "url": "g", "signature": "s" }
            },
            "desk": { "artifacts": {
                "linux-x86_64-deb": { "sha256": "00", "size": 1 },
                "linux-x86_64": { "sha256": "00", "size": 1 }
            } }
        }))
        .unwrap(),
    )
    .unwrap();
    let mine = ["linux-x86_64-deb".to_owned(), LINUX.to_owned()];
    assert_eq!(target(&release, &mine), Some("linux-x86_64-deb"));
    let appimage = ["linux-x86_64-appimage".to_owned()];
    assert_eq!(
        target(&release, &appimage),
        None,
        "a signature alone is not an artifact"
    );
}

#[test]
fn rollout_admits_a_steady_share_of_desks() {
    let mut entry = listed("0.2.0", None, &[LINUX]);
    entry["rollout"] = json!(30);
    let partial = index(vec![entry]);
    let current = Version::parse("0.1.0").unwrap();
    let targets = [LINUX.to_owned()];
    let salts: Vec<[u8; 4]> = (0u32..2000).map(u32::to_le_bytes).collect();
    let admitted = salts
        .iter()
        .filter(|salt| choose(&partial, &current, &targets, |v| bucket(&salt[..], v)).is_some())
        .count();
    assert!(
        (500..700).contains(&admitted),
        "30 % of 2000 desks, got {admitted}"
    );
    for salt in &salts {
        let first = bucket(&salt[..], "0.2.0");
        assert_eq!(
            first,
            bucket(&salt[..], "0.2.0"),
            "a desk's bucket does not move"
        );
        assert!(first < 100);
    }
    let mut none = listed("0.2.0", None, &[LINUX]);
    none["rollout"] = json!(0);
    let closed = index(vec![none]);
    assert!(
        salts
            .iter()
            .all(|s| choose(&closed, &current, &targets, |v| bucket(&s[..], v)).is_none())
    );
}
