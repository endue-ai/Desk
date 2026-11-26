//! One text turn using the web's conversation and run endpoints. Only the final answer crosses
//! this client's boundary. Interactive stops stay in the cloud conversation for the person.

use std::time::Duration;

use desk_sys::net::Method;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::http::encode;
use crate::{ErrorKind, Platform, PlatformError, Result, TIMEOUT};

const MAX_STREAM: u64 = 2 * 1024 * 1024;
const MAX_REPLY: usize = 12_000;
const TURN_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Debug, Deserialize)]
pub struct ChatConversation {
    #[serde(alias = "conversation_id")]
    pub id: String,
    pub agent_id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ChatState {
    Done,
    NeedsInput,
    Interrupted,
    Failed,
}

#[derive(Debug)]
pub struct ChatTurn {
    pub run_id: Option<String>,
    pub state: ChatState,
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChatDone {
    run_id: String,
    stop_reason: Option<String>,
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    role: String,
    content: Option<String>,
}

impl ChatTurn {
    pub fn interrupted() -> Self {
        Self {
            run_id: None,
            state: ChatState::Interrupted,
            text: None,
        }
    }
}

impl Platform {
    pub fn agent_conversation(&self, agent_id: &str) -> Result<ChatConversation> {
        self.read(
            Method::Post,
            "/api/v1/ai/conversations",
            Some(&json!({ "agent_id": agent_id, "title": "From Desk", "approval_level": "ask" })),
            "the new conversation",
        )
    }

    pub fn space_conversation(&self, space_id: &str) -> Result<ChatConversation> {
        self.read(
            Method::Post,
            &format!("/api/v1/spaces/{}/conversation", encode(space_id)),
            None,
            "the space's Front Desk conversation",
        )
    }

    /// The caller picks a new client message ID once, before sending or renewing auth.
    pub fn chat_turn(
        &self,
        conversation: &ChatConversation,
        text: &str,
        message_id: &str,
    ) -> Result<ChatTurn> {
        let path = format!("/api/v1/ai/conversations/{}/runs", encode(&conversation.id));
        let body = json!({
            "agent_id": conversation.agent_id, "content": text, "stream": true,
            "client_message_id": message_id
        });
        // Respect a smaller configured deadline in tests or on hosts with their own timeout.
        let timeout = if self.timeout == TIMEOUT {
            TURN_TIMEOUT
        } else {
            self.timeout.min(TURN_TIMEOUT)
        };
        let reply = self.event_response(&path, &body, timeout, MAX_STREAM)?;
        let kind = reply
            .headers
            .get("content-type")
            .and_then(|s| s.split(';').next());
        if !kind.is_some_and(|s| s.trim().eq_ignore_ascii_case("text/event-stream")) {
            return Err(PlatformError::new(
                ErrorKind::Failed,
                "endue AI did not return a run stream",
            ));
        }
        let body = std::str::from_utf8(&reply.body)
            .map_err(|e| PlatformError::unexpected("the run stream", e))?;
        Ok(run_result(body))
    }
}

fn run_result(body: &str) -> ChatTurn {
    let mut run = ChatTurn::interrupted();
    let mut event = "";
    let mut data = String::new();
    let mut pending_input = false;
    for line in body.trim_start_matches('\u{feff}').lines() {
        if line.is_empty() {
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                if let Some(id) = value["run_id"].as_str().filter(|id| valid_id(id)) {
                    if run.run_id.as_deref().is_some_and(|old| old != id) {
                        return ChatTurn::interrupted();
                    }
                    run.run_id = Some(id.to_owned());
                }
                match event {
                    "interaction" => pending_input = true,
                    "error" => {
                        run.state = ChatState::Failed;
                        return run;
                    }
                    "done" => {
                        return match serde_json::from_value::<ChatDone>(value) {
                            Ok(done) => terminal(run, done, pending_input),
                            Err(_) => run,
                        };
                    }
                    _ => {}
                }
            }
            event = "";
            data.clear();
        } else if let Some(value) = line.strip_prefix("event:") {
            event = value.strip_prefix(' ').unwrap_or(value);
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
        }
    }
    if pending_input {
        run.state = ChatState::NeedsInput;
    }
    run
}

fn terminal(mut run: ChatTurn, done: ChatDone, pending_input: bool) -> ChatTurn {
    if run.run_id.as_deref() != Some(&done.run_id) {
        return run;
    }
    run.state = match done.stop_reason.as_deref() {
        Some("awaiting_choice") => ChatState::NeedsInput,
        Some("error") => ChatState::Failed,
        None | Some("final") => {
            if let Some(text) = done.message.content.filter(|s| !s.trim().is_empty())
                && done.message.role == "assistant"
            {
                run.text = Some(text.chars().take(MAX_REPLY).collect());
                ChatState::Done
            } else if pending_input {
                ChatState::NeedsInput
            } else {
                ChatState::Interrupted
            }
        }
        Some(_) => ChatState::Interrupted,
    };
    run
}

fn valid_id(id: &str) -> bool {
    id.len() <= 128
        && id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
