//! What Claude Code is asked, and how its answer is read (ADR 0109). Claude Code runs without
//! tools of its own, so the turn's tools are described in the system prompt and its answer comes
//! back through a JSON schema: `say` (words for the person) or `calls` (the desk's tools to run, in
//! order). The conversation, kept in Ollama's message form, goes on stdin as a transcript.

use desk_brain::BrainFailure;
use serde_json::{Map, Value, json};

use crate::model::Call;

/// The longest transcript sent, in bytes; older lines are left out first.
const TRANSCRIPT_BYTES: usize = 120_000;
/// The longest tool result kept in the transcript, in bytes.
const RESULT_BYTES: usize = 16_000;

const WHO: &str = "You are Eris, the assistant who lives on the person's endue Desk, and you are \
its brain now. You have no tools of your own: the desk runs its tools for you and shows the person \
each hand-off.";

const HOW: &str = "How to answer:
- Answer only through the JSON schema you are given.
- To read or do anything on the desk, put tool calls in \"calls\" (a tool's name, and arguments \
that match its schema) and leave \"say\" empty. The desk runs them in order and sends you every \
result; then answer, or call more.
- To answer the person, put your words in \"say\" and leave \"calls\" empty. Speak briefly and \
plainly, in the person's language, as spoken words: no Markdown, no lists.
- The person's line comes after the desk as they see it: its windows front to back, the focused \
one first, and the tools of each plugin. A request about \"this\", \"here\" or a window is for the \
plugin that window shows: use that plugin's tools.
- desk-tools lists every tool of the desk and desk-run runs one by its command id: use them for a \
plugin whose tools are not offered by name. When no tool fits, say what you cannot do.
- Use what the tools answer and never invent a result. When a tool fails, say why or try another \
way. A call the person did not approve comes back not approved: accept it.";

const PLAIN: &str = "There are no tools in this turn: answer the person in plain words, briefly, \
in their language, as spoken words, with no Markdown.";

/// The system prompt: who Eris is, how to answer, and each tool with its arguments.
pub fn system(tools: &[Value]) -> String {
    if tools.is_empty() {
        return format!("{WHO}\n\n{PLAIN}");
    }
    let mut text =
        format!("{WHO}\n\n{HOW}\n\nTools (name: what it does; arguments as JSON Schema):");
    for tool in tools {
        let function = &tool["function"];
        let name = function["name"].as_str().unwrap_or_default();
        let description = function["description"].as_str().unwrap_or_default();
        let parameters = function.get("parameters").cloned().unwrap_or(json!({}));
        text.push_str(&format!(
            "\n- {name}: {description}\n  arguments: {parameters}"
        ));
    }
    text
}

/// The answer's JSON schema: `say` and `calls`, each call naming one of `tools`. `required` asks
/// for at least one call (the turn's toolChoice). Without tools there is no schema.
pub fn schema(tools: &[Value], required: bool) -> Option<String> {
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|t| t["function"]["name"].as_str())
        .collect();
    if names.is_empty() {
        return None;
    }
    let mut calls = json!({
        "type": "array",
        "maxItems": 8,
        "items": {
            "type": "object",
            "properties": {
                "tool": { "type": "string", "enum": names },
                "arguments": { "type": "object" }
            },
            "required": ["tool", "arguments"],
            "additionalProperties": false
        }
    });
    if required {
        calls["minItems"] = json!(1);
    }
    let schema = json!({
        "type": "object",
        "properties": { "say": { "type": "string" }, "calls": calls },
        "required": ["say", "calls"],
        "additionalProperties": false
    });
    Some(schema.to_string())
}

/// The conversation as Claude Code reads it on stdin, oldest first, as much as fits; the last
/// person's line and what follows it always go.
pub fn transcript(messages: &[Value]) -> String {
    let lines: Vec<String> = messages.iter().map(line).collect();
    let last_person = messages
        .iter()
        .rposition(|m| m["role"] == "user")
        .unwrap_or(0);
    let mut kept = Vec::new();
    let mut size = 0;
    for (at, line) in lines.iter().enumerate().rev() {
        size += line.len() + 2;
        if size > TRANSCRIPT_BYTES && at < last_person {
            break;
        }
        kept.push(line.as_str());
    }
    kept.reverse();
    let mut text = String::from("The conversation so far, oldest first.");
    if kept.len() < lines.len() {
        text.push_str(" Earlier lines are left out.");
    }
    text.push_str("\n\n");
    text.push_str(&kept.join("\n\n"));
    text.push_str(
        "\n\nAnswer what the person said last, through the JSON schema when there is one.",
    );
    text
}

/// One message of the conversation as a transcript line.
fn line(message: &Value) -> String {
    let content = message["content"].as_str().unwrap_or_default();
    match message["role"].as_str() {
        Some("user") => format!("Person: {content}"),
        Some("system") => format!("Desk: {content}"),
        Some("tool") => {
            let name = message["tool_name"].as_str().unwrap_or("a tool");
            format!("Tool {name} answered: {}", cut(content, RESULT_BYTES))
        }
        Some("assistant") => {
            let mut parts = Vec::new();
            if !content.is_empty() {
                parts.push(format!("Eris: {content}"));
            }
            for call in message["tool_calls"].as_array().into_iter().flatten() {
                let function = &call["function"];
                let name = function["name"].as_str().unwrap_or_default();
                parts.push(format!("Eris called {name} with {}", function["arguments"]));
            }
            parts.join("\n")
        }
        _ => content.to_owned(),
    }
}

/// `text` up to `max` bytes, on a character boundary, saying so when it was cut.
fn cut(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{} … (cut at {max} bytes)", &text[..end])
}

/// Claude Code's structured answer: what to say, and the calls to make.
pub fn answer(structured: &Value) -> Result<(String, Vec<Call>), BrainFailure> {
    let protocol = |why: String| BrainFailure::Protocol(format!("Claude Code's answer {why}"));
    let say = structured["say"].as_str().unwrap_or_default().to_owned();
    let mut calls = Vec::new();
    for call in structured["calls"].as_array().into_iter().flatten() {
        let name = call["tool"].as_str().filter(|n| !n.is_empty());
        let name = name.ok_or_else(|| protocol(format!("calls a tool without a name: {call}")))?;
        let arguments = match &call["arguments"] {
            Value::Null => Map::new(),
            Value::Object(map) => map.clone(),
            Value::String(text) => match serde_json::from_str(text) {
                Ok(Value::Object(map)) => map,
                _ => return Err(protocol(format!("calls {name} with {text}"))),
            },
            other => return Err(protocol(format!("calls {name} with {other}"))),
        };
        calls.push(Call {
            name: name.to_owned(),
            arguments,
        });
    }
    Ok((say, calls))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str) -> Value {
        json!({ "type": "function", "function": { "name": name, "description": "Does it.",
            "parameters": { "type": "object", "properties": {} } } })
    }

    #[test]
    fn the_system_prompt_lists_each_tool_or_asks_for_plain_words() {
        let text = system(&[tool("endue_git_state")]);
        assert!(text.starts_with("You are Eris"));
        let listed = text
            .split("\n- endue_git_state: Does it.\n  arguments: ")
            .nth(1)
            .unwrap();
        let arguments: Value = serde_json::from_str(listed).unwrap();
        assert_eq!(arguments, json!({ "type": "object", "properties": {} }));
        assert!(system(&[]).ends_with(PLAIN));
    }

    #[test]
    fn the_schema_names_the_turns_tools_and_asks_for_a_call_when_required() {
        assert_eq!(schema(&[], false), None);
        let free: Value =
            serde_json::from_str(&schema(&[tool("a"), tool("b")], false).unwrap()).unwrap();
        assert_eq!(
            free["properties"]["calls"]["items"]["properties"]["tool"]["enum"],
            json!(["a", "b"])
        );
        assert_eq!(free["properties"]["calls"].get("minItems"), None);
        let required: Value = serde_json::from_str(&schema(&[tool("a")], true).unwrap()).unwrap();
        assert_eq!(required["properties"]["calls"]["minItems"], 1);
    }

    #[test]
    fn the_transcript_says_who_said_what_and_cuts_long_results() {
        let messages = [
            json!({ "role": "user", "content": "what changed?" }),
            json!({ "role": "assistant", "content": "",
                "tool_calls": [{ "function": { "name": "endue_git_state", "arguments": { "path": "." } } }] }),
            json!({ "role": "tool", "tool_name": "endue_git_state", "content": "x".repeat(RESULT_BYTES + 5) }),
            json!({ "role": "assistant", "content": "Two files changed." }),
            json!({ "role": "user", "content": "thanks" }),
        ];
        let text = transcript(&messages);
        assert!(
            text.starts_with("The conversation so far, oldest first.\n\nPerson: what changed?\n\n")
        );
        assert!(text.contains("\n\nEris called endue_git_state with {\"path\":\".\"}\n\n"));
        assert!(text.contains(&format!(
            "Tool endue_git_state answered: {} … (cut at {RESULT_BYTES} bytes)",
            "x".repeat(RESULT_BYTES)
        )));
        assert!(text.contains("\n\nEris: Two files changed.\n\nPerson: thanks\n\nAnswer what"));
    }

    #[test]
    fn a_long_conversation_leaves_its_oldest_lines_out_but_never_the_last_line() {
        let old = "o".repeat(TRANSCRIPT_BYTES / 2);
        let mut messages: Vec<Value> = (0..4)
            .map(|_| json!({ "role": "user", "content": old }))
            .collect();
        messages.push(json!({ "role": "user", "content": "y".repeat(TRANSCRIPT_BYTES * 2) }));
        let text = transcript(&messages);
        assert!(text.contains("Earlier lines are left out."));
        assert!(!text.contains(&old), "every older line leaves");
        assert!(text.contains(&"y".repeat(TRANSCRIPT_BYTES * 2)));
    }

    #[test]
    fn an_answer_gives_its_words_and_its_calls() {
        let structured = json!({ "say": "", "calls": [
            { "tool": "endue_git_state", "arguments": { "path": "." } },
            { "tool": "desk-tools", "arguments": "{\"query\":\"mail\"}" },
            { "tool": "endue_mail_latest", "arguments": null }
        ] });
        let (say, calls) = answer(&structured).unwrap();
        assert_eq!(say, "");
        let names: Vec<&str> = calls.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            ["endue_git_state", "desk-tools", "endue_mail_latest"]
        );
        assert_eq!(calls[1].arguments["query"], "mail");
        assert!(calls[2].arguments.is_empty());
        assert_eq!(
            answer(&json!({ "say": "Hi.", "calls": [] })).unwrap().0,
            "Hi."
        );
        let nameless = answer(&json!({ "say": "", "calls": [{ "arguments": {} }] }));
        assert!(matches!(nameless, Err(BrainFailure::Protocol(_))));
        let listed = answer(&json!({ "say": "", "calls": [{ "tool": "a", "arguments": [1] }] }));
        assert!(matches!(listed, Err(BrainFailure::Protocol(_))));
    }
}
