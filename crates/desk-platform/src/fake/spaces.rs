//! The fake's spaces: each one's body as endue AI answers `GET /api/v1/spaces/{id}` (its summary
//! included), its overview and its rooms, all kept as given. The list leaves the summary out unless
//! `include=summary` asks for it and lists the archived ones only for `status=archived`, as the
//! platform does. A space marked foreign is someone else's: reading it is a 404.

use serde_json::{Value, json};

use super::Seen;
use super::routes::{Answer, data, error, ok};
use super::state::State;

/// One space and what the platform answers about it.
#[derive(Debug, Clone, PartialEq)]
pub struct FakeSpace {
    /// The `SpaceGetResponse` body, `summary` included.
    pub body: Value,
    /// The `SpaceOverview` data.
    pub overview: Value,
    /// The `SpaceRoomView` list's data.
    pub rooms: Vec<Value>,
    pub foreign: bool,
}

impl FakeSpace {
    /// A space named `name`, active, with no agents, work, results or rooms.
    pub fn new(id: &str, name: &str) -> Self {
        let at = "2026-11-01T09:00:00.000Z";
        Self {
            body: json!({
                "id": id, "key": name.to_lowercase(), "name": name, "type": "workspace",
                "status": "active", "created_at": at, "updated_at": at,
                "unnamed": { "kept": "on endue AI" }, "revision": 1,
                "summary": { "active_work_items": 0, "open_attention_items": 0 }
            }),
            overview: json!({
                "counts": { "active_work_items": 0, "open_attention_items": 0, "results": 0 },
                "agents": [], "active_work_items": [], "recent_work_items": [],
                "recent_results": [], "attention_items": []
            }),
            rooms: Vec::new(),
            foreign: false,
        }
    }

    pub fn id(&self) -> &str {
        self.body["id"].as_str().unwrap_or_default()
    }
}

pub(super) fn answer(state: &State, seen: &Seen, rest: &[&str]) -> Answer {
    if seen.method != "GET" {
        return error(405, "METHOD_NOT_ALLOWED", "The fake's spaces are read only");
    }
    let [id, rest @ ..] = rest else {
        return list(state, seen);
    };
    let Some(space) = state.spaces.iter().find(|s| s.id() == *id && !s.foreign) else {
        return error(404, "NOT_FOUND", "Space not found");
    };
    match rest {
        [] => ok(space.body.clone()),
        ["overview"] => data(space.overview.clone()),
        ["rooms"] => data(json!(space.rooms)),
        _ => error(404, "NOT_FOUND", "No such route"),
    }
}

fn list(state: &State, seen: &Seen) -> Answer {
    let archived = match seen.query.get("status").map(String::as_str) {
        None | Some("active") => false,
        Some("archived") => true,
        Some(_) => return error(400, "VALIDATION_ERROR", "status must be active or archived"),
    };
    let summary = seen.query.get("include").map(String::as_str) == Some("summary");
    let listed: Vec<Value> = state
        .spaces
        .iter()
        .filter(|s| !s.foreign && (s.body["status"] == "archived") == archived)
        .map(|s| {
            let mut body = s.body.clone();
            if !summary && let Some(map) = body.as_object_mut() {
                map.remove("summary");
            }
            body
        })
        .collect();
    ok(json!(listed))
}
