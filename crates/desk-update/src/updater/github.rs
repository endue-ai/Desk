//! Discovery uses public release pages. Decisions use only signed indexes on their named tags.

use std::collections::BTreeSet;

use semver::Version;
use serde::Deserialize;

use super::Updater;
use crate::generated::ReleaseChannel;
use crate::manifest::Index;
use crate::policy;
use crate::status::Channel;
use crate::{LEGACY_RELEASES, RENAMED_RELEASES};

const PAGE_SIZE: usize = 30;

pub(super) fn release_api(base: &str) -> Option<&'static str> {
    match base {
        LEGACY_RELEASES => Some("https://api.github.com/repos/endue-ai/Desk/releases"),
        RENAMED_RELEASES => Some("https://api.github.com/repos/endue-ai/endue/releases"),
        _ => None,
    }
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
}

impl Updater {
    pub(super) fn github_index(
        &self,
        channel: Channel,
        base: &str,
        api: &str,
    ) -> Result<Index, String> {
        let mut versions = BTreeSet::new();
        let snapshot = format!("desk-updates-{}", channel.name());
        let mut has_snapshot = false;
        for page in 1.. {
            let bytes = self
                .inner
                .transport
                .get(&format!("{api}?per_page={PAGE_SIZE}&page={page}"))?;
            let releases: Vec<Release> = serde_json::from_slice(&bytes)
                .map_err(|e| format!("GitHub Releases could not be read: {e}"))?;
            let last = releases.len() < PAGE_SIZE;
            for release in releases {
                if release.draft || !release.assets.iter().any(|a| a.name == "UPGRADE_PATH.json") {
                    continue;
                }
                if release.tag_name == snapshot && channel != Channel::Stable && release.prerelease
                {
                    has_snapshot = true;
                } else if let Some(version) = tag_version(&release, channel)
                    && version > self.inner.current
                {
                    versions.insert(version);
                }
            }
            if last {
                break;
            }
        }
        let mut result = Index {
            channel: match channel {
                Channel::Stable => ReleaseChannel::Stable,
                Channel::Beta => ReleaseChannel::Beta,
                Channel::Canary => ReleaseChannel::Canary,
            },
            serial: 1,
            generated: None,
            releases: Vec::new(),
        };
        if has_snapshot {
            result = self.tag_path(base, &snapshot, channel)?;
            if result
                .releases
                .iter()
                .any(|row| !row.release.starts_with("https://"))
            {
                return Err(format!("{snapshot} must name absolute HTTPS manifests"));
            }
            self.inner.stage.see(&snapshot, result.serial);
            // A tagged path owns that version, including a signed withdrawal.
            result
                .releases
                .retain(|row| !Version::parse(&row.version).is_ok_and(|v| versions.contains(&v)));
        }
        let current = &self.inner.current;
        let targets = &self.inner.config.targets;
        let bucket = |version: &str| policy::bucket(&self.inner.salt, version);
        let mut best = policy::choose(&result, current, targets, bucket)
            .and_then(|row| Version::parse(&row.version).ok());
        let staged = self
            .inner
            .stage
            .staged()
            .and_then(|c| Version::parse(&c.version).ok());
        for version in versions.into_iter().rev() {
            // Only the staged fallback still needs checking below the best eligible version.
            if best.as_ref().is_some_and(|v| v > &version) && staged.as_ref() != Some(&version) {
                continue;
            }
            let tag = format!("v{version}");
            let path = self.tag_path(base, &tag, channel)?;
            let manifests = [LEGACY_RELEASES, RENAMED_RELEASES]
                .map(|origin| format!("{origin}/download/{tag}/release.json"));
            let version = version.to_string();
            if path.releases.len() > 1
                || path
                    .releases
                    .iter()
                    .any(|row| row.version != version || !manifests.contains(&row.release))
            {
                return Err(format!("UPGRADE_PATH.json does not match release {tag}"));
            }
            self.inner.stage.see(&tag, path.serial);
            if let Some(candidate) = path
                .releases
                .first()
                .and_then(|row| policy::eligible(row, current, targets, bucket))
            {
                best = best.max(Some(candidate));
            }
            result.releases.extend(path.releases);
        }
        Ok(result)
    }

    fn tag_path(&self, base: &str, tag: &str, channel: Channel) -> Result<Index, String> {
        let url = format!("{base}/download/{tag}/UPGRADE_PATH.json");
        self.signed_index(&url, channel, tag)
    }
}

fn tag_version(release: &Release, channel: Channel) -> Option<Version> {
    let text = release.tag_name.strip_prefix('v')?;
    let version = Version::parse(text).ok()?;
    (version.build.is_empty()
        && release.prerelease != version.pre.is_empty()
        && Channel::of_version(text) == channel)
        .then_some(version)
}
