//! studio.agents.facets, studio.agents.prompt.update, studio.catalog.* and studio.conversations.list
//! (ADR 0122). Facets, the board's rows among them (ADR 0232), are read side by side, each on its
//! own thread, and one endue AI does not answer for is named in `problems` instead of failing the
//! call.

use std::thread;

use desk_bridge::{
    StudioAgentParams, StudioAgentsFacetsResult, StudioAgentsPromptUpdateParams,
    StudioAgentsPromptUpdateResult, StudioCatalogListParams, StudioCatalogListResult,
    StudioCatalogRecommendParams, StudioCatalogRecommendResult, StudioCatalogUseParams,
    StudioCatalogUseResult, StudioConversationsListParams, StudioConversationsListResult,
    StudioFacet, StudioFacetProblem,
};
use desk_platform::wire_catalog::{CatalogQuery, ConversationQuery};
use desk_platform::{MEMORIES, Result as Platform};

use super::{map, map_catalog, rows};
use crate::core_studio::{failed, invalid, words};
use crate::handler::{Answer, Core, json};

/// Revisions Studio lists.
const REVISIONS: u64 = 50;
/// Conversations a page unless the caller says.
const CONVERSATIONS: u64 = 20;

/// A facet's answer, or its problem.
fn keep<T>(
    facet: StudioFacet,
    answer: Platform<T>,
    problems: &mut Vec<StudioFacetProblem>,
) -> Option<T> {
    match answer {
        Ok(value) => Some(value),
        Err(e) => {
            let error = failed(e);
            problems.push(StudioFacetProblem {
                facet,
                code: error.code,
                message: map::cut(&error.message, 2000),
            });
            None
        }
    }
}

/// A facet thread's answer; one that panicked is a failure like any other.
pub(super) fn joined<T>(handle: thread::ScopedJoinHandle<'_, Platform<T>>) -> Platform<T> {
    handle.join().unwrap_or_else(|_| {
        let why = "the desk could not wait for endue AI";
        Err(desk_platform::PlatformError::new(
            desk_platform::ErrorKind::Failed,
            why,
        ))
    })
}

impl Core {
    pub(crate) fn studio_agents_facets(&self, caller: &str, params: StudioAgentParams) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let id = params.agent_id.as_str();
        let agent = platform.get_agent(id).map_err(failed)?;
        let p = platform.as_ref();
        let (studio, board) = thread::scope(|s| {
            let identity = s.spawn(|| p.identity(id));
            let settings = s.spawn(|| p.settings(id));
            let prompt = s.spawn(|| p.prompt(id));
            let revisions = s.spawn(|| p.prompt_revisions(id, REVISIONS));
            let skills = s.spawn(|| p.skills(id));
            let connectors = s.spawn(|| p.connectors(id));
            let traits = s.spawn(|| p.traits(id));
            let channels = s.spawn(|| p.channel_pairings(id));
            let keys = s.spawn(|| p.api_keys());
            let attached = s.spawn(|| p.os_devices(id));
            let workspaces = s.spawn(|| p.workspaces(id));
            let memories = s.spawn(|| p.memories(id, MEMORIES));
            let outputs = s.spawn(|| p.outputs(id));
            let theme = s.spawn(|| p.theme(id));
            let (attached, workspaces) = (joined(attached), joined(workspaces));
            let studio = (
                joined(identity),
                joined(settings),
                joined(prompt),
                joined(revisions),
                joined(skills),
                joined(connectors),
                joined(traits),
            );
            let board = (
                joined(channels),
                joined(keys),
                attached.and_then(|a| workspaces.map(|w| (a, w))),
                joined(memories),
                joined(outputs),
                joined(theme),
            );
            (studio, board)
        });
        let (identity, settings, prompt, revisions, skills, connectors, traits) = studio;
        let (channels, keys, devices, memory, outputs, theme) = board;
        let mut problems = Vec::new();
        let problems = &mut problems;
        let result = StudioAgentsFacetsResult {
            agent: map::agent(agent),
            identity: keep(StudioFacet::Identity, identity, problems).map(map::identity),
            settings: keep(StudioFacet::Settings, settings, problems).map(map::settings),
            prompt: keep(StudioFacet::Prompt, prompt, problems)
                .flatten()
                .map(map::prompt),
            revisions: keep(StudioFacet::Revisions, revisions, problems)
                .unwrap_or_default()
                .into_iter()
                .map(map::revision)
                .collect(),
            skills: keep(StudioFacet::Skills, skills, problems)
                .unwrap_or_default()
                .into_iter()
                .map(map::skill)
                .collect(),
            connectors: keep(StudioFacet::Connectors, connectors, problems)
                .unwrap_or_default()
                .into_iter()
                .map(map::connector)
                .collect(),
            traits: keep(StudioFacet::Traits, traits, problems)
                .unwrap_or_default()
                .into_iter()
                .map(map::trait_of)
                .collect(),
            channels: keep(StudioFacet::Channels, channels, problems)
                .unwrap_or_default()
                .into_iter()
                .map(rows::channel)
                .collect(),
            api_keys: rows::api_keys(
                keep(StudioFacet::ApiKeys, keys, problems).unwrap_or_default(),
                id,
            ),
            devices: keep(StudioFacet::Devices, devices, problems)
                .map(|(attached, workspaces)| rows::devices(attached, workspaces))
                .unwrap_or_default(),
            memory: keep(StudioFacet::Memory, memory, problems).map(rows::memory),
            outputs: keep(StudioFacet::Outputs, outputs, problems).map(rows::outputs),
            theme: keep(StudioFacet::Theme, theme, problems).map(rows::theme),
            problems: std::mem::take(problems),
        };
        json(result)
    }

    pub(crate) fn studio_prompt_update(
        &self,
        caller: &str,
        params: StudioAgentsPromptUpdateParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let id = params.agent_id.as_str();
        let revision = match (params.content, params.restore) {
            (Some(content), None) => {
                if content.trim().is_empty() || content.chars().count() > 20_000 {
                    return Err(invalid("content must be 1 to 20000 characters"));
                }
                platform.save_prompt(id, &content)
            }
            (None, Some(rev)) if rev >= 1 => platform.restore_prompt(id, rev),
            _ => {
                return Err(invalid(
                    "give the prompt's content or a revision to restore, not both",
                ));
            }
        };
        json(StudioAgentsPromptUpdateResult {
            prompt: map::prompt(revision.map_err(failed)?),
        })
    }

    pub(crate) fn studio_catalog_list(
        &self,
        caller: &str,
        params: StudioCatalogListParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let query = CatalogQuery {
            q: params.query.filter(|q| !q.trim().is_empty()),
            category: params.category.filter(|c| !c.is_empty()),
            limit: Some(params.limit.unwrap_or(100).clamp(1, 100)),
        };
        let agents = platform.catalog(&query).map_err(failed)?;
        json(StudioCatalogListResult {
            agents: agents.into_iter().map(map_catalog::catalog_agent).collect(),
        })
    }

    pub(crate) fn studio_catalog_recommend(
        &self,
        caller: &str,
        params: StudioCatalogRecommendParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let query = words(&params.query, "query", 500)?;
        let locale = params.locale.unwrap_or_else(|| "en".to_owned());
        let answer = platform.recommend(&query, &locale).map_err(failed)?;
        let (matches, source) = map_catalog::recommendations(answer.matches, &answer.source);
        json(StudioCatalogRecommendResult { matches, source })
    }

    pub(crate) fn studio_catalog_use(
        &self,
        caller: &str,
        params: StudioCatalogUseParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let locale = params.locale.unwrap_or_else(|| "en".to_owned());
        let used = platform
            .use_catalog(&params.slug, &locale)
            .map_err(failed)?;
        let agent = platform.get_agent(&used.agent_id).map_err(failed)?;
        json(StudioCatalogUseResult {
            agent: map::agent(agent),
            catalog: map_catalog::catalog_ref(used.catalog),
            applied: map_catalog::applied(used.applied),
            warnings: used
                .warnings
                .into_iter()
                .map(map_catalog::warning)
                .collect(),
            recommended: map_catalog::next_steps(used.recommended),
        })
    }

    pub(crate) fn studio_conversations_list(
        &self,
        caller: &str,
        params: StudioConversationsListParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let page = params.page.unwrap_or(1).max(1);
        let limit = params.limit.unwrap_or(CONVERSATIONS).clamp(1, 100);
        let query = ConversationQuery {
            agent_id: params.agent_id,
            awaiting_input: params.awaiting_input,
            running: params.running,
            page: Some(page),
            limit: Some(limit),
        };
        let answer = platform.conversations(&query).map_err(failed)?;
        json(StudioConversationsListResult {
            has_more: page.saturating_mul(limit) < answer.total,
            total: answer.total,
            conversations: answer
                .items
                .into_iter()
                .map(map_catalog::conversation)
                .collect(),
        })
    }
}
