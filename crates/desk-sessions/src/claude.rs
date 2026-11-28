//! Claude Code transcripts: `<config>/projects/<project>/<session>.jsonl`, one JSON record a line,
//! and each subagent's in `<session>/subagents/<agent>.jsonl`.

use std::io;
use std::path::Path;

use desk_bridge::{AgentLinkRel, AgentProgram};
use serde_json::Value;

use crate::links::Paths;
use crate::session::Session;

/// Tools that change a file, and the input field naming it.
const EDITS: &[(&str, &str)] = &[
    ("Edit", "file_path"),
    ("MultiEdit", "file_path"),
    ("Write", "file_path"),
    ("NotebookEdit", "notebook_path"),
];

/// Records the knowledge base never needs, told by their type before they are parsed: tool output,
/// attachments, request copies, file backups. Most of a transcript's bytes are these.
const SKIPPED: &[&str] = &[
    "\"tool_use_id\":",
    "\"type\":\"attachment\"",
    "\"type\":\"api-request",
    "\"type\":\"file-history-",
    "\"type\":\"queue-operation\"",
];

/// Read one transcript. `parent` is the session a subagent's transcript sits under.
pub fn read(path: &Path, parent: Option<&str>, paths: &Paths) -> io::Result<Session> {
    let id = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut session = Session::new(AgentProgram::Claude, &id, path, paths);
    if let Some(parent) = parent {
        session.parent = Some(format!("claude:{parent}"));
        session.subagent = true;
    }
    crate::each_line(path, |line| {
        if SKIPPED.iter().any(|skip| line.contains(skip)) {
            return;
        }
        if let Ok(record) = serde_json::from_str::<Value>(line) {
            record_into(&record, &mut session);
        }
    })?;
    Ok(session)
}

fn record_into(record: &Value, session: &mut Session) {
    if let Some(at) = record["timestamp"].as_str() {
        session.time(at);
    }
    if let Some(cwd) = record["cwd"].as_str() {
        session.cwd(cwd);
    }
    if let Some(branch) = record["gitBranch"].as_str() {
        session.branch(branch);
    }
    match record["type"].as_str().unwrap_or_default() {
        "custom-title" => session.title(record["customTitle"].as_str().unwrap_or_default(), 3),
        "summary" => session.title(record["summary"].as_str().unwrap_or_default(), 2),
        "agent-name" => session.title(record["agentName"].as_str().unwrap_or_default(), 1),
        "pr-link" => pr_link(record, session),
        "user" => user(record, session),
        "assistant" => assistant(record, session),
        _ => {}
    }
}

/// A pull request the session opened: its URL, or the repository and number.
fn pr_link(record: &Value, session: &mut Session) {
    let url = record["prUrl"].as_str().unwrap_or_default();
    if session.links.opened(url) {
        return;
    }
    if let (Some(repo), Some(number)) =
        (record["prRepository"].as_str(), record["prNumber"].as_u64())
    {
        session
            .links
            .opened(&format!("https://github.com/{repo}/pull/{number}"));
    }
}

/// The person's message, unless the harness wrote it or it carries tool output only.
fn user(record: &Value, session: &mut Session) {
    let flagged = ["isMeta", "isCompactSummary", "isVisibleInTranscriptOnly"];
    if flagged
        .iter()
        .any(|flag| record[flag].as_bool() == Some(true))
    {
        return;
    }
    let content = &record["message"]["content"];
    if let Some(text) = content.as_str() {
        session.prompt(text);
        return;
    }
    let texts: Vec<&str> = content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    if !texts.is_empty() {
        session.prompt(&texts.join("\n\n"));
    }
}

/// The agent's turn: its model, its text and its tool calls.
fn assistant(record: &Value, session: &mut Session) {
    let message = &record["message"];
    if let Some(model) = message["model"].as_str() {
        session.model(model);
    }
    for block in message["content"].as_array().into_iter().flatten() {
        match block["type"].as_str().unwrap_or_default() {
            "text" => session.answer(block["text"].as_str().unwrap_or_default(), true),
            "tool_use" => tool_use(block, session),
            _ => {}
        }
    }
}

fn tool_use(block: &Value, session: &mut Session) {
    let name = block["name"].as_str().unwrap_or_default();
    let input = &block["input"];
    session.tool(name);
    if let Some((_, field)) = EDITS.iter().find(|(tool, _)| *tool == name) {
        if let Some(path) = input[field].as_str() {
            session.path(path, AgentLinkRel::Edited);
        }
        return;
    }
    match name {
        "Read" => {
            if let Some(path) = input["file_path"].as_str() {
                session.path(path, AgentLinkRel::Read);
            }
        }
        "Bash" => session.command(input["command"].as_str().unwrap_or_default()),
        "Skill" => session.skill(input["skill"].as_str().unwrap_or_default()),
        _ => {}
    }
}
