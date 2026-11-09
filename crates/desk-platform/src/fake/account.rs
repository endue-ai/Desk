//! The fake's own account of the signed-in person (ADR 0130), answered as user-service (bare
//! bodies) and notification-service (`{ data, meta }`) answer: the account, its preferences and the
//! channels of every kind of notification. Like the services, it refuses a public username in a
//! profile change and drops a notification update whose type or channel it does not know.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::routes::{Answer, data, error, ok};
use super::{Seen, State};

/// The kinds the fake knows, with their channels (`in_app`, `email`, `push`).
const KINDS: [&str; 6] = [
    "conversation_reply",
    "routine_completed",
    "routine_failed",
    "routine_skipped",
    "agent_notice",
    "system_announcement",
];
const CHANNELS: [&str; 3] = ["in_app", "email", "push"];

#[derive(Debug, Clone, PartialEq)]
pub struct FakeAccount {
    /// `UserGetResponse`, bare.
    pub user: Value,
    /// `UserPreferenceResponse`, bare.
    pub preferences: Value,
    /// Every kind's channels, by type.
    pub notifications: BTreeMap<String, Value>,
}

impl Default for FakeAccount {
    fn default() -> Self {
        let notifications = KINDS
            .iter()
            .map(|kind| {
                let push = *kind == "agent_notice";
                let channels = json!({ "in_app": true, "email": false, "push": push });
                ((*kind).to_owned(), channels)
            })
            .collect();
        Self {
            user: json!({
                "public_username": "ada-7f3k",
                "id": "usr_00000000-0000-4000-8000-000000000001",
                "email": "ada@example.com",
                "display_name": "Ada",
                "avatar_url": null,
                "status": "active",
                "created_at": "2026-03-14T09:00:00.000Z",
                "updated_at": "2026-03-14T09:00:00.000Z",
                "region_exempt": false
            }),
            preferences: json!({
                "window_layout": null,
                "locale": null,
                "timezone": "America/New_York",
                "favorite_models": [],
                "list_prefs": {},
                "last_chat_model": null,
                "agent_route": null,
                "last_approval_mode": null,
                "updated_at": "2026-03-14T09:00:00.000Z"
            }),
            notifications,
        }
    }
}

/// The answer to an account route, or `None` when `parts` names none.
pub(super) fn answer(state: &mut State, seen: &Seen, parts: &[&str]) -> Option<Answer> {
    let body = &seen.body;
    Some(match (seen.method.as_str(), parts) {
        ("GET", ["api", "v1", "users", "me"]) => ok(state.account.user.clone()),
        ("PATCH", ["api", "v1", "users", "me"]) => {
            let now = state.tick();
            update_me(&mut state.account, body, now)
        }
        ("GET", ["api", "v1", "users", "me", "preferences"]) => {
            ok(state.account.preferences.clone())
        }
        ("PATCH", ["api", "v1", "users", "me", "preferences"]) => {
            let now = state.tick();
            update_preferences(&mut state.account, body, now)
        }
        ("GET", ["api", "v1", "notifications", "preferences"]) => {
            data(json!(state.account.notifications))
        }
        ("PUT", ["api", "v1", "notifications", "preferences"]) => {
            update_notifications(&mut state.account, body)
        }
        _ => return None,
    })
}

fn object(body: &Value) -> Option<&Map<String, Value>> {
    body.as_object()
}

fn update_me(account: &mut FakeAccount, body: &Value, now: String) -> Answer {
    let Some(given) = object(body) else {
        return error(400, "BAD_REQUEST", "Invalid JSON body");
    };
    if given.contains_key("public_username") || given.contains_key("username") {
        return error(
            400,
            "BAD_REQUEST",
            "Public username is server-issued and immutable",
        );
    }
    for key in ["display_name", "avatar_url"] {
        if let Some(value) = given.get(key) {
            account.user[key] = value.clone();
        }
    }
    account.user["updated_at"] = json!(now);
    ok(account.user.clone())
}

fn update_preferences(account: &mut FakeAccount, body: &Value, now: String) -> Answer {
    let Some(given) = object(body) else {
        return error(400, "BAD_REQUEST", "Invalid JSON body");
    };
    // user-service stores locale and timezone as given, unchecked.
    for key in ["locale", "timezone"] {
        if let Some(value) = given.get(key).filter(|v| v.is_string()) {
            account.preferences[key] = value.clone();
        }
    }
    account.preferences["updated_at"] = json!(now);
    ok(account.preferences.clone())
}

fn update_notifications(account: &mut FakeAccount, body: &Value) -> Answer {
    let Some(updates) = body.get("updates").and_then(Value::as_array) else {
        return error(400, "BAD_REQUEST", "updates must be an array");
    };
    for update in updates {
        let kind = update["notification_type"].as_str().unwrap_or_default();
        let channel = update["channel"].as_str().unwrap_or_default();
        let (Some(channels), Some(enabled)) = (
            account.notifications.get_mut(kind),
            update["enabled"].as_bool(),
        ) else {
            continue;
        };
        if CHANNELS.contains(&channel) {
            channels[channel] = json!(enabled);
        }
    }
    data(json!(account.notifications))
}
