//! What the app supplies to the updater: how it reaches the release origin, how it installs a build,
//! what it knows about itself, and the person's settings.

use crate::status::{Channel, Chosen};

/// How the updater reaches the release origin.
pub trait Transport: Send + Sync {
    /// The bytes at `url`, whole: an index, a manifest or a signature.
    fn get(&self, url: &str) -> Result<Vec<u8>, String>;
    /// The artifact at `url`, calling `progress(received, total)` as bytes arrive.
    fn download(
        &self,
        url: &str,
        progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<Vec<u8>, String>;
}

/// How the app installs a build.
pub trait Installer: Send + Sync {
    /// Get ready to install `chosen` once it is staged, and again after a restart. A failure only
    /// means `install` has to get ready itself.
    fn prepare(&self, _chosen: &Chosen) -> Result<(), String> {
        Ok(())
    }

    /// Install `bytes`, the verified artifact of `chosen`, and restart into it. Returns `Ok` only
    /// when the restart is under way.
    fn install(&self, chosen: &Chosen, bytes: &[u8]) -> Result<(), String>;
}

/// What the app tells the updater about itself.
#[derive(Debug, Clone)]
pub struct Config {
    /// The release origin, such as `https://releases.endue.ai/desk`.
    pub base: String,
    /// The updater's minisign public key, base64 as Tauri writes it.
    pub pubkey: String,
    /// The running build's version and commit.
    pub version: String,
    pub commit: Option<String>,
    /// This desk's targets, most specific first: `linux-x86_64-deb`, then `linux-x86_64`.
    pub targets: Vec<String>,
    /// The updates folder, `<data>/updates`.
    pub dir: std::path::PathBuf,
}

/// The person's update settings (`desk.update.*`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Prefs {
    pub channel: Channel,
    /// Download a chosen build without asking.
    pub auto: bool,
    /// Check by the schedule; a person's `check` runs either way.
    pub check: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            channel: Channel::Stable,
            auto: true,
            check: true,
        }
    }
}
