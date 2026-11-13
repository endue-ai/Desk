//! The rules the island's notices follow (ADR 0204): `desk.notify`'s settings, as the desk's status
//! line follows them (`packages/runtime/src/policies/notify.ts`): how long each level shows, whether
//! do-not-disturb holds notices back and which levels it still lets through, and how many are kept.
//! The page reads them in `island_state` and hears them again as `island://notify` when one changes.

use desk_core::Core;
use serde_json::{Value, json};

use crate::eris_window::calls::call;

/// Whose settings these are.
pub const OWNER: &str = "desk.notify";
const LEVELS: [&str; 4] = ["info", "success", "warning", "error"];

/// The notify settings in force, each its default when the desk cannot read it.
pub fn notify(core: &Core) -> Value {
    let read = |key: &str| {
        let request = json!({ "id": 0, "method": "settings.get", "params": { "key": key } });
        call(core, OWNER, request)
            .ok()
            .and_then(|answer| answer.get("value").cloned())
    };
    rules(read)
}

/// The settings `read` answers, in the shape the runtime's `NotifySettings` has.
pub fn rules(read: impl Fn(&str) -> Option<Value>) -> Value {
    let defaults = [4000, 4000, 8000, 0];
    let durations: serde_json::Map<String, Value> = LEVELS
        .iter()
        .zip(defaults)
        .map(|(level, default)| {
            let ms = read(&format!("{level}-ms")).and_then(|v| v.as_u64());
            ((*level).to_owned(), json!(ms.unwrap_or(default)))
        })
        .collect();
    let allows = read("dnd-allows")
        .filter(|v| v.as_array().is_some_and(|a| a.iter().all(Value::is_string)))
        .unwrap_or_else(|| json!(["error"]));
    json!({
        "durations": durations,
        "dnd": read("dnd").and_then(|v| v.as_bool()).unwrap_or(false),
        "dndAllows": allows,
        "history": read("history").and_then(|v| v.as_u64()).unwrap_or(200),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::rules;

    #[test]
    fn the_desks_rules_and_its_defaults_for_what_it_cannot_read() {
        assert_eq!(
            rules(|_| None),
            json!({ "durations": { "info": 4000, "success": 4000, "warning": 8000, "error": 0 },
                    "dnd": false, "dndAllows": ["error"], "history": 200 })
        );
        let set = |key: &str| -> Option<Value> {
            match key {
                "dnd" => Some(json!(true)),
                "dnd-allows" => Some(json!(["warning", "error"])),
                "info-ms" => Some(json!(1500)),
                // Not a number: the default stands.
                "warning-ms" => Some(json!("long")),
                _ => None,
            }
        };
        assert_eq!(
            rules(set),
            json!({ "durations": { "info": 1500, "success": 4000, "warning": 8000, "error": 0 },
                    "dnd": true, "dndAllows": ["warning", "error"], "history": 200 })
        );
    }
}
