//! What Eris knows when she thinks, and what she keeps after (ADR 0096). Before a brain.say turn
//! the core gathers its context, the same shape for every brain (`specs/brain/v0` `TurnContext`):
//! the facts memory finds for the line, her newest episodes, and what is open on the desk. After a
//! turn that ended in words it keeps the turn as an episode. Her `desk-remember` tool keeps a fact
//! through memory.remember, which ADR 0078's approval holds for the person (core_memory.rs).

use desk_brain::{ContextEpisode, ContextFact, ToolDefinition, TurnContext, WorkingContext};
use desk_bridge::{BridgeRequest, MemoryEntry, MemoryKind, MemoryStep, PluginStatus};
use serde_json::{Value, json};

use crate::agent_tools::ERIS;
use crate::agents::agent_caller;
use crate::handler::Core;
use crate::time::rfc3339_millis;

/// The tool Eris keeps a fact with.
pub(crate) const DESK_REMEMBER: &str = "desk-remember";
/// The most facts a turn carries, and how many episodes and commands.
const FACTS: usize = 8;
const EPISODES: usize = 3;
const COMMANDS: usize = 5;
const SURFACES: usize = 32;

impl Core {
    /// The context of a turn on `line`; none on a desk that keeps no memory and has nothing open.
    pub(crate) fn turn_context(&self, line: &str) -> Option<TurnContext> {
        let (facts, episodes) = self.memory().map_or((None, None), |memory| {
            // Every fact while there are few; past that, those that bear on the line.
            let all = memory.list(Some(MemoryKind::Fact), FACTS + 1, None).ok();
            let facts = match all {
                Some(page) if page.entries.len() <= FACTS => page.entries,
                _ => memory
                    .search(line, Some(MemoryKind::Fact), FACTS)
                    .map(|hits| hits.into_iter().map(|hit| hit.entry).collect())
                    .unwrap_or_default(),
            };
            let episodes = memory
                .list(Some(MemoryKind::Episode), EPISODES, None)
                .map(|page| page.entries)
                .unwrap_or_default();
            (Some(facts), Some(episodes))
        });
        let facts: Vec<ContextFact> = facts
            .unwrap_or_default()
            .into_iter()
            .filter_map(|entry| match entry {
                MemoryEntry::MemoryFact(fact) => Some(ContextFact {
                    id: fact.id,
                    text: fact.text,
                }),
                MemoryEntry::MemoryEpisode(_) => None,
            })
            .collect();
        let episodes: Vec<ContextEpisode> = episodes
            .unwrap_or_default()
            .into_iter()
            .filter_map(|entry| match entry {
                MemoryEntry::MemoryEpisode(episode) => Some(ContextEpisode {
                    at: episode.at,
                    asked: episode.asked,
                    answered: episode.answered,
                }),
                MemoryEntry::MemoryFact(_) => None,
            })
            .collect();
        let surfaces: Vec<String> = self
            .plugins()
            .into_iter()
            .filter(|p| p.enabled && p.status == PluginStatus::Ready)
            .filter_map(|p| {
                p.manifest
                    .filter(|m| m.surfaces.is_some())
                    .and_then(|m| m.name)
            })
            .take(SURFACES)
            .collect();
        let commands = self.recent_commands(COMMANDS);
        Some(TurnContext {
            facts: (!facts.is_empty()).then_some(facts),
            episodes: (!episodes.is_empty()).then_some(episodes),
            working: Some(WorkingContext {
                now: rfc3339_millis(std::time::SystemTime::now()),
                surfaces: (!surfaces.is_empty()).then_some(surfaces),
                commands: (!commands.is_empty()).then_some(commands),
            }),
        })
    }

    /// Keep the turn Eris answered in words as an episode, with the commands her errands ran.
    pub(crate) fn keep_turn(&self, asked: &str, answered: &str, steps: Vec<MemoryStep>) {
        let caller = agent_caller(ERIS).unwrap_or_default();
        self.record_episode(asked, answered, steps, &caller);
    }
}

/// The remember tool, offered on every turn of a desk that keeps memory.
pub(crate) fn desk_remember() -> ToolDefinition {
    let schema = json!({
        "type": "object",
        "properties": {
            "text": { "type": "string", "minLength": 1, "maxLength": 2000,
                "description": "The fact, in the person's words: \"Prefers pnpm over npm\"." },
            "tags": { "type": "array", "items": { "type": "string" }, "maxItems": 16 }
        },
        "required": ["text"],
        "additionalProperties": false
    });
    ToolDefinition {
        name: DESK_REMEMBER.to_owned(),
        description: "Keep a fact or preference about the person in your memory on this desk, for \
            later turns. The person is asked first unless they let you remember freely."
            .to_owned(),
        schema: schema.as_object().cloned().unwrap_or_default(),
    }
}

/// The memory.remember request a desk-remember call makes, under memory:write.
pub(crate) fn remember_request(
    arguments: &serde_json::Map<String, Value>,
) -> Result<BridgeRequest, String> {
    let mut params = arguments.clone();
    params.insert("scope".to_owned(), json!({ "permission": "memory:write" }));
    let request = json!({ "id": 0, "method": "memory.remember", "params": params });
    serde_json::from_value(request).map_err(|_| "desk-remember takes { text, tags? }".to_owned())
}
