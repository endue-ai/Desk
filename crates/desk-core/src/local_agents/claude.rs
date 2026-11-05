//! Claude Code's sessions: one JSON-lines file per session in `<claude home>/projects/<folder>/
//! <id>.jsonl`, where each line is a turn (`user`, `assistant`) or a note about the session (its
//! title in `ai-title`, `custom-title` or the older `summary`). Claude Code has no archive of its
//! own; the Claude desktop app keeps, per session it started, whether it is archived and its title
//! in `<app data>/Claude/claude-code-sessions/<account>/<org>/local_<id>.json`, which names the CLI
//! session as `cliSessionId`.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use desk_bridge::{LocalAgentId, LocalAgentRole, LocalAgentSession};
use serde_json::Value;

use super::lines::{self, text};
use super::{Found, LocalAgents, Turns, is_session_id, timestamp, title_of};

/// What the desktop app says of one CLI session.
#[derive(Debug, Clone, Default)]
pub(crate) struct Desktop {
    archived: bool,
    title: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    active_at: Option<u64>,
}

/// Every session file, read through the cache, with what the desktop app says of it.
pub(super) fn scan(agents: &LocalAgents) -> Vec<Found> {
    let desktop = desktop(agents);
    let projects = agents.options.claude_home.join("projects");
    let mut found = Vec::new();
    for folder in children(&projects).into_iter().filter(|p| p.is_dir()) {
        for file in children(&folder) {
            let id = file
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            if file.extension().is_none_or(|e| e != "jsonl")
                || !is_session_id(id)
                || !file.is_file()
            {
                continue;
            }
            let Some(mut f) = agents.summary(&file, summarize) else {
                continue;
            };
            if let Some(d) = desktop.get(&f.session.id) {
                apply(&mut f.session, d);
            }
            found.push(f);
        }
    }
    found
}

/// The entries of a folder, sorted; none when it cannot be read.
pub(super) fn children(dir: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    paths.sort();
    paths
}

fn apply(session: &mut LocalAgentSession, d: &Desktop) {
    session.archived = d.archived;
    if let Some(title) = &d.title {
        session.title = title_of(title);
    }
    if session.cwd.is_none() {
        session.cwd.clone_from(&d.cwd);
    }
    if session.model.is_none() {
        session.model.clone_from(&d.model);
    }
    if let Some(at) = d.active_at.map(crate::time::rfc3339)
        && at > session.updated_at
    {
        session.updated_at = at;
    }
}

/// One session from the head and tail of its file.
fn summarize(path: &Path, size: u64, modified: u64) -> Option<LocalAgentSession> {
    let id = path.file_stem()?.to_str()?.to_owned();
    let mut lines = lines::head(path, lines::EDGE).ok()?;
    lines.extend(lines::tail(path, size, lines::EDGE).ok()?);
    let mut s = Summary::default();
    for line in &lines {
        s.read(line);
    }
    let title = s
        .title
        .or_else(|| s.prompt.as_deref().map(title_of))
        .unwrap_or_default();
    Some(LocalAgentSession {
        id,
        agent: LocalAgentId::Claude,
        title,
        cwd: s.cwd,
        branch: s.branch,
        started_at: s.first.clone(),
        updated_at: s.last.unwrap_or_else(|| crate::time::rfc3339(modified)),
        archived: false,
        imported: false,
        imported_at: None,
        size,
        version: s.version,
        model: s.model,
    })
}

#[derive(Default)]
struct Summary {
    title: Option<String>,
    prompt: Option<String>,
    cwd: Option<String>,
    branch: Option<String>,
    version: Option<String>,
    model: Option<String>,
    first: Option<String>,
    last: Option<String>,
}

impl Summary {
    fn read(&mut self, line: &Value) {
        match text(line, &["type"]) {
            Some("ai-title") => self.title_from(line, "aiTitle"),
            Some("custom-title") => self.title_from(line, "customTitle"),
            Some("summary") => self.title_from(line, "summary"),
            Some(kind @ ("user" | "assistant")) => {
                if line["isSidechain"] == true {
                    return;
                }
                let at = text(line, &["timestamp"]).and_then(timestamp);
                if self.first.is_none() {
                    self.first.clone_from(&at);
                }
                if at.is_some() && at > self.last {
                    self.last = at;
                }
                let latest = |field: &mut Option<String>, value: Option<&str>| {
                    if let Some(v) = value {
                        *field = Some(v.to_owned());
                    }
                };
                latest(&mut self.cwd, text(line, &["cwd"]));
                latest(
                    &mut self.branch,
                    text(line, &["gitBranch"]).filter(|b| *b != "HEAD"),
                );
                latest(&mut self.version, text(line, &["version"]));
                if kind == "assistant" {
                    latest(
                        &mut self.model,
                        text(line, &["message", "model"]).filter(|m| !m.starts_with('<')),
                    );
                } else if self.prompt.is_none() {
                    self.prompt = prompt(line);
                }
            }
            _ => {}
        }
    }

    fn title_from(&mut self, line: &Value, field: &str) {
        if let Some(title) = text(line, &[field]) {
            self.title = Some(title_of(title));
        }
    }
}

/// What the person asked in a `user` line: its text, unless it is the desk's own (meta lines,
/// slash commands and their output, tool results).
fn prompt(line: &Value) -> Option<String> {
    if line["isMeta"] == true {
        return None;
    }
    let content = &line["message"]["content"];
    let said = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => {
            let words: Vec<&str> = blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect();
            words.join("\n")
        }
        _ => return None,
    };
    let said = said.trim();
    let own = [
        "<command-",
        "<local-command",
        "<system-reminder>",
        "Caveat:",
        "<bash-",
    ];
    (!said.is_empty() && !own.iter().any(|p| said.starts_with(p))).then(|| said.to_owned())
}

/// Every turn of the session file, to `turns`.
pub(super) fn turns(path: &Path, turns: &mut Turns) -> io::Result<()> {
    lines::each(path, |line| {
        let kind = text(line, &["type"]);
        if !matches!(kind, Some("user" | "assistant")) || line["isSidechain"] == true {
            return;
        }
        let at = text(line, &["timestamp"]);
        if kind == Some("user") {
            if let Some(said) = prompt(line) {
                turns.push(LocalAgentRole::User, &said, None, at);
            }
            return;
        }
        for block in line["message"]["content"].as_array().into_iter().flatten() {
            match block["type"].as_str() {
                Some("text") => {
                    let said = block["text"].as_str().unwrap_or_default();
                    turns.push(LocalAgentRole::Assistant, said, None, at);
                }
                Some("tool_use") => {
                    let name = block["name"].as_str().unwrap_or("tool");
                    turns.push(
                        LocalAgentRole::Tool,
                        &describe(&block["input"]),
                        Some(name),
                        at,
                    );
                }
                _ => {}
            }
        }
    })
}

/// The start of a tool's input, for people: its command, path or query when it has one.
pub(super) fn describe(input: &Value) -> String {
    for key in [
        "command",
        "file_path",
        "path",
        "pattern",
        "query",
        "url",
        "description",
    ] {
        if let Some(value) = input[key].as_str() {
            return super::clip(value, 500).0;
        }
    }
    match input {
        Value::Null => String::new(),
        Value::String(s) => super::clip(s, 500).0,
        other => super::clip(&other.to_string(), 500).0,
    }
}

/// What the desktop app says of each CLI session, by CLI session id. Each metadata file is read
/// again only when it changed.
fn desktop(agents: &LocalAgents) -> HashMap<String, Desktop> {
    let Some(app_data) = &agents.options.app_data else {
        return HashMap::new();
    };
    let root = app_data.join("Claude").join("claude-code-sessions");
    let mut cache = crate::sync::lock(&agents.desktop);
    let mut seen = HashMap::new();
    for account in children(&root).into_iter().filter(|p| p.is_dir()) {
        for org in children(&account).into_iter().filter(|p| p.is_dir()) {
            for file in children(&org) {
                let name = file
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default();
                if !(name.starts_with("local_") && name.ends_with(".json")) {
                    continue;
                }
                let Ok(meta) = fs::metadata(&file) else {
                    continue;
                };
                let stamp = (meta.len(), meta.modified().map(super::seconds).unwrap_or(0));
                let entry = match cache.get(&file) {
                    Some((size, at, entry)) if (*size, *at) == stamp => entry.clone(),
                    _ => {
                        let entry = read_desktop(&file);
                        cache.insert(file.clone(), (stamp.0, stamp.1, entry.clone()));
                        entry
                    }
                };
                if let Some((id, d)) = entry {
                    seen.insert(id, d);
                }
            }
        }
    }
    seen
}

pub(crate) type DesktopCache = HashMap<PathBuf, (u64, u64, Option<(String, Desktop)>)>;

fn read_desktop(file: &Path) -> Option<(String, Desktop)> {
    let value: Value = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    let id = text(&value, &["cliSessionId"]).filter(|id| is_session_id(id))?;
    let millis = |key: &str| value[key].as_u64().map(|ms| ms / 1000);
    let d = Desktop {
        archived: value["isArchived"] == true,
        title: text(&value, &["title"]).map(str::to_owned),
        cwd: text(&value, &["cwd"]).map(str::to_owned),
        model: text(&value, &["model"]).map(str::to_owned),
        active_at: millis("lastActivityAt"),
    };
    Some((id.to_owned(), d))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_summary_takes_the_programs_title_else_the_first_real_prompt() {
        let mut s = Summary::default();
        s.read(&json!({ "type": "user", "isMeta": true, "message": { "content": "meta" } }));
        s.read(&json!({ "type": "user", "message": { "content": "<command-name>/clear</command-name>" } }));
        s.read(
            &json!({ "type": "user", "timestamp": "2026-11-04T10:00:00.5Z", "cwd": "/work/app",
            "gitBranch": "main", "version": "2.4.1",
            "message": { "content": [{ "type": "text", "text": "Fix the flaky test\nplease" }] } }),
        );
        s.read(
            &json!({ "type": "assistant", "timestamp": "2026-11-04T10:02:00Z",
            "message": { "model": "claude-opus-5-5", "content": [] } }),
        );
        assert_eq!(s.prompt.as_deref(), Some("Fix the flaky test\nplease"));
        assert_eq!(s.first.as_deref(), Some("2026-11-04T10:00:00Z"));
        assert_eq!(s.last.as_deref(), Some("2026-11-04T10:02:00Z"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));
        s.read(&json!({ "type": "ai-title", "aiTitle": "Flaky upload test" }));
        assert_eq!(s.title.as_deref(), Some("Flaky upload test"));
    }

    #[test]
    fn a_tool_is_described_by_its_command_or_path() {
        assert_eq!(describe(&json!({ "command": "pnpm test" })), "pnpm test");
        assert_eq!(
            describe(&json!({ "file_path": "/a/b.rs", "x": 1 })),
            "/a/b.rs"
        );
        assert_eq!(describe(&json!({ "n": 1 })), "{\"n\":1}");
    }
}
