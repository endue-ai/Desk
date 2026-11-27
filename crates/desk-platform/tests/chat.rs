use std::sync::Arc;

use desk_platform::fake::{FakePlatform, FakeSpace};
use desk_platform::{ChatState, Platform, Tokens};
use serde_json::json;

struct Token;

impl Tokens for Token {
    fn token(&self) -> Option<String> {
        Some("token-1".into())
    }

    fn refresh(&self, _: &str) -> Option<String> {
        None
    }
}

#[test]
fn creates_a_reviewed_agent_conversation_and_returns_the_terminal_message() {
    let fake = FakePlatform::start();
    let agent = fake.state().add_agent("Fixture", "Read the outline");
    let platform = Platform::new(fake.url(), Arc::new(Token)).unwrap();
    let conversation = platform.agent_conversation(&agent).unwrap();
    assert_eq!(conversation.agent_id, agent);
    let turn = platform
        .chat_turn(&conversation, "Is it ready?", "desk_message")
        .unwrap();
    assert_eq!(turn.state, ChatState::Done);
    assert_eq!(turn.text.as_deref(), Some("The outline is ready."));
    assert_eq!(turn.run_id.as_deref(), Some("run_fixture"));
    let request = fake.seen_at("POST", "/api/v1/ai/conversations");
    assert_eq!(
        request[0].body,
        json!({"agent_id": agent, "title": "From Desk", "approval_level": "ask"})
    );
    let path = format!("/api/v1/ai/conversations/{}/runs", conversation.id);
    let sent = fake.seen_at("POST", &path);
    assert_eq!(sent.len(), 1);
    assert_eq!(
        sent[0].headers.get("accept").map(String::as_str),
        Some("text/event-stream")
    );
    assert!(!sent[0].headers.contains_key("origin"));
    assert_eq!(
        sent[0].body,
        json!({
            "agent_id": agent, "content": "Is it ready?", "stream": true, "client_message_id": "desk_message"
        })
    );
}

#[test]
fn uses_the_space_binding_and_keeps_incomplete_streams_out_of_the_answer() {
    let fake = FakePlatform::start();
    let mut space = FakeSpace::new("sp_fixture", "Launch");
    space.body["front_agent_id"] = json!("ag_front");
    fake.state().spaces.push(space);
    let platform = Platform::new(fake.url(), Arc::new(Token)).unwrap();
    let conversation = platform.space_conversation("sp_fixture").unwrap();
    assert_eq!(conversation.id, "cnv_sp_fixture");
    assert_eq!(conversation.agent_id, "ag_front");
    assert!(fake.seen_at("POST", "/api/v1/ai/conversations").is_empty());

    for (stream, state) in [
        (
            "event: delta\r\ndata: {\"run_id\":\"run_1\",\"content\":\"Partial\"}\r\n\r\n",
            ChatState::Interrupted,
        ),
        (
            "event: interaction\ndata: {\"run_id\":\"run_1\",\"prompt\":\"Choose\"}\n\n",
            ChatState::NeedsInput,
        ),
        (
            "event: error\ndata: {\"run_id\":\"run_1\",\"code\":\"CLOUD_ERROR\"}\n\n",
            ChatState::Failed,
        ),
        (
            "event: done\ndata: {\"run_id\":\"run_1\",\"stop_reason\":\"awaiting_choice\",\"message\":{\"role\":\"assistant\",\"content\":\"Choose\"}}\n\n",
            ChatState::NeedsInput,
        ),
    ] {
        fake.state().chat_stream = stream.to_owned();
        let result = platform
            .chat_turn(&conversation, "Is it ready?", "desk_message")
            .unwrap();
        assert_eq!(result.state, state);
        assert_eq!(result.text, None);
    }
}
