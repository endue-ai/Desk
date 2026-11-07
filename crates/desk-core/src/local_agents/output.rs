//! What a run's program says, one JSON line at a time: Claude Code's stream-json (system init,
//! assistant messages of text and tool_use blocks, one result) and Codex's `exec --json` (thread and
//! item events, or the older `{ msg }` events), read as plugins/local-agents/ui/parse.js reads them.

use desk_bridge::LocalAgentId;
use serde_json::Value;

use super::claude::describe;
use super::lines::text;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Step {
    /// The program's session.
    Session(String),
    /// A block of the answer.
    Text(String),
    /// A tool the agent used, with the start of its input.
    Tool(String, String),
    /// The whole answer, when the program gives one at its end.
    Final(String),
    /// A problem; `true` when the run failed of it.
    Error(String, bool),
}

/// The steps of one output line.
pub(crate) fn steps(agent: LocalAgentId, line: &Value) -> Vec<Step> {
    match agent {
        LocalAgentId::Claude => claude(line),
        LocalAgentId::Codex => match line.get("msg").filter(|m| m.is_object()) {
            Some(msg) => codex_old(msg),
            None => codex(line),
        },
    }
}

fn session(id: Option<&str>) -> Option<Step> {
    id.filter(|id| super::is_session_id(id))
        .map(|id| Step::Session(id.to_owned()))
}

fn claude(o: &Value) -> Vec<Step> {
    let mut out = Vec::new();
    match text(o, &["type"]) {
        Some("system") if o["subtype"] == "init" => out.extend(session(text(o, &["session_id"]))),
        Some("assistant") => {
            for block in o["message"]["content"].as_array().into_iter().flatten() {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(said) = text(block, &["text"]) {
                            out.push(Step::Text(said.to_owned()));
                        }
                    }
                    Some("tool_use") => {
                        let name = text(block, &["name"]).unwrap_or("tool").to_owned();
                        out.push(Step::Tool(name, describe(&block["input"])));
                    }
                    _ => {}
                }
            }
        }
        Some("result") => {
            out.extend(session(text(o, &["session_id"])));
            let subtype = text(o, &["subtype"]);
            if o["is_error"] == true || subtype.is_some_and(|s| s != "success") {
                let why = text(o, &["result"])
                    .or_else(|| text(o, &["error"]))
                    .map(str::to_owned)
                    .unwrap_or_else(|| {
                        format!("The run ended with {}.", subtype.unwrap_or("an error"))
                    });
                out.push(Step::Error(why, true));
            } else if let Some(answer) = text(o, &["result"]) {
                out.push(Step::Final(answer.to_owned()));
            }
        }
        _ => {}
    }
    out
}

fn codex(o: &Value) -> Vec<Step> {
    let item = &o["item"];
    let kind = item["type"].as_str();
    match text(o, &["type"]) {
        Some("thread.started") => session(text(o, &["thread_id"])).into_iter().collect(),
        Some("item.started") => match kind {
            Some("command_execution") => {
                vec![Step::Tool("Run".to_owned(), command(&item["command"]))]
            }
            Some("mcp_tool_call") => {
                let server = text(item, &["server"]).unwrap_or_default();
                let tool = text(item, &["tool"]).unwrap_or_default();
                vec![Step::Tool(format!("{server}.{tool}"), String::new())]
            }
            Some("web_search") => vec![Step::Tool("Search".to_owned(), command(&item["query"]))],
            _ => Vec::new(),
        },
        Some("item.completed") => match kind {
            Some("agent_message") => text(item, &["text"])
                .map(|t| Step::Text(t.to_owned()))
                .into_iter()
                .collect(),
            Some("file_change") => {
                let paths: Vec<&str> = item["changes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| c["path"].as_str())
                    .collect();
                vec![Step::Tool("Edit".to_owned(), paths.join(", "))]
            }
            Some("error") => text(item, &["message"])
                .map(|m| Step::Error(m.to_owned(), false))
                .into_iter()
                .collect(),
            _ => Vec::new(),
        },
        Some("turn.failed") => {
            let why = text(o, &["error", "message"]).unwrap_or("The turn failed.");
            vec![Step::Error(why.to_owned(), true)]
        }
        Some("error") => text(o, &["message"])
            .map(|m| Step::Error(m.to_owned(), false))
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

fn codex_old(msg: &Value) -> Vec<Step> {
    match text(msg, &["type"]) {
        Some("session_configured") => session(text(msg, &["session_id"])).into_iter().collect(),
        Some("agent_message") => text(msg, &["message"])
            .map(|m| Step::Text(m.to_owned()))
            .into_iter()
            .collect(),
        Some("exec_command_begin") => vec![Step::Tool("Run".to_owned(), command(&msg["command"]))],
        Some("patch_apply_begin") => {
            let paths: Vec<&String> = msg["changes"]
                .as_object()
                .into_iter()
                .flat_map(|c| c.keys())
                .collect();
            let paths: Vec<&str> = paths.into_iter().map(String::as_str).collect();
            vec![Step::Tool("Edit".to_owned(), paths.join(", "))]
        }
        Some("task_complete") => text(msg, &["last_agent_message"])
            .map(|m| Step::Final(m.to_owned()))
            .into_iter()
            .collect(),
        Some("error" | "stream_error") => {
            let why = text(msg, &["message"]).unwrap_or("Codex failed.");
            vec![Step::Error(why.to_owned(), false)]
        }
        _ => Vec::new(),
    }
}

/// A command as text: a string as it is, a list of words joined by spaces.
fn command(value: &Value) -> String {
    let joined = match value {
        Value::Array(words) => words
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" "),
        other => describe(other),
    };
    super::clip(&joined, 500).0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "5b1c2d3e-0f1a-4b2c-9d3e-4f5a6b7c8d9e";

    #[test]
    fn claude_says_its_session_text_tools_and_result() {
        let c = LocalAgentId::Claude;
        let init = json!({ "type": "system", "subtype": "init", "session_id": ID });
        assert_eq!(steps(c, &init), [Step::Session(ID.to_owned())]);
        let said = json!({ "type": "assistant", "message": { "content": [
            { "type": "text", "text": "Running the tests." },
            { "type": "tool_use", "name": "Bash", "input": { "command": "pnpm test" } }] } });
        assert_eq!(
            steps(c, &said),
            [
                Step::Text("Running the tests.".to_owned()),
                Step::Tool("Bash".to_owned(), "pnpm test".to_owned())
            ]
        );
        let done = json!({ "type": "result", "subtype": "success", "result": "Two fail.", "session_id": ID });
        assert_eq!(steps(c, &done)[1], Step::Final("Two fail.".to_owned()));
        let failed = json!({ "type": "result", "subtype": "error_max_turns", "is_error": true });
        assert!(matches!(&steps(c, &failed)[0], Step::Error(_, true)));
    }

    #[test]
    fn codex_says_its_thread_items_and_failures() {
        let x = LocalAgentId::Codex;
        assert_eq!(
            steps(x, &json!({ "type": "thread.started", "thread_id": ID })),
            [Step::Session(ID.to_owned())]
        );
        let run = json!({ "type": "item.started", "item": { "type": "command_execution", "command": ["cargo", "test"] } });
        assert_eq!(
            steps(x, &run),
            [Step::Tool("Run".to_owned(), "cargo test".to_owned())]
        );
        let said = json!({ "type": "item.completed", "item": { "type": "agent_message", "text": "Done." } });
        assert_eq!(steps(x, &said), [Step::Text("Done.".to_owned())]);
        let failed = json!({ "type": "turn.failed", "error": { "message": "No quota." } });
        assert_eq!(
            steps(x, &failed),
            [Step::Error("No quota.".to_owned(), true)]
        );
        let old = json!({ "msg": { "type": "task_complete", "last_agent_message": "All good." } });
        assert_eq!(steps(x, &old), [Step::Final("All good.".to_owned())]);
    }
}
