//! The catalog's agents and the Home board's conversations in the bridge's studio.* shapes, as
//! `map` does for agents.

use desk_bridge::{
    StudioActivity, StudioApplied, StudioCatalogAgent, StudioCatalogRef, StudioConnectorRef,
    StudioConversation, StudioConversationStatus, StudioPreset, StudioPublisher,
    StudioPublisherKind, StudioRecommendSource, StudioRecommendation, StudioRecommended,
    StudioRunStatus, StudioText, StudioUseCase, StudioWarning, StudioWarningStep,
};
use desk_platform::wire_catalog::{
    Applied, CatalogAgent, ConnectorRef, Conversation, L10n, NextSteps, UseWarning,
};

use super::map::cut;

fn text(l10n: L10n) -> StudioText {
    StudioText {
        en: cut(&l10n.en, 4000),
        ko: cut(&l10n.ko, 4000),
    }
}

fn connector_ref(c: ConnectorRef) -> StudioConnectorRef {
    StudioConnectorRef {
        r#type: c.kind,
        required: c.required,
    }
}

/// A catalog agent, its manifest's identity lifted beside the rest.
pub(crate) fn catalog_agent(agent: CatalogAgent) -> StudioCatalogAgent {
    let manifest = agent.manifest;
    let identity = manifest.identity;
    let kind = match agent.publisher.kind.as_str() {
        "official" => StudioPublisherKind::Official,
        _ => StudioPublisherKind::User,
    };
    StudioCatalogAgent {
        id: agent.id,
        slug: agent.slug,
        category: agent.category,
        tags: agent.tags,
        featured: agent.featured,
        publisher: StudioPublisher {
            kind,
            name: agent.publisher.name,
        },
        version: agent.version.max(1),
        name: cut(&identity.name, 100),
        role: text(identity.role),
        avatar_url: identity.avatar_url.filter(|u| !u.is_empty()),
        personal_color: identity.personal_color.filter(|c| !c.is_empty()),
        tagline: text(manifest.tagline),
        description: text(manifest.description),
        strengths: manifest.strengths.into_iter().map(text).collect(),
        use_cases: manifest
            .use_cases
            .into_iter()
            .map(|u| StudioUseCase {
                title: text(u.title),
                example: text(u.example),
            })
            .collect(),
        connectors: manifest.connectors.into_iter().map(connector_ref).collect(),
        channels: manifest.channels,
        preset: StudioPreset {
            traits: manifest.preset.traits,
            skills: manifest.preset.skills,
            model: manifest.preset.model.filter(|m| !m.is_empty()),
        },
        published_at: agent.published_at,
    }
}

/// Recommendations whose slug the bridge can carry, best first.
pub(crate) fn recommendations(
    matches: Vec<desk_platform::wire_catalog::Recommendation>,
    source: &str,
) -> (Vec<StudioRecommendation>, StudioRecommendSource) {
    let slug = |s: &str| {
        !s.is_empty()
            && s.len() <= 64
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !s.starts_with('-')
    };
    let matches = matches
        .into_iter()
        .filter(|m| slug(&m.slug))
        .map(|m| StudioRecommendation {
            slug: m.slug,
            reason: cut(&m.reason, 1000),
        })
        .collect();
    let source = match source {
        "llm" => StudioRecommendSource::Llm,
        _ => StudioRecommendSource::Keyword,
    };
    (matches, source)
}

pub(crate) fn warning(w: UseWarning) -> StudioWarning {
    let step = match w.step.as_str() {
        "prompt" => StudioWarningStep::Prompt,
        "traits" => StudioWarningStep::Traits,
        "skills" => StudioWarningStep::Skills,
        _ => StudioWarningStep::Model,
    };
    StudioWarning {
        step,
        code: cut(&w.code, 128),
        target: w.target.filter(|t| !t.is_empty()),
    }
}

pub(crate) fn applied(a: Applied) -> StudioApplied {
    StudioApplied {
        prompt: a.prompt,
        traits: a.traits,
        skills: a.skills,
        model: a.model,
    }
}

pub(crate) fn catalog_ref(c: desk_platform::wire_catalog::CatalogRef) -> StudioCatalogRef {
    StudioCatalogRef {
        id: c.id,
        slug: c.slug,
        version: c.version.max(1),
    }
}

pub(crate) fn next_steps(n: NextSteps) -> StudioRecommended {
    StudioRecommended {
        connectors: n.connectors.into_iter().map(connector_ref).collect(),
        channels: n.channels,
    }
}

/// A conversation and its Home board column, as endue.ai's Activity board sorts it: a run going on
/// is active, a failed one failed, one stopped for the person waiting, anything else done.
pub(crate) fn conversation(c: Conversation) -> StudioConversation {
    let run = c.last_run_status.as_deref().and_then(|s| match s {
        "running" => Some(StudioRunStatus::Running),
        "completed" => Some(StudioRunStatus::Completed),
        "failed" => Some(StudioRunStatus::Failed),
        _ => None,
    });
    let activity = match (run, c.awaiting_input) {
        (Some(StudioRunStatus::Running), _) => StudioActivity::Active,
        (Some(StudioRunStatus::Failed), _) => StudioActivity::Failed,
        (_, Some(true)) => StudioActivity::Waiting,
        _ => StudioActivity::Done,
    };
    let status = match c.status.as_str() {
        "archived" => StudioConversationStatus::Archived,
        "deleted" => StudioConversationStatus::Deleted,
        _ => StudioConversationStatus::Active,
    };
    let some = |s: Option<String>, max: usize| s.filter(|s| !s.is_empty()).map(|s| cut(&s, max));
    StudioConversation {
        id: c.id,
        agent_id: c.agent_id,
        space_id: some(c.space_id, 128),
        title: some(c.title, 500),
        status,
        message_count: c.message_count,
        last_message_at: c.last_message_at,
        last_read_at: c.last_read_at,
        pinned_at: c.pinned_at,
        last_run_status: run,
        awaiting_input: c.awaiting_input,
        last_message_preview: some(c.last_message_preview, 500),
        current_tool: some(
            c.current_tool
                .filter(|_| run == Some(StudioRunStatus::Running)),
            200,
        ),
        last_run_error_code: some(c.last_run_error_code, 128),
        activity,
        created_at: c.created_at,
        updated_at: c.updated_at,
    }
}
