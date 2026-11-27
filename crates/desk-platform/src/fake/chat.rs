use serde_json::json;

use super::routes::{Answer, data, error, ok};
use super::{Seen, State};

pub(super) fn is_run(seen: &Seen) -> bool {
    seen.method == "POST"
        && seen.path.starts_with("/api/v1/ai/conversations/")
        && seen.path.ends_with("/runs")
}

pub(super) fn answer(state: &mut State, seen: &Seen, parts: &[&str]) -> Option<Answer> {
    if seen.method != "POST" {
        return None;
    }
    Some(match *parts {
        ["api", "v1", "ai", "conversations"] => {
            let agent = seen.body["agent_id"].as_str().unwrap_or_default();
            if !state
                .agents
                .iter()
                .any(|row| row.id == agent && !row.foreign && row.status == "active")
            {
                return Some(error(404, "NOT_FOUND", "Agent not found"));
            }
            let id = format!("cnv_desk_{}", state.chat_conversations.len() + 1);
            state
                .chat_conversations
                .insert(id.clone(), agent.to_owned());
            data(json!({ "id": id, "agent_id": agent }))
        }
        ["api", "v1", "spaces", space, "conversation"] => {
            let target = state
                .spaces
                .iter()
                .find(|row| row.id() == space && !row.foreign);
            let Some(agent) = target.and_then(|row| row.body["front_agent_id"].as_str()) else {
                return Some(error(404, "NOT_FOUND", "Front Desk not found"));
            };
            let id = format!("cnv_{space}");
            let bound = state
                .chat_conversations
                .entry(id.clone())
                .or_insert_with(|| agent.to_owned());
            data(json!({ "conversation_id": id, "agent_id": bound }))
        }
        ["api", "v1", "ai", "conversations", conversation, "runs"] => {
            let agent = state
                .chat_conversations
                .get(conversation)
                .map(String::as_str);
            if agent.is_none() || agent != seen.body["agent_id"].as_str() {
                return Some(error(409, "WRONG_TARGET", "Conversation target changed"));
            }
            if seen
                .headers
                .get("accept")
                .is_none_or(|value| value != "text/event-stream")
                || seen.body["stream"] != true
                || seen.body["content"].as_str().is_none_or(str::is_empty)
                || seen.body["client_message_id"]
                    .as_str()
                    .is_none_or(str::is_empty)
            {
                return Some(error(
                    400,
                    "INVALID_REQUEST",
                    "Expected a text run and message ID",
                ));
            }
            ok(json!(null))
        }
        _ => return None,
    })
}
