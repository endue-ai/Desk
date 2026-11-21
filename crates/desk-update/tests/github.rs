//! Published GitHub tags, including a legacy installer and a stepping stone on the second page.
mod support;

use desk_update::{Channel, Prefs, State, Transport, Updater};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use support::*;

const GH: &str = "https://github.com/endue-ai/Desk/releases";
const API: &str = "https://api.github.com/repos/endue-ai/Desk/releases";

fn signed(origin: &Origin, key: &Key, url: &str, document: &Value) {
    let bytes = serde_json::to_vec(document).unwrap();
    origin.put(&format!("{url}.sig"), key.sign(&bytes, None).into_bytes());
    origin.put(url, bytes);
}

fn row(tag: &str) -> Value {
    json!({"tag_name": tag, "draft": false, "prerelease": false,
        "assets": [{"name":"UPGRADE_PATH.json"},{"name":"UPGRADE_PATH.json.sig"}]})
}

fn page(origin: &Origin, number: u32, releases: &[Value]) {
    origin.put(
        &format!("{API}?per_page=30&page={number}"),
        serde_json::to_vec(releases).unwrap(),
    );
}

fn publish(origin: &Origin, key: &Key, version: &str, min: &str, target: &str) -> Value {
    let mut entry = origin.release(key, version, &[target], min);
    let manifest = origin
        .get(&format!("{BASE}/releases/{version}/release.json"))
        .unwrap();
    let mut manifest: Value = serde_json::from_slice(&manifest).unwrap();
    let base = format!("{GH}/download/v{version}");
    let artifact_url = format!("{base}/desk.bin");
    origin.put(&artifact_url, artifact(version, target));
    manifest["platforms"][target]["url"] = json!(artifact_url);
    entry["release"] = json!(format!("{base}/release.json"));
    signed(origin, key, &format!("{base}/release.json"), &manifest);
    signed(
        origin,
        key,
        &format!("{base}/UPGRADE_PATH.json"),
        &json!({"channel":"stable","serial":2,"releases":[entry]}),
    );
    row(&format!("v{version}"))
}

fn desk(key: &Key, origin: Arc<Origin>, dir: &Path, version: &str) -> Updater {
    let mut cfg = config(dir, key, version);
    cfg.base = GH.into();
    Updater::new(cfg, origin, shared(Recorder::default()), Prefs::default()).unwrap()
}

#[test]
fn stages_only_the_highest_reachable_tag_across_pages_then_takes_the_next_hop() {
    let key = Key::new();
    let origin = shared(Origin::default());
    let mut legacy = row("v8.0.0");
    legacy["assets"] = json!([{"name":"Desk.dmg"}]);
    let mut draft = row("v7.0.0");
    draft["draft"] = json!(true);
    let mut preview = row("v6.0.0-rc.1");
    preview["prerelease"] = json!(true);
    let mut first = vec![
        legacy,
        draft,
        preview,
        publish(&origin, &key, "2.0.0", "1.10.0", DEB),
        publish(&origin, &key, "3.0.0", "0.0.0", MAC),
        publish(&origin, &key, "1.2.0", "0.0.0", DEB),
    ];
    first.resize(30, row("v0.0.1"));
    page(&origin, 1, &first);
    page(
        &origin,
        2,
        &[publish(&origin, &key, "1.10.0", "0.1.0", DEB)],
    );
    let path = dir("github-two-hops");
    for (current, next) in [("0.1.0", "1.10.0"), ("1.10.0", "2.0.0")] {
        let updater = desk(&key, origin.clone(), &path, current);
        let status = updater.check_now(Prefs::default());
        assert_eq!(status.state, State::Staged, "{:?}", status.reason);
        assert_eq!(status.release.unwrap().version, next);
    }
    assert_eq!(
        *origin.downloads.lock().unwrap(),
        [
            format!("{GH}/download/v1.10.0/desk.bin"),
            format!("{GH}/download/v2.0.0/desk.bin")
        ]
    );
}

#[test]
fn rejects_a_forged_path_and_keeps_a_verified_download_offline() {
    let key = Key::new();
    let origin = shared(Origin::default());
    page(&origin, 1, &[publish(&origin, &key, "1.0.0", "0.1.0", DEB)]);
    let updater = desk(&key, origin.clone(), &dir("github-forgery"), "0.1.0");
    let url = format!("{GH}/download/v1.0.0/UPGRADE_PATH.json");
    let good = origin.get(&url).unwrap();
    origin.put(&url, b"{}".to_vec());
    let refused = updater.check_now(Prefs::default());
    assert_eq!(refused.state, State::Failed);
    assert!(refused.reason.unwrap().contains("signature"));
    assert!(origin.downloads.lock().unwrap().is_empty());
    origin.put(&url, good);
    assert!(updater.check_now(Prefs::default()).staged);
    origin.remove(&format!("{API}?per_page=30&page=1"));
    assert!(updater.check_now(Prefs::default()).staged);
    page(&origin, 1, &[]);
    assert_eq!(updater.check_now(Prefs::default()).state, State::UpToDate);
    assert!(updater.apply_now().is_err());
}

#[test]
fn the_preview_channel_reads_its_signed_snapshot_from_its_github_prerelease() {
    let key = Key::new();
    let origin = shared(Origin::default());
    let mut tag = row("desk-updates-beta");
    tag["prerelease"] = json!(true);
    page(&origin, 1, &[tag]);
    let mut entry = origin.release(&key, "1.0.0-rc.2", &[DEB], "0.1.0");
    entry["release"] = json!(format!("{BASE}/releases/1.0.0-rc.2/release.json"));
    signed(
        &origin,
        &key,
        &format!("{GH}/download/desk-updates-beta/UPGRADE_PATH.json"),
        &json!({"channel":"beta","serial":1,"releases":[entry]}),
    );
    let updater = desk(&key, origin, &dir("github-preview"), "0.1.0");
    let status = updater.check_now(Prefs {
        channel: Channel::Beta,
        ..Prefs::default()
    });
    assert_eq!(status.state, State::Staged, "{:?}", status.reason);
    assert_eq!(status.release.unwrap().version, "1.0.0-rc.2");
}
