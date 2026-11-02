//! The documents on R2 (ADR 0054): a channel's index, which lists the builds on that channel, and a
//! build's release manifest, the Tauri updater's static format plus a `desk` block. Both are signed
//! (`.sig` beside each); `verify` checks them before anything here reads them.

use std::collections::BTreeMap;

use serde::Deserialize;

/// `channels/<channel>/index.json`: the builds on one channel, newest first.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub channel: String,
    /// Raised on every write. A desk refuses an index older than one it has seen, so a stale copy
    /// cannot bring back a build that was taken down.
    pub serial: u64,
    #[serde(default)]
    pub generated: Option<String>,
    pub releases: Vec<Listed>,
}

/// One build on a channel.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    pub version: String,
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    /// The lowest version that may move to this build directly; lower ones take an older build first.
    #[serde(default)]
    pub min_from: Option<String>,
    /// The share of desks that see the build, 0 to 100.
    #[serde(default = "everyone")]
    pub rollout: u8,
    /// The targets it has artifacts for: `darwin-aarch64`, `windows-x86_64-nsis`, `linux-x86_64-deb`.
    pub targets: Vec<String>,
    /// Its release manifest: absolute, or relative to the base URL.
    pub release: String,
}

fn everyone() -> u8 {
    100
}

/// `releases/<version>/release.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub version: String,
    /// Where its notes are: the GitHub release, or the commit for a pre-release.
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    pub platforms: BTreeMap<String, Platform>,
    pub desk: DeskBlock,
}

/// One target's artifact as the Tauri updater reads it.
#[derive(Debug, Clone, Deserialize)]
pub struct Platform {
    pub url: String,
    /// The artifact's minisign signature, base64 as the Tauri CLI writes it.
    pub signature: String,
}

/// What Desk adds to the Tauri format.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskBlock {
    #[serde(default)]
    pub commit: Option<String>,
    #[serde(default)]
    pub min_from: Option<String>,
    pub artifacts: BTreeMap<String, Artifact>,
}

/// An artifact's digest and length, checked before its signature.
#[derive(Debug, Clone, Deserialize)]
pub struct Artifact {
    pub sha256: String,
    pub size: u64,
}

pub fn index(bytes: &[u8]) -> Result<Index, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("the channel index does not read: {e}"))
}

pub fn release(bytes: &[u8]) -> Result<Release, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("the release manifest does not read: {e}"))
}

/// `url` when it is absolute, else `base` joined with it.
pub fn resolve(base: &str, url: &str) -> String {
    if url.starts_with("https://") || url.starts_with("http://") {
        url.to_owned()
    } else {
        format!(
            "{}/{}",
            base.trim_end_matches('/'),
            url.trim_start_matches('/')
        )
    }
}

/// The file name an artifact keeps on disk: the URL's last segment, if it is a plain name.
pub fn file_name(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or_default();
    let last = path.rsplit('/').next().unwrap_or_default();
    let plain = !last.is_empty()
        && !last.starts_with('.')
        && last
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'));
    if plain {
        last.to_owned()
    } else {
        "artifact".to_owned()
    }
}
