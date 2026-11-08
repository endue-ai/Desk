//! The platform's agents and facets (snake_case, desk-platform's `wire`) in the bridge's studio.*
//! shapes (camelCase, specs/bridge/v0/studio.schema.json). A value the bridge has no word for falls
//! back to the nearest one it has, so one odd field never fails a whole answer.

use desk_bridge::{
    StudioAgent, StudioAgentStatus, StudioConnector, StudioIdentity, StudioModel,
    StudioPersonality, StudioPrompt, StudioPromptRevision, StudioPromptSource, StudioRouting,
    StudioSettings, StudioSkill, StudioSourceCatalog, StudioTrait, StudioVisibility,
};
use desk_platform::wire::{
    Agent, AgentStatus, ConnectorBinding, Identity, Personality, PromptRevision, RevisionSummary,
    Settings, SkillBinding, Trait,
};

/// Text kept to at most `max` characters, as the bridge's limits say.
pub(crate) fn cut(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

pub(crate) fn agent(agent: Agent) -> StudioAgent {
    let status = match agent.status {
        AgentStatus::Active => StudioAgentStatus::Active,
        AgentStatus::Inactive => StudioAgentStatus::Inactive,
        AgentStatus::Archived => StudioAgentStatus::Archived,
        AgentStatus::Deleted => StudioAgentStatus::Deleted,
    };
    StudioAgent {
        id: agent.id,
        slug: agent.slug,
        name: cut(&agent.name, 100),
        status,
        avatar_url: agent.avatar_url.filter(|u| !u.is_empty()),
        personal_color: agent.personal_color.filter(|c| !c.is_empty()),
        region: agent.region.filter(|r| !r.is_empty()),
        source_catalog: agent.source_catalog.map(|s| StudioSourceCatalog {
            catalog_agent_id: s.catalog_agent_id,
            version: s.version.max(1),
        }),
        created_at: agent.created_at,
        updated_at: agent.updated_at,
    }
}

pub(crate) fn personality(p: Personality) -> StudioPersonality {
    let unit = |v: f64| v.clamp(0.0, 1.0);
    StudioPersonality {
        tone: unit(p.tone),
        agency: unit(p.agency),
        thinking: unit(p.thinking),
        rigor: unit(p.rigor),
        expression: unit(p.expression),
        humor: unit(p.humor),
        integrity: unit(p.integrity),
        epistemic_humility: unit(p.epistemic_humility),
    }
}

/// The bridge's personality as the platform's, with endue.ai's version tag.
pub(crate) fn wire_personality(p: &StudioPersonality) -> Personality {
    Personality {
        v: Personality::default().v,
        tone: p.tone,
        agency: p.agency,
        thinking: p.thinking,
        rigor: p.rigor,
        expression: p.expression,
        humor: p.humor,
        integrity: p.integrity,
        epistemic_humility: p.epistemic_humility,
    }
}

pub(crate) fn identity(identity: Identity) -> StudioIdentity {
    let (nature, profile) = (identity.nature, identity.profile);
    let role = nature
        .role
        .and_then(|r| r.prompts.into_iter().find(|p| !p.trim().is_empty()))
        .unwrap_or_default();
    StudioIdentity {
        name: cut(&profile.name.unwrap_or_default(), 100),
        description: profile
            .description
            .filter(|d| !d.is_empty())
            .map(|d| cut(&d, 2000)),
        avatar_url: profile.avatar_url.filter(|u| !u.is_empty()),
        personal_color: profile.personal_color.filter(|c| !c.is_empty()),
        role: cut(&role, 2000),
        languages: nature.languages.unwrap_or_default(),
        personality: nature.personality.map(personality),
    }
}

pub(crate) fn visibility(text: &str) -> StudioVisibility {
    match text {
        "public" => StudioVisibility::Public,
        "unlisted" => StudioVisibility::Unlisted,
        _ => StudioVisibility::Private,
    }
}

pub(crate) fn settings(settings: Settings) -> StudioSettings {
    let chat = settings.models.chat;
    let routing = chat.routing.as_deref().and_then(|r| match r {
        "balanced" => Some(StudioRouting::Balanced),
        "throughput" => Some(StudioRouting::Throughput),
        _ => None,
    });
    StudioSettings {
        visibility: visibility(&settings.visibility),
        chat_history_retention: settings.chat_history_retention,
        model: StudioModel {
            default: chat.default.filter(|m| !m.is_empty()),
            fallback: chat.fallback.filter(|m| !m.is_empty()),
            routing,
        },
        disabled_tool_groups: settings.disabled_tool_groups,
        available_tool_groups: settings.available_tool_groups,
        updated_at: settings.updated_at,
    }
}

fn source(text: &str) -> StudioPromptSource {
    match text {
        "migrated" => StudioPromptSource::Migrated,
        "restore" => StudioPromptSource::Restore,
        _ => StudioPromptSource::Manual,
    }
}

pub(crate) fn prompt(revision: PromptRevision) -> StudioPrompt {
    StudioPrompt {
        rev: revision.rev.max(1),
        content: cut(&revision.content, 20_000),
        source: source(&revision.source),
        restored_from_rev: revision.restored_from_rev,
        created_at: revision.created_at,
    }
}

pub(crate) fn revision(summary: RevisionSummary) -> StudioPromptRevision {
    StudioPromptRevision {
        rev: summary.rev.max(1),
        source: source(&summary.source),
        restored_from_rev: summary.restored_from_rev,
        preview: cut(&summary.preview, 200),
        created_at: summary.created_at,
        active: summary.active,
    }
}

pub(crate) fn skill(binding: SkillBinding) -> StudioSkill {
    StudioSkill {
        id: binding.id,
        skill_id: binding.skill_id,
        slug: binding.skill_slug,
        name: binding.skill_name,
        registry_skill_id: binding.registry_skill_id,
        enabled: binding.enabled,
    }
}

pub(crate) fn connector(binding: ConnectorBinding) -> StudioConnector {
    let connection = binding.connection.unwrap_or_default();
    let kind = binding.connection_type.unwrap_or_default();
    StudioConnector {
        id: binding.id,
        connection_id: binding.connection_id,
        enabled: binding.enabled,
        name: connection.display_name,
        r#type: kind.name,
        icon_url: kind.icon_url,
        status: connection.status,
    }
}

pub(crate) fn trait_of(t: Trait) -> StudioTrait {
    StudioTrait {
        key: t.trait_key,
        enabled: t.enabled,
        updated_at: t.updated_at,
    }
}
