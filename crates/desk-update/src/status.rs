//! What the updater reports: the state, the running build, the channel and the build it chose. The
//! core maps a `Status` onto the bridge's `UpdateStatus` (`specs/bridge/v0/update.schema.json`).

use serde::{Deserialize, Serialize};

/// Which channel index a desk follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Channel {
    #[default]
    Stable,
    Beta,
    Canary,
}

impl Channel {
    pub fn name(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
            Self::Canary => "canary",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "stable" => Some(Self::Stable),
            "beta" => Some(Self::Beta),
            "canary" => Some(Self::Canary),
            _ => None,
        }
    }
}

/// What the updater is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Staged,
    Applying,
    Failed,
}

impl State {
    /// The bridge's name for the state.
    pub fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Checking => "checking",
            Self::UpToDate => "up-to-date",
            Self::Available => "available",
            Self::Downloading => "downloading",
            Self::Staged => "staged",
            Self::Applying => "applying",
            Self::Failed => "failed",
        }
    }
}

/// The build the desk chose: what the index and its manifest said, and where its artifact is. Kept
/// in `staged.json` once the artifact is on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chosen {
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// The target its artifact is for (`darwin-aarch64`, `linux-x86_64-deb`).
    pub target: String,
    /// The artifact's URL, its file name on disk, length, sha256 and minisign signature.
    pub url: String,
    pub file: String,
    pub size: u64,
    pub sha256: String,
    pub signature: String,
    /// The release manifest's URL: the app rebuilds its installer handle from it.
    pub release: String,
}

/// The updater's status, whole: every change is reported as one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    pub state: State,
    /// The running build.
    pub version: String,
    pub commit: Option<String>,
    pub channel: Channel,
    /// When a channel index was last read and checked, RFC 3339.
    pub checked_at: Option<String>,
    /// The build chosen: available, downloading, staged, applying, or the one a step failed for.
    pub release: Option<Chosen>,
    /// Whether `release` is verified and on disk.
    pub staged: bool,
    pub received: Option<u64>,
    pub total: Option<u64>,
    /// Why the last step failed, for people.
    pub reason: Option<String>,
}

impl Status {
    pub(crate) fn new(version: &str, commit: Option<String>, channel: Channel) -> Self {
        Self {
            state: State::Idle,
            version: version.to_owned(),
            commit,
            channel,
            checked_at: None,
            release: None,
            staged: false,
            received: None,
            total: None,
            reason: None,
        }
    }

    /// The same status in `state`, about `release`, with the progress and reason cleared.
    pub(crate) fn at(&self, state: State, release: Option<Chosen>, staged: bool) -> Self {
        Self {
            state,
            release,
            staged,
            received: None,
            total: None,
            reason: None,
            ..self.clone()
        }
    }
}
