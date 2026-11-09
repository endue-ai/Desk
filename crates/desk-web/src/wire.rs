//! The text messages between a page's `window.__deskNative` and the shell (#43), shaped like Tauri's
//! `invoke` and `listen` so the runtime calls both shells the same way:
//! a call `{"id":1,"cmd":"bridge_call","args":{...}}`, its reply `{"id":1,"ok":<value>}` or
//! `{"id":1,"error":"..."}`, and an event `{"event":"bridge://event","payload":<value>}`.

use serde::Deserialize;
use serde_json::{Value, json};

/// One call from a page.
#[derive(Debug, Deserialize, PartialEq)]
pub struct Call {
    pub id: u64,
    pub cmd: String,
    #[serde(default)]
    pub args: Value,
}

impl Call {
    pub fn parse(text: &str) -> Result<Self, String> {
        serde_json::from_str(text).map_err(|why| format!("not a call: {why}"))
    }
}

/// The reply to call `id`.
pub fn reply(id: u64, outcome: Result<Value, String>) -> String {
    match outcome {
        Ok(value) => json!({ "id": id, "ok": value }).to_string(),
        Err(message) => json!({ "id": id, "error": message }).to_string(),
    }
}

/// An event for the page's listeners of `event`.
pub fn event(event: &str, payload: Value) -> String {
    json!({ "event": event, "payload": payload }).to_string()
}

#[cfg(test)]
mod tests {
    use super::{Call, event, reply};
    use serde_json::{Value, json};

    #[test]
    fn calls_parse_and_replies_and_events_have_their_shapes() {
        let call =
            Call::parse(r#"{"id":7,"cmd":"desk_ready","args":{"status":"desk ready"}}"#).unwrap();
        assert_eq!(call.id, 7);
        assert_eq!(call.cmd, "desk_ready");
        assert_eq!(call.args["status"], "desk ready");
        assert_eq!(
            Call::parse(r#"{"id":1,"cmd":"desk_start"}"#).unwrap().args,
            Value::Null
        );
        assert!(Call::parse("nope").is_err());
        let ok: Value = serde_json::from_str(&reply(7, Ok(json!(true)))).unwrap();
        assert_eq!(ok, json!({ "id": 7, "ok": true }));
        let err: Value = serde_json::from_str(&reply(8, Err("no".into()))).unwrap();
        assert_eq!(err, json!({ "id": 8, "error": "no" }));
        let e: Value =
            serde_json::from_str(&event("bridge://event", json!({ "event": "x" }))).unwrap();
        assert_eq!(e["event"], "bridge://event");
        assert_eq!(e["payload"]["event"], "x");
    }
}
