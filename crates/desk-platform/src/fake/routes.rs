//! The fake's routes, answered as endue AI's services answer them (bare bodies, `{ data, meta }`,
//! `{ success, data }`, and `{ error: { code, message } }` with the status endue AI uses).

use serde_json::{Value, json};

use super::Seen;
use super::state::{FakeAgent, State, slug_of};

type Answer = (u16, Option<Value>);

fn error(status: u16, code: &str, message: &str) -> Answer {
    let meta = json!({ "request_id": "req_fake", "timestamp": "2026-11-01T09:00:00Z" });
    let body = json!({ "error": { "code": code, "message": message }, "meta": meta });
    (status, Some(body))
}

fn ok(body: Value) -> Answer {
    (200, Some(body))
}

fn data(body: Value) -> Answer {
    ok(json!({ "data": body, "meta": { "request_id": "req_fake" } }))
}

pub(super) fn answer(state: &mut State, seen: &Seen) -> Answer {
    if let Some((status, code, message)) = state.fail_next.take() {
        return error(status, &code, &message);
    }
    if let Some((status, code, message)) = state.fail_at.get(&seen.path) {
        return error(*status, code, message);
    }
    let public = seen.method == "GET" && seen.path == "/api/v1/agent-catalog/agents";
    let token = seen
        .headers
        .get("authorization")
        .and_then(|h| h.strip_prefix("Bearer "));
    if !public && !token.is_some_and(|t| state.tokens.contains(t)) {
        return error(401, "UNAUTHORIZED", "Invalid or expired token");
    }
    let parts: Vec<&str> = seen.path.trim_start_matches('/').split('/').collect();
    match (seen.method.as_str(), parts.as_slice()) {
        ("GET", ["api", "v1", "agents"]) => list(state, seen),
        ("POST", ["api", "v1", "agents"]) => create(state, &seen.body, None),
        (_, ["api", "v1", "agents", id, rest @ ..]) => agent(state, seen, id, rest),
        ("GET", ["api", "v1", "agent-catalog", "agents"]) => data(json!(state.catalog)),
        ("POST", ["api", "v1", "agent-catalog", "recommend"]) => recommend(state, &seen.body),
        ("POST", ["api", "v1", "agent-catalog", "agents", slug, "use"]) => use_catalog(state, slug),
        ("GET", ["api", "v1", "ai", "conversations"]) => conversations(state, seen),
        _ => error(404, "NOT_FOUND", "No such route"),
    }
}

fn number(seen: &Seen, key: &str, default: usize) -> usize {
    seen.query
        .get(key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn page_of<T: Clone>(items: &[T], page: usize, limit: usize) -> Vec<T> {
    items
        .iter()
        .skip(page.saturating_sub(1) * limit)
        .take(limit)
        .cloned()
        .collect()
}

fn list(state: &State, seen: &Seen) -> Answer {
    let (page, limit) = (number(seen, "page", 1), number(seen, "limit", 20).min(200));
    let mine: Vec<Value> = state
        .agents
        .iter()
        .rev()
        .filter(|a| !a.foreign)
        .map(get_response)
        .collect();
    let items = page_of(&mine, page, limit);
    let pagination = json!({
        "total": mine.len(), "page": page, "limit": limit,
        "has_next_page": page * limit < mine.len()
    });
    ok(json!({ "items": items, "pagination": pagination }))
}

fn get_response(agent: &FakeAgent) -> Value {
    json!({
        "id": agent.id, "slug": agent.slug, "name": agent.name, "status": agent.status,
        "personal_color": agent.personal_color, "avatar_url": null,
        "source_catalog": agent.source_catalog,
        "created_at": agent.created_at, "updated_at": agent.updated_at
    })
}

fn create(state: &mut State, body: &Value, catalog: Option<Value>) -> Answer {
    let name = body["profile"]["name"].as_str().unwrap_or_default();
    if name.trim().is_empty() || name.chars().count() > 100 {
        return error(
            400,
            "VALIDATION_ERROR",
            "profile.name must be 1-100 characters",
        );
    }
    let Some(role) = body["nature"]["role"]["prompts"][0].as_str() else {
        return error(400, "VALIDATION_ERROR", "nature.role is required");
    };
    let id = state.add_agent(name, role);
    let n = state.agents.len();
    let Some(agent) = state.agent_mut(&id) else {
        return error(500, "INTERNAL", "lost the agent");
    };
    agent.slug = slug_of(name, n);
    agent.personality = body["nature"]["personality"].clone();
    if let Some(languages) = body["nature"]["languages"].as_array() {
        agent.languages = languages
            .iter()
            .filter_map(|l| l.as_str().map(str::to_owned))
            .collect();
    }
    agent.description = body["profile"]["description"].as_str().map(str::to_owned);
    agent.source_catalog = catalog;
    (201, Some(json!({ "agent_id": id })))
}

fn agent(state: &mut State, seen: &Seen, id: &str, rest: &[&str]) -> Answer {
    let Some(found) = state.agent(id) else {
        return error(404, "NOT_FOUND", "Agent not found");
    };
    if found.foreign {
        return error(403, "FORBIDDEN", "Access denied");
    }
    let at = state.tick();
    let Some(agent) = state.agent_mut(id) else {
        return error(404, "NOT_FOUND", "Agent not found");
    };
    let body = &seen.body;
    match (seen.method.as_str(), rest) {
        ("GET", []) => ok(get_response(agent)),
        ("PATCH", []) => update(agent, body, at),
        ("DELETE", []) if agent.status == "deleted" => {
            error(409, "ALREADY_DELETED", "Agent is already deleted")
        }
        ("DELETE", []) => {
            agent.status = "deleted".to_owned();
            agent.updated_at = at;
            (204, None)
        }
        ("PUT", ["status"]) => match body["status"].as_str() {
            Some(s) if s == agent.status => {
                error(409, "CONFLICT", &format!("Agent is already {s}"))
            }
            Some(s @ ("active" | "inactive")) => {
                agent.status = s.to_owned();
                agent.updated_at = at;
                (204, None)
            }
            _ => error(400, "VALIDATION_ERROR", "status must be active or inactive"),
        },
        ("GET", ["identity"]) => ok(json!({
            "nature": {
                "role": { "v": "1.0", "prompts": [agent.role] },
                "personality": agent.personality, "languages": agent.languages
            },
            "profile": {
                "name": agent.name, "description": agent.description, "avatar_url": null,
                "personal_color": agent.personal_color
            }
        })),
        ("GET", ["settings"]) => data(settings(agent)),
        ("PATCH", ["settings"]) => {
            if let Some(visibility) = body["visibility"].as_str() {
                agent.visibility = visibility.to_owned();
            }
            if let Some(model) = body["models"]["chat"].get("default") {
                agent.model = model.as_str().map(str::to_owned);
            }
            data(settings(agent))
        }
        ("GET", ["prompt"]) => {
            let active = agent.active_rev;
            let prompt = agent.revisions.iter().find(|r| r["rev"].as_u64() == active);
            ok(json!({ "prompt": prompt }))
        }
        ("PUT", ["prompt"]) => match body["content"].as_str() {
            Some(content) if !content.is_empty() && content.chars().count() <= 20_000 => {
                ok(revise(agent, content, "manual", None, at))
            }
            _ => error(
                400,
                "VALIDATION_ERROR",
                "content must be 1-20000 characters",
            ),
        },
        ("GET", ["prompt", "revisions"]) => {
            let active = agent.active_rev;
            let revisions: Vec<Value> = agent
                .revisions
                .iter()
                .rev()
                .map(|r| {
                    let content = r["content"].as_str().unwrap_or_default();
                    let mut summary = r.clone();
                    summary["preview"] = json!(content.chars().take(120).collect::<String>());
                    summary["active"] = json!(r["rev"].as_u64() == active);
                    summary.as_object_mut().map(|m| m.remove("content"));
                    summary
                })
                .collect();
            ok(json!({ "revisions": revisions }))
        }
        ("POST", ["prompt", "revisions", rev, "restore"]) => {
            let from = rev.parse::<u64>().ok();
            let earlier = agent.revisions.iter().find(|r| r["rev"].as_u64() == from);
            match earlier
                .and_then(|r| r["content"].as_str())
                .map(str::to_owned)
            {
                Some(content) => ok(revise(agent, &content, "restore", from, at)),
                None => error(404, "NOT_FOUND", "Revision not found"),
            }
        }
        ("GET", ["skills"]) => ok(json!(agent.skills)),
        ("GET", ["connectors"]) => ok(json!(agent.connectors)),
        ("GET", ["traits"]) => ok(json!({ "traits": agent.traits })),
        _ => error(404, "NOT_FOUND", "No such route"),
    }
}

fn update(agent: &mut FakeAgent, body: &Value, at: String) -> Answer {
    if body.get("slug").is_some() {
        return error(
            400,
            "BAD_REQUEST",
            "slug is server-generated and cannot be changed",
        );
    }
    let (nature, profile) = (&body["nature"], &body["profile"]);
    if nature.is_null() && profile.is_null() {
        return error(400, "BAD_REQUEST", "nature or profile is required");
    }
    if let Some(role) = nature["role"]["prompts"][0].as_str() {
        agent.role = role.to_owned();
    }
    if nature.get("personality").is_some_and(Value::is_object) {
        agent.personality = nature["personality"].clone();
    }
    if let Some(languages) = nature["languages"].as_array() {
        agent.languages = languages
            .iter()
            .filter_map(|l| l.as_str().map(str::to_owned))
            .collect();
    }
    if let Some(name) = profile["name"].as_str() {
        agent.name = name.to_owned();
    }
    if let Some(description) = profile["description"].as_str() {
        agent.description = Some(description.to_owned());
    }
    if let Some(color) = profile["personal_color"].as_str() {
        agent.personal_color = Some(color.to_owned());
    }
    agent.updated_at = at;
    (204, None)
}

fn settings(agent: &FakeAgent) -> Value {
    json!({
        "agent_id": agent.id, "visibility": agent.visibility, "chat_history_retention": 90,
        "logging_conversation": true, "disabled_tool_groups": [],
        "available_tool_groups": ["browser", "workspace"],
        "models": { "chat": { "default": agent.model, "fallback": null, "routing": null } },
        "updated_at": agent.updated_at
    })
}

fn revise(
    agent: &mut FakeAgent,
    content: &str,
    source: &str,
    from: Option<u64>,
    at: String,
) -> Value {
    let rev = agent.revisions.len() as u64 + 1;
    let revision = json!({
        "rev": rev, "content": content, "source": source, "restored_from_rev": from, "created_at": at
    });
    agent.revisions.push(revision.clone());
    agent.active_rev = Some(rev);
    revision
}

fn recommend(state: &State, body: &Value) -> Answer {
    let query = body["query"].as_str().unwrap_or_default().to_lowercase();
    if query.trim().is_empty() {
        return error(400, "VALIDATION_ERROR", "query is required");
    }
    let matches: Vec<Value> = state
        .catalog
        .iter()
        .filter(|c| {
            c["tags"].as_array().is_some_and(|tags| {
                tags.iter()
                    .any(|t| t.as_str().is_some_and(|t| query.contains(t)))
            })
        })
        .map(|c| json!({ "slug": c["slug"], "reason": "It works with mail." }))
        .collect();
    data(json!({ "matches": matches, "source": "keyword" }))
}

fn use_catalog(state: &mut State, slug: &str) -> Answer {
    let Some(catalog) = state.catalog.iter().find(|c| c["slug"] == slug).cloned() else {
        return error(404, "NOT_FOUND", "Catalog agent not found");
    };
    let manifest = &catalog["manifest"];
    let body = json!({
        "nature": { "role": { "v": "1.0", "prompts": [manifest["identity"]["role"]["en"]] } },
        "profile": { "name": manifest["identity"]["name"] }
    });
    let source = json!({ "catalog_agent_id": catalog["id"], "version": catalog["version"] });
    let (_, Some(created)) = create(state, &body, Some(source)) else {
        return error(500, "INTERNAL", "could not create");
    };
    let used = json!({
        "agent_id": created["agent_id"],
        "catalog": { "id": catalog["id"], "slug": slug, "version": catalog["version"] },
        "applied": { "prompt": true, "traits": ["personality"], "skills": ["mail-triage"], "model": false },
        "warnings": [{ "step": "model", "code": "MODEL_NOT_ALLOWED", "target": null }],
        "recommended": { "connectors": manifest["connectors"], "channels": ["slack"] }
    });
    (201, Some(json!({ "data": used, "meta": {} })))
}

fn conversations(state: &State, seen: &Seen) -> Answer {
    let wants = |key: &str| seen.query.get(key).map(String::as_str) == Some("true");
    let matching: Vec<Value> = state
        .conversations
        .iter()
        .filter(|c| {
            seen.query
                .get("agent_id")
                .is_none_or(|id| c["agent_id"] == id.as_str())
        })
        .filter(|c| !wants("awaiting_input") || c["awaiting_input"] == true)
        .filter(|c| !wants("running") || c["last_run_status"] == "running")
        .cloned()
        .collect();
    let (page, limit) = (number(seen, "page", 1), number(seen, "limit", 20).min(100));
    let items = page_of(&matching, page, limit);
    ok(json!({ "success": true, "data": { "items": items, "total": matching.len() } }))
}
