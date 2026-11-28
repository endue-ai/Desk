//! Codex transcripts: `<home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl` and the archived ones,
//! one JSON record a line; thread names in `<home>/session_index.jsonl`.

use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::LazyLock;

use desk_bridge::{AgentLinkRel, AgentProgram};
use regex::Regex;
use serde_json::Value;

use crate::links::Paths;
use crate::session::Session;

/// Records the knowledge base never needs: tool output, reasoning, token counts, model state.
const SKIPPED: &[&str] = &[
    "\"type\":\"function_call_output\"",
    "\"type\":\"custom_tool_call_output\"",
    "\"type\":\"reasoning\"",
    "\"type\":\"token_count\"",
    "\"type\":\"token_usage_record\"",
    "\"type\":\"world_state\"",
    "\"type\":\"compaction\"",
];

static PATCHED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"\*\*\* (?:Update File|Add File|Delete File|Move to): ([^\n\\"'`]+)"#)
        .expect("patch header")
});
static TOOL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\btools\.([A-Za-z0-9_]+)\s*\(").expect("tool call"));

/// Thread names by session id, the last one written winning.
pub fn titles(codex_home: &Path) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    let _ = crate::each_line(&codex_home.join("session_index.jsonl"), |line| {
        if let Ok(entry) = serde_json::from_str::<Value>(line)
            && let (Some(id), Some(name)) = (entry["id"].as_str(), entry["thread_name"].as_str())
        {
            titles.insert(id.to_owned(), name.to_owned());
        }
    });
    titles
}

/// Read one transcript; `None` for a session the harness ran for itself (an approval guardian).
pub fn read(
    path: &Path,
    titles: &HashMap<String, String>,
    paths: &Paths,
) -> io::Result<Option<Session>> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = name
        .trim_end_matches(".zst")
        .trim_end_matches(".jsonl")
        .to_owned();
    let fallback = stem.get(stem.len().saturating_sub(36)..).unwrap_or(&stem);
    let mut session = Session::new(AgentProgram::Codex, fallback, path, paths);
    let mut guardian = false;
    let mut identified = false;
    crate::each_line(path, |line| {
        if guardian || SKIPPED.iter().any(|skip| line.contains(skip)) {
            return;
        }
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return;
        };
        if let Some(at) = record["timestamp"].as_str() {
            session.time(at);
        }
        let payload = &record["payload"];
        match record["type"].as_str().unwrap_or_default() {
            "session_meta" if !identified => {
                identified = true;
                guardian = meta(payload, &mut session);
            }
            "turn_context" => {
                session.cwd(payload["cwd"].as_str().unwrap_or_default());
                session.model(payload["model"].as_str().unwrap_or_default());
            }
            "response_item" => item(payload, &mut session),
            _ => {}
        }
    })?;
    if guardian {
        return Ok(None);
    }
    if let Some(title) = titles.get(&session.session_id) {
        session.title(title, 3);
    }
    Ok(Some(session))
}

/// The session's id, parent, folder and branch. Returns whether it is an approval guardian's.
fn meta(payload: &Value, session: &mut Session) -> bool {
    if let Some(id) = payload["id"].as_str().filter(|id| !id.is_empty()) {
        session.session_id = id.to_owned();
    }
    let spawned = &payload["source"]["subagent"];
    if !spawned.is_null() {
        session.subagent = true;
    }
    let parent = payload["parent_thread_id"]
        .as_str()
        .or_else(|| spawned["thread_spawn"]["parent_thread_id"].as_str());
    if let Some(parent) = parent.filter(|p| !p.is_empty()) {
        session.parent = Some(format!("codex:{parent}"));
    }
    session.cwd(payload["cwd"].as_str().unwrap_or_default());
    session.branch(payload["git"]["branch"].as_str().unwrap_or_default());
    spawned["other"] == "guardian"
}

fn item(payload: &Value, session: &mut Session) {
    match payload["type"].as_str().unwrap_or_default() {
        "message" => {
            let text = texts(&payload["content"]);
            match payload["role"].as_str().unwrap_or_default() {
                "user" => session.prompt(&text),
                "assistant" => session.answer(&text, true),
                _ => {}
            }
        }
        "agent_message" => session.answer(&texts(&payload["content"]), false),
        "function_call" => {
            let name = payload["name"].as_str().unwrap_or_default();
            match payload["namespace"].as_str().filter(|ns| !ns.is_empty()) {
                Some(namespace) => session.tool(&format!("{namespace}.{name}")),
                None => session.tool(name),
            }
            let args = payload["arguments"].as_str().unwrap_or_default();
            code(args, session);
        }
        "custom_tool_call" => {
            let input = payload["input"].as_str().unwrap_or_default();
            let mut called = false;
            for caps in TOOL.captures_iter(input) {
                session.tool(&caps[1]);
                called = true;
            }
            if !called {
                session.tool(payload["name"].as_str().unwrap_or_default());
            }
            code(input, session);
        }
        _ => {}
    }
}

/// A tool call's input: the files a patch changes, the tickets and pull requests it names.
fn code(input: &str, session: &mut Session) {
    for caps in PATCHED.captures_iter(input) {
        session.path(&caps[1], AgentLinkRel::Edited);
    }
    session.command(input);
}

/// The text parts of a message's content, joined.
fn texts(content: &Value) -> String {
    let parts = content.as_array().into_iter().flatten();
    let texts: Vec<&str> = parts.filter_map(|part| part["text"].as_str()).collect();
    texts.join("\n\n")
}
