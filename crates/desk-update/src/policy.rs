//! Which build a desk moves to next, decided on the device from the channel index alone
//! (`docs/ko/updater-requirements.md`, "데스크의 판단" 1–4).
//!
//! 1. Candidates are listed builds newer than the running one with an artifact for one of its targets.
//! 2. The newest candidate whose `minFrom` the running version meets is this step; a newer one waits
//!    for the next check, after the restart. The desk walks the update path itself.
//! 3. A build at `rollout < 100` reaches the desks whose bucket falls below it.
//! 4. Never a downgrade, never the same version again.

use semver::Version;
use sha2::{Digest, Sha256};

use crate::manifest::{Index, Listed, Release};

/// The build to move to next, if any. `bucket` is this desk's rollout bucket for a version (0–99).
pub fn choose<'a>(
    index: &'a Index,
    current: &Version,
    targets: &[String],
    bucket: impl Fn(&str) -> u8,
) -> Option<&'a Listed> {
    let mut candidates: Vec<(Version, &Listed)> = index
        .releases
        .iter()
        .filter_map(|listed| Some((Version::parse(&listed.version).ok()?, listed)))
        .filter(|(version, listed)| {
            version > current
                && listed.targets.iter().any(|t| targets.contains(t))
                && bucket(&listed.version) < listed.rollout.min(100)
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates
        .into_iter()
        .find(|(_, listed)| reachable(listed.min_from.as_deref(), current))
        .map(|(_, listed)| listed)
}

/// Whether a build that names `min_from` takes a desk at `current` directly.
fn reachable(min_from: Option<&str>, current: &Version) -> bool {
    match min_from {
        None => true,
        Some(min) => Version::parse(min).is_ok_and(|min| min <= *current),
    }
}

/// Whether the index lists `version`.
pub fn listed(index: &Index, version: &str) -> bool {
    index
        .releases
        .iter()
        .any(|listed| listed.version == version)
}

/// The target this desk takes from `release`: the first of `targets` it has an artifact and a
/// signature for.
pub fn target<'a>(release: &Release, targets: &'a [String]) -> Option<&'a str> {
    targets
        .iter()
        .find(|t| release.platforms.contains_key(*t) && release.desk.artifacts.contains_key(*t))
        .map(String::as_str)
}

/// This desk's bucket for `version`, 0–99: the same answer every time for one salt, so a growing
/// rollout only ever adds desks.
pub fn bucket(salt: &[u8], version: &str) -> u8 {
    let digest = Sha256::new()
        .chain_update(salt)
        .chain_update(version.as_bytes())
        .finalize();
    let word = u16::from_be_bytes([digest[0], digest[1]]);
    (word % 100) as u8
}
