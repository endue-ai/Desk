//! The bodies of what Studio's board reads beyond agent-service's Studio facets (ADR 0232), as
//! specs/platform/v0/openapi.yaml writes them: an agent's channel pairings, endue OS devices,
//! workspaces and theme, its memories, the person's API keys, and a page of artifacts. Only what a
//! row shows is named; a memory's value, a key's prefix and scopes, and a wallpaper's manifest are
//! never read.

use serde::Deserialize;

use crate::wire::nullable;

/// `ChannelPairing`. `status` stays a word, so a status endue AI adds later fails nothing.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ChannelPairing {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub provider: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub server_name: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub status: String,
    #[serde(default)]
    pub last_active_at: Option<String>,
}

/// `ChannelPairingList`.
#[derive(Debug, Deserialize)]
pub(crate) struct ChannelPairingList {
    #[serde(default, deserialize_with = "nullable")]
    pub pairings: Vec<ChannelPairing>,
}

/// `AgentOsDevice`: `kind` is the tool it is driven with (`workspace` for a computer, `chrome`,
/// `android`); `workspace_id` names the workspace a device belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct OsDevice {
    pub device_id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub kind: String,
    #[serde(default, deserialize_with = "nullable")]
    pub alias: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

/// `AgentOsDeviceList`.
#[derive(Debug, Deserialize)]
pub(crate) struct OsDeviceList {
    #[serde(default, deserialize_with = "nullable")]
    pub devices: Vec<OsDevice>,
}

/// `AgentWorkspace`: `environment` is `linux` or `chrome`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Workspace {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub environment: String,
    #[serde(default, deserialize_with = "nullable")]
    pub name: String,
    #[serde(default, deserialize_with = "nullable")]
    pub state: String,
}

/// `AgentWorkspaceList`: a list without `workspaces` is not the contract's.
#[derive(Debug, Deserialize)]
pub(crate) struct WorkspaceList {
    pub workspaces: Vec<Workspace>,
}

/// `WallpaperSource`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct WallpaperSource {
    #[serde(default, deserialize_with = "nullable")]
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
}

/// `AgentWallpaper`, its manifest unread.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Wallpaper {
    pub source: WallpaperSource,
}

/// `AgentTheme`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct Theme {
    #[serde(default)]
    pub wallpaper: Option<Wallpaper>,
}

/// `AgentThemeState`: `supported` false keeps no theme.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct ThemeState {
    #[serde(default)]
    pub supported: Option<bool>,
    #[serde(default)]
    pub theme: Option<Theme>,
}

impl ThemeState {
    /// The wallpaper in force, when endue AI keeps themes and one is chosen.
    pub fn wallpaper(self) -> Option<WallpaperSource> {
        if self.supported == Some(false) {
            return None;
        }
        self.theme?.wallpaper.map(|w| w.source)
    }
}

/// `Memory`, as far as it is counted.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Memory {
    #[serde(default, deserialize_with = "nullable")]
    pub category: String,
    #[serde(default)]
    pub archived_at: Option<String>,
}

/// `MemoryList`: the page read, and how many there are in all.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct MemoryList {
    #[serde(default, deserialize_with = "nullable")]
    pub items: Vec<Memory>,
    #[serde(default)]
    pub total: Option<u64>,
}

/// `ApiKey`, without its prefix and scopes.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ApiKey {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// `ApiKeyList`.
#[derive(Debug, Deserialize)]
pub(crate) struct ApiKeyList {
    #[serde(default, deserialize_with = "nullable")]
    pub items: Vec<ApiKey>,
}

/// One row of `ArtifactListEnvelope`.
#[derive(Debug, Deserialize)]
pub(crate) struct Artifact {
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ArtifactPagination {
    #[serde(default)]
    pub total: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct ArtifactMeta {
    #[serde(default)]
    pub pagination: Option<ArtifactPagination>,
}

/// `ArtifactListEnvelope`, read whole: its rows and its pagination.
#[derive(Debug, Deserialize)]
pub(crate) struct ArtifactListEnvelope {
    #[serde(default, deserialize_with = "nullable")]
    pub data: Vec<Artifact>,
    #[serde(default)]
    pub meta: Option<ArtifactMeta>,
}

/// What an agent made: how many in all, and when the newest changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outputs {
    pub total: u64,
    pub latest_at: Option<String>,
}
