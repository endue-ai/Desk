//! Ollama's `/api/chat`: the messages of a conversation, one streamed request, and its answer read
//! into text, tool calls and a stop reason.

use std::io;

use desk_brain::{BrainError, BrainErrorCode, BrainFailure, StopReason};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::http::{Endpoint, post};

/// One tool invocation the model asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub name: String,
    pub arguments: Map<String, Value>,
}

/// What the model answered.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    pub text: String,
    pub calls: Vec<Call>,
    pub stop: StopReason,
}

/// What the stream hands over while it runs.
pub enum Piece<'a> {
    /// Ollama accepted the request; the answer follows.
    Opened,
    Text(&'a str),
}

/// Send the conversation and read the streamed answer. Nothing reaches `on` before Ollama has
/// accepted the request, so a refusal or an unreachable server leaves no trace in the turn.
pub fn chat(
    endpoint: &Endpoint,
    model: &str,
    tools: &[Value],
    messages: &[Value],
    on: &mut dyn FnMut(Piece<'_>),
) -> Result<Answer, BrainFailure> {
    let mut body = json!({ "model": model, "messages": messages, "stream": true });
    if !tools.is_empty() {
        body["tools"] = Value::from(tools.to_vec());
    }
    let response = post(endpoint, "/api/chat", &body).map_err(unreachable)?;
    if response.status >= 300 {
        let status = response.status;
        let text = response.text().map_err(unreachable)?;
        return Err(refused(status, error_message(status, &text)));
    }
    on(Piece::Opened);
    let mut answer = Answer {
        text: String::new(),
        calls: Vec::new(),
        stop: StopReason::EndTurn,
    };
    for line in response.lines() {
        let line = line.map_err(unreachable)?;
        let chunk: Chunk = serde_json::from_str(&line)
            .map_err(|e| BrainFailure::Protocol(format!("{e} in Ollama's line {line}")))?;
        if let Some(error) = chunk.error {
            return Err(refused(500, error));
        }
        if let Some(message) = chunk.message {
            let text = message.content.unwrap_or_default();
            if !text.is_empty() {
                on(Piece::Text(&text));
                answer.text.push_str(&text);
            }
            for call in message.tool_calls.unwrap_or_default() {
                answer.calls.push(call.into_call()?);
            }
        }
        if chunk.done {
            answer.stop = if !answer.calls.is_empty() {
                StopReason::ToolCall
            } else if chunk.done_reason.as_deref() == Some("length") {
                StopReason::MaxTokens
            } else {
                StopReason::EndTurn
            };
            return Ok(answer);
        }
    }
    Err(BrainFailure::Unreachable(
        "Ollama's stream ended before the answer did".to_owned(),
    ))
}

/// A user message: the parts of what the person typed, joined.
pub fn user(text: &str) -> Value {
    json!({ "role": "user", "content": text })
}

/// The model's answer as it goes back into the conversation.
pub fn assistant(text: &str, calls: &[Call]) -> Value {
    let mut message = json!({ "role": "assistant", "content": text });
    if !calls.is_empty() {
        let calls: Vec<Value> = calls
            .iter()
            .map(|c| json!({ "function": { "name": c.name, "arguments": c.arguments } }))
            .collect();
        message["tool_calls"] = Value::from(calls);
    }
    message
}

/// A tool's result for the model: text stays text, anything else is sent as JSON.
pub fn tool(name: &str, output: &Value, failed: bool) -> Value {
    let text = match output {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let content = if failed {
        format!("The tool failed: {text}")
    } else {
        text
    };
    json!({ "role": "tool", "tool_name": name, "content": content })
}

/// One line of Ollama's stream. Fields this adapter does not use are ignored.
#[derive(Deserialize)]
struct Chunk {
    #[serde(default)]
    message: Option<ChunkMessage>,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    done_reason: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct ChunkMessage {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<WireCall>>,
}

#[derive(Deserialize)]
struct WireCall {
    function: WireFunction,
}

#[derive(Deserialize)]
struct WireFunction {
    name: String,
    #[serde(default)]
    arguments: Value,
}

impl WireCall {
    fn into_call(self) -> Result<Call, BrainFailure> {
        let WireFunction { name, arguments } = self.function;
        if name.is_empty() {
            return Err(BrainFailure::Protocol(
                "Ollama asked for a tool without a name".to_owned(),
            ));
        }
        // Ollama sends an object; some models put the object in a string.
        let arguments = match arguments {
            Value::Null => Map::new(),
            Value::Object(map) => map,
            Value::String(text) => match serde_json::from_str(&text) {
                Ok(Value::Object(map)) => map,
                _ => return Err(bad_arguments(&name, &Value::String(text))),
            },
            other => return Err(bad_arguments(&name, &other)),
        };
        Ok(Call { name, arguments })
    }
}

fn bad_arguments(name: &str, arguments: &Value) -> BrainFailure {
    BrainFailure::Protocol(format!(
        "Ollama called {name} with arguments that are not an object: {arguments}"
    ))
}

/// Ollama's `{"error": "..."}`, or the body itself when it is not that.
fn error_message(status: u16, body: &str) -> String {
    let error = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_owned));
    match error {
        Some(error) => error,
        None if body.trim().is_empty() => format!("Ollama answered {status}"),
        None => body.trim().to_owned(),
    }
}

fn refused(status: u16, message: String) -> BrainFailure {
    let code = match status {
        400 => BrainErrorCode::InvalidRequest,
        401 | 403 => BrainErrorCode::Unauthorized,
        404 => BrainErrorCode::NotFound,
        429 => BrainErrorCode::RateLimited,
        _ => BrainErrorCode::Internal,
    };
    BrainFailure::Refused {
        status,
        error: BrainError {
            code,
            message,
            holder: None,
        },
    }
}

fn unreachable(error: io::Error) -> BrainFailure {
    BrainFailure::Unreachable(format!("Ollama: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_may_arrive_as_a_string() {
        let call: WireCall = serde_json::from_value(
            json!({ "function": { "name": "f", "arguments": "{\"a\":1}" } }),
        )
        .unwrap();
        assert_eq!(call.into_call().unwrap().arguments["a"], 1);
        let call: WireCall =
            serde_json::from_value(json!({ "function": { "name": "f", "arguments": [1] } }))
                .unwrap();
        assert!(matches!(call.into_call(), Err(BrainFailure::Protocol(_))));
    }

    #[test]
    fn error_bodies_keep_their_message() {
        assert_eq!(error_message(404, r#"{"error":"no model"}"#), "no model");
        assert_eq!(error_message(502, " bad gateway "), "bad gateway");
        assert_eq!(error_message(500, ""), "Ollama answered 500");
    }
}
