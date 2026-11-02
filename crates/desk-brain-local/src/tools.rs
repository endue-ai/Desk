//! A turn's `tools` and `toolChoice` in Ollama's terms. Ollama's `/api/chat` takes function tools
//! (`{ "type": "function", "function": { name, description, parameters } }`) and has no tool choice,
//! so the choice becomes what is offered and a system line for the first answer: `tool` offers only
//! the named tool and asks for it, `required` asks for one of the tools, `auto` (or none) asks for
//! nothing. The turn's tools come after the ones the brain was opened with.

use desk_brain::{BrainFailure, ToolChoice, ToolDefinition, TurnRequest};
use serde_json::{Value, json};

use crate::store::invalid;

/// What one request to Ollama offers.
#[derive(Debug, Clone, PartialEq)]
pub struct Offer {
    /// Ollama's `tools`.
    pub tools: Vec<Value>,
    /// A system message that asks for a tool call, put first in the first request only.
    pub system: Option<Value>,
}

/// One tool in Ollama's form.
pub fn function(tool: &ToolDefinition) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.schema,
        }
    })
}

/// The offer for `request`, on top of `defaults` (the brain's own tools).
pub fn for_turn(defaults: &[Value], request: &TurnRequest) -> Result<Offer, BrainFailure> {
    offer(
        defaults,
        request.tools.as_deref(),
        request.tool_choice.as_ref(),
    )
}

/// The offer for a turn: `defaults` (the brain's own tools) and the turn's, as `choice` says.
pub fn offer(
    defaults: &[Value],
    tools: Option<&[ToolDefinition]>,
    choice: Option<&ToolChoice>,
) -> Result<Offer, BrainFailure> {
    let tools = tools.unwrap_or_default();
    if choice.is_some() && tools.is_empty() {
        return Err(invalid("toolChoice needs tools."));
    }
    let all = || {
        let mut all = defaults.to_vec();
        all.extend(tools.iter().map(function));
        all
    };
    Ok(match choice {
        Some(ToolChoice::NamedTool(named)) => {
            let tool = tools.iter().find(|t| t.name == named.name).ok_or_else(|| {
                invalid(format!(
                    "toolChoice names {}, which the turn does not offer.",
                    named.name
                ))
            })?;
            Offer {
                tools: vec![function(tool)],
                system: Some(system(&format!(
                    "Answer only by calling the tool {}, with arguments that match its parameters.",
                    tool.name
                ))),
            }
        }
        Some(ToolChoice::RequiredTool(_)) => Offer {
            tools: all(),
            system: Some(system("Answer by calling one of the tools you are given.")),
        },
        Some(ToolChoice::AutoTool(_)) | None => Offer {
            tools: all(),
            system: None,
        },
    })
}

fn system(text: &str) -> Value {
    json!({ "role": "system", "content": text })
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use desk_brain::{
        Brain, ClientInfo, CreateSessionRequest, LeaseAcquireRequest, LeaseHolder, TurnEvent,
    };

    use super::*;
    use crate::{LocalBrain, LocalBrainOptions};

    /// An Ollama that takes one /api/chat, answers with a call of propose_theme and hands back
    /// the body it was sent.
    fn one_chat() -> (String, thread::JoinHandle<Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let call =
                json!({ "function": { "name": "propose_theme", "arguments": { "name": "Warm" } } });
            let lines = format!(
                "{}\n{}\n",
                json!({ "message": { "role": "assistant", "content": "", "tool_calls": [call] }, "done": false }),
                json!({ "done": true, "done_reason": "stop" })
            );
            let head = "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close";
            let length = lines.len();
            write!(&stream, "{head}\r\nContent-Length: {length}\r\n\r\n{lines}").unwrap();
            serde_json::from_slice(&body).unwrap()
        });
        (url, server)
    }

    #[test]
    fn a_turn_sends_ollama_its_tool_and_the_line_that_asks_for_it() {
        let (url, server) = one_chat();
        let folder = std::env::temp_dir().join(format!("desk-local-tools-{}", std::process::id()));
        let options = LocalBrainOptions::new("test-model").with_base_url(url);
        let brain = LocalBrain::open(&folder, options).unwrap();
        let client = ClientInfo {
            name: "test".to_owned(),
            version: "0".to_owned(),
        };
        let session = brain
            .create_session(&CreateSessionRequest {
                title: None,
                client,
            })
            .unwrap();
        let holder = LeaseHolder {
            desk_id: "desk-a".to_owned(),
            name: None,
        };
        let acquire = LeaseAcquireRequest {
            holder,
            ttl_seconds: 60,
            takeover: None,
        };
        let lease = brain.acquire_lease(&session.id, &acquire).unwrap();
        let request: TurnRequest = serde_json::from_value(json!({
            "leaseId": lease.lease_id,
            "message": { "role": "user", "content": [{ "type": "text", "text": "warm paper" }] },
            "tools": [{ "name": "propose_theme", "description": "A theme.", "schema": { "type": "object" } }],
            "toolChoice": { "type": "tool", "name": "propose_theme" }
        }))
        .unwrap();
        let mut events = Vec::new();
        brain
            .create_turn(&session.id, &request, &mut |e| events.push(e))
            .unwrap();
        let body = server.join().unwrap();
        let _ = std::fs::remove_dir_all(&folder);

        let function = json!({ "name": "propose_theme", "description": "A theme.", "parameters": { "type": "object" } });
        assert_eq!(
            body["tools"],
            json!([{ "type": "function", "function": function }])
        );
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(
            body["messages"][1],
            json!({ "role": "user", "content": "warm paper" })
        );
        let call = events.iter().find_map(|e| match e {
            TurnEvent::ToolCall(call) => Some(&call.call),
            _ => None,
        });
        assert_eq!(
            call.map(|c| (c.name.as_str(), &c.arguments["name"])),
            Some(("propose_theme", &json!("Warm")))
        );
    }

    fn tool(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_owned(),
            description: format!("The {name} tool."),
            schema: json!({ "type": "object" }).as_object().unwrap().clone(),
        }
    }

    fn choice(value: Value) -> ToolChoice {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn a_named_tool_is_the_only_one_offered_and_the_one_asked_for() {
        let defaults = [json!({ "type": "function", "function": { "name": "clock" } })];
        let tools = [tool("propose_theme"), tool("lookup")];
        let named = choice(json!({ "type": "tool", "name": "propose_theme" }));
        let offer = offer(&defaults, Some(&tools), Some(&named)).unwrap();
        assert_eq!(
            offer.tools,
            [json!({ "type": "function", "function": {
                "name": "propose_theme",
                "description": "The propose_theme tool.",
                "parameters": { "type": "object" },
            } })]
        );
        let line = offer.system.unwrap();
        assert_eq!(line["role"], "system");
        assert!(line["content"].as_str().unwrap().contains("propose_theme"));
    }

    #[test]
    fn required_asks_for_any_tool_and_auto_for_none() {
        let defaults = [json!({ "type": "function", "function": { "name": "clock" } })];
        let tools = [tool("lookup")];
        let required = choice(json!({ "type": "required" }));
        let offer_required = offer(&defaults, Some(&tools), Some(&required)).unwrap();
        assert_eq!(offer_required.tools.len(), 2);
        assert!(offer_required.system.is_some());
        let auto = choice(json!({ "type": "auto" }));
        for choice in [Some(&auto), None] {
            let offered = offer(&defaults, Some(&tools), choice).unwrap();
            assert_eq!(offered.tools[1]["function"]["name"], "lookup");
            assert_eq!(offered.system, None);
        }
        assert_eq!(offer(&defaults, None, None).unwrap().tools, defaults);
    }

    #[test]
    fn a_choice_needs_the_tools_it_names() {
        let named = choice(json!({ "type": "tool", "name": "propose_theme" }));
        let missing = offer(&[], Some(&[tool("lookup")]), Some(&named)).unwrap_err();
        assert_eq!(
            missing.code(),
            Some(desk_brain::BrainErrorCode::InvalidRequest)
        );
        let none = offer(&[], None, Some(&named)).unwrap_err();
        assert_eq!(
            none.code(),
            Some(desk_brain::BrainErrorCode::InvalidRequest)
        );
    }
}
