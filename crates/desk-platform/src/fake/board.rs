//! The fake's answers for what Studio's board reads beyond agent-service's Studio facets (ADR 0232):
//! an agent's channel pairings, endue OS devices, workspaces and theme, its memories, the person's
//! API keys and the agents' artifacts. A body a test set for the path (`State::answer_at`) is
//! answered as it is; otherwise what endue AI answers for an agent with nothing of the kind.

use serde_json::{Value, json};

use super::Seen;
use super::routes::{Answer, error, ok};
use super::state::State;

/// The answer to `seen`, when it is one of the board's reads.
pub(super) fn answer(state: &State, seen: &Seen, parts: &[&str]) -> Option<Answer> {
    if seen.method != "GET" {
        return None;
    }
    let (agent, empty) = match parts {
        ["api", "v1", "agents", id, "channel-pairings"] => {
            (Some(*id), json!({ "pairings": [], "total": 0 }))
        }
        ["api", "v1", "agents", id, "os-devices"] => (Some(*id), json!({ "devices": [] })),
        ["api", "v1", "agents", id, "workspaces"] => (Some(*id), json!({ "workspaces": [] })),
        ["api", "v1", "agents", id, "theme"] => (Some(*id), theme()),
        ["api", "v1", "ai", "agents", id, "memories"] => (
            Some(*id),
            json!({ "success": true, "data": { "items": [], "total": 0 } }),
        ),
        ["api", "v1", "me", "api-keys"] => (None, json!({ "items": [], "scope_catalog": [] })),
        ["api", "v1", "artifacts"] => (None, artifacts()),
        _ => return None,
    };
    if let Some(id) = agent {
        match state.agent(id) {
            None => return Some(error(404, "NOT_FOUND", "Agent not found")),
            Some(found) if found.foreign => return Some(error(403, "FORBIDDEN", "Access denied")),
            Some(_) => {}
        }
    }
    Some(ok(state.answers.get(&seen.path).cloned().unwrap_or(empty)))
}

/// A theme never saved: the agent's own colour and no wallpaper.
fn theme() -> Value {
    json!({ "data": { "supported": true, "saved": false,
        "theme": { "v": 1, "accent": "agent", "wallpaper": null } } })
}

fn artifacts() -> Value {
    let pagination = json!({ "total": 0, "page": 1, "limit": 1, "has_next_page": false });
    json!({ "data": [], "meta": { "pagination": pagination } })
}
