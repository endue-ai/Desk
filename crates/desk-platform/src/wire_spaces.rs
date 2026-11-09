//! The spaces' bodies (specs/platform/v0, tag `spaces`), read as tolerantly as the agents': unknown
//! fields are ignored and `null` reads as absent. Statuses stay text, so a status endue AI adds
//! later reads instead of failing the whole answer; the core decides what each one means. Who is in
//! a room, the viewer's capabilities and the attention items' reasons are not read at all.

use serde::Deserialize;
use serde::de::IgnoredAny;

use crate::wire::nullable;

/// `SpaceLatestResult`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct LatestResult {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub title: String,
    pub updated_at: String,
}

/// `SpaceSummary`: only a space the person owns has one.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SpaceSummary {
    #[serde(default, deserialize_with = "nullable")]
    pub active_work_items: u64,
    #[serde(default, deserialize_with = "nullable")]
    pub open_attention_items: u64,
    #[serde(default)]
    pub latest_result: Option<LatestResult>,
    #[serde(default)]
    pub last_activity_at: Option<String>,
}

/// `SpaceGetResponse`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Space {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub key: String,
    #[serde(default, deserialize_with = "nullable")]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub goal: Option<String>,
    /// active, archived or deleted; absent on a platform that predates it (active).
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub front_agent_id: Option<String>,
    #[serde(default)]
    pub avatar_color: Option<String>,
    #[serde(default)]
    pub avatar_glyph: Option<String>,
    #[serde(default)]
    pub summary: Option<SpaceSummary>,
    pub created_at: String,
    pub updated_at: String,
}

/// `SpaceCounts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct SpaceCounts {
    #[serde(default, deserialize_with = "nullable")]
    pub active_work_items: u64,
    #[serde(default, deserialize_with = "nullable")]
    pub open_attention_items: u64,
    #[serde(default, deserialize_with = "nullable")]
    pub results: u64,
}

/// `SpaceAgentView`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SpaceAgent {
    pub id: String,
    pub agent_id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub role_key: String,
    #[serde(default, deserialize_with = "nullable")]
    pub is_front: bool,
    /// admin or participant; endue AI derives it from `is_front` where it keeps none.
    #[serde(default)]
    pub permission: Option<String>,
    /// active, or removed: the agent left the space.
    #[serde(default, deserialize_with = "nullable")]
    pub status: String,
}

/// `WorkItemSummary`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct WorkItem {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub title: String,
    #[serde(default, deserialize_with = "nullable")]
    pub display_status: String,
    pub updated_at: String,
}

/// `WorkResultSummary`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct WorkResult {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub title: String,
    #[serde(default)]
    pub kind: Option<String>,
    pub updated_at: String,
}

/// `SpaceOverview`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SpaceOverview {
    pub counts: SpaceCounts,
    #[serde(default, deserialize_with = "nullable")]
    pub agents: Vec<SpaceAgent>,
    #[serde(default, deserialize_with = "nullable")]
    pub active_work_items: Vec<WorkItem>,
    #[serde(default, deserialize_with = "nullable")]
    pub recent_results: Vec<WorkResult>,
}

/// `SpaceRoomThreads`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct RoomThreads {
    #[serde(default, deserialize_with = "nullable")]
    pub active: u64,
    #[serde(default, deserialize_with = "nullable")]
    pub needs_you: u64,
    #[serde(default, deserialize_with = "nullable")]
    pub unread: u64,
}

/// `SpaceRoomView`, without its members.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Room {
    pub id: String,
    #[serde(default, deserialize_with = "nullable")]
    pub name: String,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub status: String,
    #[serde(default, deserialize_with = "nullable")]
    pub unread_count: u64,
    #[serde(default)]
    pub last_message_at: Option<String>,
    /// Present while a discussion goes on; what it holds is not read.
    #[serde(default)]
    pub active_discussion: Option<IgnoredAny>,
    #[serde(default)]
    pub threads: Option<RoomThreads>,
}
