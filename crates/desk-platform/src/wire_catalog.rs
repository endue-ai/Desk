//! The catalog's and ai-agent-service's bodies (specs/platform/v0), read as tolerantly as `wire`.

use serde::Deserialize;

use crate::wire::nullable;

/// `CatalogL10n`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct L10n {
    #[serde(default, deserialize_with = "nullable")]
    pub en: String,
    #[serde(default, deserialize_with = "nullable")]
    pub ko: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ConnectorRef {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct UseCase {
    #[serde(default, deserialize_with = "nullable")]
    pub title: L10n,
    #[serde(default, deserialize_with = "nullable")]
    pub example: L10n,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct CatalogIdentity {
    #[serde(default, deserialize_with = "nullable")]
    pub name: String,
    #[serde(default, deserialize_with = "nullable")]
    pub role: L10n,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub personal_color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct Preset {
    #[serde(default, deserialize_with = "nullable")]
    pub traits: Vec<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub skills: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
}

/// `PublicCatalogManifest`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct Manifest {
    #[serde(default, deserialize_with = "nullable")]
    pub identity: CatalogIdentity,
    #[serde(default, deserialize_with = "nullable")]
    pub tagline: L10n,
    #[serde(default, deserialize_with = "nullable")]
    pub description: L10n,
    #[serde(default, deserialize_with = "nullable")]
    pub strengths: Vec<L10n>,
    #[serde(default, deserialize_with = "nullable")]
    pub use_cases: Vec<UseCase>,
    #[serde(default, deserialize_with = "nullable")]
    pub connectors: Vec<ConnectorRef>,
    #[serde(default, deserialize_with = "nullable")]
    pub channels: Vec<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub preset: Preset,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Publisher {
    pub kind: String,
    #[serde(default, deserialize_with = "nullable")]
    pub name: String,
}

/// `CatalogAgent`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CatalogAgent {
    pub id: String,
    pub slug: String,
    #[serde(default, deserialize_with = "nullable")]
    pub category: String,
    #[serde(default, deserialize_with = "nullable")]
    pub tags: Vec<String>,
    #[serde(default)]
    pub featured: bool,
    pub publisher: Publisher,
    pub version: u64,
    #[serde(default, deserialize_with = "nullable")]
    pub manifest: Manifest,
    #[serde(default)]
    pub published_at: Option<String>,
}

/// What `studio.catalog.list` narrows the catalog by.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CatalogQuery {
    pub q: Option<String>,
    pub category: Option<String>,
    pub limit: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Recommendation {
    pub slug: String,
    #[serde(default, deserialize_with = "nullable")]
    pub reason: String,
}

/// `RecommendCatalogResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Recommended {
    #[serde(default, deserialize_with = "nullable")]
    pub matches: Vec<Recommendation>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CatalogRef {
    pub id: String,
    pub slug: String,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct Applied {
    #[serde(default)]
    pub prompt: bool,
    #[serde(default, deserialize_with = "nullable")]
    pub traits: Vec<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub skills: Vec<String>,
    #[serde(default)]
    pub model: bool,
}

/// `CatalogUseWarning`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct UseWarning {
    pub step: String,
    pub code: String,
    #[serde(default)]
    pub target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct NextSteps {
    #[serde(default, deserialize_with = "nullable")]
    pub connectors: Vec<ConnectorRef>,
    #[serde(default, deserialize_with = "nullable")]
    pub channels: Vec<String>,
}

/// `UseCatalogAgentResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Used {
    pub agent_id: String,
    pub catalog: CatalogRef,
    #[serde(default, deserialize_with = "nullable")]
    pub applied: Applied,
    #[serde(default, deserialize_with = "nullable")]
    pub warnings: Vec<UseWarning>,
    #[serde(default, deserialize_with = "nullable")]
    pub recommended: NextSteps,
}

/// `ConversationResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub agent_id: String,
    #[serde(default)]
    pub space_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub status: String,
    #[serde(default)]
    pub message_count: u64,
    #[serde(default)]
    pub last_message_at: Option<String>,
    #[serde(default)]
    pub last_read_at: Option<String>,
    #[serde(default)]
    pub pinned_at: Option<String>,
    #[serde(default)]
    pub last_run_status: Option<String>,
    #[serde(default)]
    pub awaiting_input: Option<bool>,
    #[serde(default)]
    pub last_message_preview: Option<String>,
    #[serde(default)]
    pub current_tool: Option<String>,
    #[serde(default)]
    pub last_run_error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// `ConversationList`: one page, and how many match in all.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ConversationPage {
    #[serde(default, deserialize_with = "nullable")]
    pub items: Vec<Conversation>,
    #[serde(default)]
    pub total: u64,
}

/// What `studio.conversations.list` asks for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConversationQuery {
    pub agent_id: Option<String>,
    pub awaiting_input: Option<bool>,
    pub running: Option<bool>,
    pub page: Option<u64>,
    pub limit: Option<u64>,
}
