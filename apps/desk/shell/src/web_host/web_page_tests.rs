//! What `web_page.rs` makes of the page script's answers and of a key (ADR 0268).

use desk_bridge::WebKeyName;
use desk_core::WebError;
use serde_json::json;

use super::{answered, asks, key_events};

#[test]
fn the_page_scripts_ok_is_the_answer() {
    let evaluated = json!({ "result": { "type": "object", "value": { "ok": { "moved": true } } } });
    assert_eq!(answered(&evaluated), Ok(json!({ "moved": true })));
}

#[test]
fn what_the_page_cannot_take_keeps_its_reason() {
    let said = |code: &str| {
        let error = json!({ "code": code, "message": "why" });
        answered(&json!({ "result": { "value": { "error": error } } }))
    };
    assert_eq!(said("not_found"), Err(WebError::NotFound("why".into())));
    // A page that went to another site is as gone as an element that left it.
    assert_eq!(said("moved"), Err(WebError::NotFound("why".into())));
    assert_eq!(said("invalid"), Err(WebError::Invalid("why".into())));
    assert_eq!(said("other"), Err(WebError::Failed("why".into())));
}

#[test]
fn a_script_that_threw_or_said_nothing_failed() {
    let thrown = json!({
        "result": { "type": "object", "subtype": "error" },
        "exceptionDetails": { "text": "Uncaught", "exception": { "description": "TypeError: x" } }
    });
    let Err(WebError::Failed(why)) = answered(&thrown) else {
        panic!("a thrown error is a failure");
    };
    assert!(why.contains("TypeError: x"), "{why}");
    let nothing = answered(&json!({ "result": { "type": "undefined" } }));
    assert!(matches!(nothing, Err(WebError::Failed(_))), "{nothing:?}");
}

#[test]
fn the_request_is_handed_to_the_script_as_json() {
    let request = json!({ "do": "choose", "ref": "e7", "option": "it's \"한국어\"\n" });
    let expression = asks(&request);
    assert!(expression.contains("globalThis.__deskPageText ="));
    assert!(expression.contains("globalThis.__deskPage ="));
    let call = expression.rsplit('\n').next().unwrap();
    assert_eq!(call, format!("__deskPage({request})"));
    // Nothing of the request is script: a quote or a line break in it stays inside its string.
    assert!(call.contains(r#"it's \"한국어\"\n"#), "{call}");
}

#[test]
fn a_key_that_types_says_its_text_and_another_is_a_raw_key() {
    let [down, up] = key_events(WebKeyName::Enter);
    assert_eq!(down["type"], "keyDown");
    assert_eq!(down["text"], "\r");
    assert_eq!(down["windowsVirtualKeyCode"], 13);
    assert_eq!(up["type"], "keyUp");
    assert!(up.get("text").is_none());
    let [down, _] = key_events(WebKeyName::ArrowDown);
    assert_eq!(down["type"], "rawKeyDown");
    assert_eq!(down["key"], "ArrowDown");
    assert_eq!(down["windowsVirtualKeyCode"], 40);
    assert!(down.get("text").is_none());
    let [space, _] = key_events(WebKeyName::Space);
    assert_eq!(
        (space["key"].as_str(), space["code"].as_str()),
        (Some(" "), Some("Space"))
    );
}
