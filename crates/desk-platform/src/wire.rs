//! The platform's bodies as specs/platform/v0/openapi.yaml writes them: snake_case, read tolerantly
//! (unknown fields are ignored, `null` reads as absent or empty) so endue AI can add fields freely.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// `null` or a missing field as the type's default.
pub(crate) fn nullable<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Active,
    Inactive,
    Archived,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceCatalog {
    pub catalog_agent_id: String,
    pub version: u64,
}

/// `AgentGetResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Agent {
    pub id: String,
    pub slug: String,
    #[serde(default, deserialize_with = "nullable")]
    pub name: String,
    pub status: AgentStatus,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub personal_color: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub source_catalog: Option<SourceCatalog>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Pagination {
    pub total: u64,
    pub page: u64,
    pub limit: u64,
    pub has_next_page: bool,
}

/// `AgentGetListResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct AgentPage {
    #[serde(default, deserialize_with = "nullable")]
    pub items: Vec<Agent>,
    pub pagination: Pagination,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NatureRole {
    pub v: String,
    #[serde(default, deserialize_with = "nullable")]
    pub prompts: Vec<String>,
}

impl NatureRole {
    /// The role in words, as endue.ai keeps it: one prompt.
    pub fn of(role: &str) -> Self {
        Self {
            v: "1.0".to_owned(),
            prompts: vec![role.to_owned()],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Personality {
    pub v: String,
    pub tone: f64,
    pub agency: f64,
    pub thinking: f64,
    pub rigor: f64,
    pub expression: f64,
    pub humor: f64,
    pub integrity: f64,
    pub epistemic_humility: f64,
}

impl Default for Personality {
    /// endue.ai's defaults for an agent built from scratch.
    fn default() -> Self {
        Self {
            v: "1.0".to_owned(),
            tone: 0.7,
            agency: 0.3,
            thinking: 0.2,
            rigor: 0.85,
            expression: 0.7,
            humor: 0.15,
            integrity: 0.85,
            epistemic_humility: 0.65,
        }
    }
}

/// The nature of `CreateAgentRequest` and `PatchNatureRequest`, and `NatureResponse`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Nature {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<NatureRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personality: Option<Personality>,
    #[serde(
        default,
        deserialize_with = "nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub languages: Option<Vec<String>>,
}

/// The profile of `CreateAgentRequest` and `UpdateProfileRequest`, and `ProfileResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Profile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub personal_color: Option<String>,
}

/// `CreateAgentRequest`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NewAgent {
    pub nature: Nature,
    pub profile: Profile,
}

/// `UpdateAgentRequest`: nature, profile or both.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct AgentPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nature: Option<Nature>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
}

impl AgentPatch {
    pub fn is_empty(&self) -> bool {
        self.nature.is_none() && self.profile.is_none()
    }
}

/// `IdentityResponse`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Identity {
    #[serde(default)]
    pub nature: Nature,
    #[serde(default)]
    pub profile: Profile,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct ModelPreference {
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub fallback: Option<String>,
    #[serde(default)]
    pub routing: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct Models {
    #[serde(default, deserialize_with = "nullable")]
    pub chat: ModelPreference,
}

/// `AgentSettingsResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Settings {
    pub visibility: String,
    #[serde(default)]
    pub chat_history_retention: Option<u64>,
    #[serde(default, deserialize_with = "nullable")]
    pub disabled_tool_groups: Vec<String>,
    #[serde(default)]
    pub available_tool_groups: Option<Vec<String>>,
    #[serde(default, deserialize_with = "nullable")]
    pub models: Models,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// `AgentSettingsUpdateRequest`: `model` sets the chat model (`None` inside clears it).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SettingsPatch {
    pub visibility: Option<String>,
    pub model: Option<Option<String>>,
}

impl SettingsPatch {
    pub fn is_empty(&self) -> bool {
        self.visibility.is_none() && self.model.is_none()
    }

    /// The `AgentSettingsUpdateRequest` this patch sends.
    pub fn body(&self) -> Value {
        let mut body = Map::new();
        if let Some(visibility) = &self.visibility {
            body.insert("visibility".into(), Value::from(visibility.as_str()));
        }
        if let Some(model) = &self.model {
            let chat = serde_json::json!({ "default": model });
            body.insert("models".into(), serde_json::json!({ "chat": chat }));
        }
        Value::Object(body)
    }
}

/// `PromptRevision`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PromptRevision {
    pub rev: u64,
    #[serde(default, deserialize_with = "nullable")]
    pub content: String,
    pub source: String,
    #[serde(default)]
    pub restored_from_rev: Option<u64>,
    pub created_at: String,
}

/// `PromptRevisionSummary`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct RevisionSummary {
    pub rev: u64,
    pub source: String,
    #[serde(default)]
    pub restored_from_rev: Option<u64>,
    #[serde(default, deserialize_with = "nullable")]
    pub preview: String,
    pub created_at: String,
    #[serde(default)]
    pub active: bool,
}

/// `AgentSkillBinding`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SkillBinding {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub skill_id: String,
    #[serde(default)]
    pub skill_slug: Option<String>,
    #[serde(default)]
    pub skill_name: Option<String>,
    #[serde(default)]
    pub registry_skill_id: Option<String>,
    #[serde(default)]
    pub connection_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct BoundConnection {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
pub struct BoundConnectionType {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
}

/// `AgentConnectorBinding`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ConnectorBinding {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub connection_id: String,
    pub enabled: bool,
    #[serde(default)]
    pub connection: Option<BoundConnection>,
    #[serde(default)]
    pub connection_type: Option<BoundConnectionType>,
}

/// `AgentTrait`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Trait {
    pub trait_key: String,
    pub enabled: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
}
