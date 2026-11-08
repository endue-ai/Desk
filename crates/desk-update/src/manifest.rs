//! The documents on R2 (ADR 0054), as `specs/update/v0` defines them: a channel's index, which lists
//! the builds on that channel, and a build's release manifest, the Tauri updater's static format plus
//! a `desk` block. Both are signed (`.sig` beside each); `verify` checks them before anything here
//! reads them. The types are generated (`crate::generated`); these names are the crate's own.

use crate::generated::{
    ReleaseArtifact, ReleaseChannel, ReleaseDesk, ReleaseIndex, ReleaseListing, ReleaseManifest,
    ReleasePlatform,
};

/// `channels/<channel>/index.json`: the builds on one channel, newest first.
pub type Index = ReleaseIndex;
/// One build on a channel.
pub type Listed = ReleaseListing;
/// `releases/<version>/release.json`.
pub type Release = ReleaseManifest;
/// One target's artifact as the Tauri updater reads it.
pub type Platform = ReleasePlatform;
/// What Desk adds to the Tauri format.
pub type DeskBlock = ReleaseDesk;
/// An artifact's digest and length, checked before its signature.
pub type Artifact = ReleaseArtifact;

/// The share of desks a listing reaches: its `rollout`, 100 when absent.
pub fn rollout(listed: &Listed) -> u8 {
    listed.rollout.map_or(100, |share| share.min(100) as u8)
}

impl ReleaseChannel {
    /// The channel's name in paths and in the index: `canary`, `beta` or `stable`.
    pub fn name(self) -> &'static str {
        match self {
            Self::Canary => "canary",
            Self::Beta => "beta",
            Self::Stable => "stable",
        }
    }
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
