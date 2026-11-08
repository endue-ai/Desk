//! Codex's sessions: one JSON-lines "rollout" per session in `<codex home>/sessions/YYYY/MM/DD/`,
//! archived ones in `<codex home>/archived_sessions/`, older ones compressed as `.jsonl.zst`. The
//! first line is `session_meta` (id, folder, start, version, git); turns are `response_item`
//! messages and tool calls. `session_index.jsonl` keeps each session's title (`thread_name`).

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use desk_bridge::{LocalAgentId, LocalAgentRole, LocalAgentSession};
use serde_json::Value;

use super::claude::{children, describe};
use super::lines::{self, text};
use super::{Found, LocalAgents, Turns, is_session_id, timestamp, title_of};

/// How much of a rollout listing reads from its start: the instructions Codex writes first are long.
/// A compressed one is read less far, since every byte of it is decoded; its title is the index's.
const HEAD: u64 = 256 * 1024;
/// How deep `sessions/` nests (year, month, day).
const DEPTH: usize = 4;

/// What the user lines Codex writes itself start with; they are not what the person asked.
const OWN: [&str; 6] = [
    "<environment_context>",
    "<user_instructions>",
    "<permissions",
    "# AGENTS.md",
    "<turn_aborted>",
    "<user_shell_command>",
];

/// Titles and last activity by session id, from `session_index.jsonl`.
#[derive(Default, Clone)]
pub(crate) struct Index {
    stamp: (u64, u64),
    titles: HashMap<String, (String, Option<String>)>,
}

/// Every rollout, live and archived, read through the cache.
pub(super) fn scan(agents: &LocalAgents) -> Vec<Found> {
    let home = &agents.options.codex_home;
    let index = index(agents, &home.join("session_index.jsonl"));
    let mut files = Vec::new();
    walk(&home.join("sessions"), DEPTH, &mut files);
    let live = files.len();
    walk(&home.join("archived_sessions"), 1, &mut files);
    let mut found = Vec::new();
    for (n, file) in files.into_iter().enumerate() {
        let Some(mut f) = agents.summary(&file, summarize) else {
            continue;
        };
        f.session.archived = n >= live;
        if let Some((title, updated)) = index.titles.get(&f.session.id) {
            f.session.title = title_of(title);
            if let Some(at) = updated
                && *at > f.session.updated_at
            {
                f.session.updated_at = at.clone();
            }
        }
        found.push(f);
    }
    found
}

/// The rollout files under `dir`, `depth` folders deep at most.
fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    for path in children(dir) {
        if path.is_dir() {
            if depth > 1 {
                walk(&path, depth - 1, out);
            }
        } else if id_of(&path).is_some() {
            out.push(path);
        }
    }
}

/// The session id in a rollout's name: `rollout-<YYYY-MM-DDTHH-MM-SS>-<id>.jsonl[.zst]`.
pub(super) fn id_of(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stem = name
        .strip_suffix(".jsonl.zst")
        .or_else(|| name.strip_suffix(".jsonl"))?;
    let rest = stem.strip_prefix("rollout-")?;
    let id = rest
        .get(20..)
        .filter(|_| rest.as_bytes().get(19) == Some(&b'-'))?;
    is_session_id(id).then(|| id.to_owned())
}

fn summarize(path: &Path, size: u64, modified: u64) -> Option<LocalAgentSession> {
    let id = id_of(path)?;
    let mut session = LocalAgentSession {
        id,
        agent: LocalAgentId::Codex,
        title: String::new(),
        cwd: None,
        branch: None,
        started_at: None,
        updated_at: String::new(),
        archived: false,
        imported: false,
        imported_at: None,
        size,
        version: None,
        model: None,
    };
    let compressed = lines::compressed(path);
    let head = if compressed { lines::EDGE } else { HEAD };
    // A file the head reads whole is read to its end for its last time; a longer one's last time
    // is its tail's, so its head stops once the session, its model and its first prompt are known.
    let whole = !compressed && size <= head;
    let mut meta = false;
    let mut last: Option<String> = None;
    lines::head_each(path, head, |line| {
        read_head(&mut session, &line, &mut meta);
        let at = text(&line, &["timestamp"]).and_then(timestamp);
        last = last.take().max(at);
        whole || !(meta && session.model.is_some() && !session.title.is_empty())
    })
    .ok()?;
    let tail = lines::tail(path, size, head).ok()?;
    let tail_last = tail
        .iter()
        .filter_map(|line| text(line, &["timestamp"]).and_then(timestamp))
        .max();
    let last = if whole { last } else { tail_last };
    session.updated_at = last.unwrap_or_else(|| crate::time::rfc3339(modified));
    Some(session)
}

/// What one line of a rollout's start says of its session.
fn read_head(session: &mut LocalAgentSession, line: &Value, meta: &mut bool) {
    let payload = &line["payload"];
    match text(line, &["type"]) {
        Some("session_meta") => {
            *meta = true;
            if let Some(id) = text(payload, &["id"]).filter(|id| is_session_id(id)) {
                session.id = id.to_owned();
            }
            let set = |field: &mut Option<String>, value: Option<&str>| {
                if let Some(v) = value {
                    *field = Some(v.to_owned());
                }
            };
            set(&mut session.cwd, text(payload, &["cwd"]));
            set(&mut session.version, text(payload, &["cli_version"]));
            set(&mut session.branch, text(payload, &["git", "branch"]));
            let at = text(line, &["timestamp"]);
            session.started_at = text(payload, &["timestamp"]).or(at).and_then(timestamp);
        }
        Some("turn_context") => {
            if let Some(model) = text(payload, &["model"]) {
                session.model = Some(model.to_owned());
            }
        }
        Some("response_item") if session.title.is_empty() => {
            if let Some(said) = said(payload, "user") {
                session.title = title_of(&said);
            }
        }
        _ => {}
    }
}

/// The text of a `message` payload from `role`, unless it is one Codex writes itself.
fn said(payload: &Value, role: &str) -> Option<String> {
    if payload["type"] != "message" || payload["role"] != role {
        return None;
    }
    let kind = if role == "user" {
        "input_text"
    } else {
        "output_text"
    };
    let words: Vec<&str> = payload["content"]
        .as_array()?
        .iter()
        .filter(|b| b["type"] == kind)
        .filter_map(|b| b["text"].as_str())
        .collect();
    let said = words.join("\n");
    let said = said.trim();
    let own = role == "user" && OWN.iter().any(|p| said.starts_with(p));
    (!said.is_empty() && !own).then(|| said.to_owned())
}

/// Every turn of the rollout, to `turns`.
pub(super) fn turns(path: &Path, turns: &mut Turns) -> io::Result<()> {
    lines::each(path, |line| {
        if line["type"] != "response_item" {
            return;
        }
        let payload = &line["payload"];
        let at = text(line, &["timestamp"]);
        if let Some(said) = said(payload, "user") {
            turns.push(LocalAgentRole::User, &said, None, at);
        } else if let Some(said) = said(payload, "assistant") {
            turns.push(LocalAgentRole::Assistant, &said, None, at);
        } else if matches!(
            payload["type"].as_str(),
            Some("function_call" | "custom_tool_call")
        ) {
            let name = payload["name"].as_str().unwrap_or("tool");
            let input = payload.get("arguments").or_else(|| payload.get("input"));
            let input = input.cloned().unwrap_or(Value::Null);
            let parsed = input
                .as_str()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .filter(Value::is_object)
                .unwrap_or(input);
            turns.push(LocalAgentRole::Tool, &describe(&parsed), Some(name), at);
        }
    })
}

/// The session index, read again only when it changed.
fn index(agents: &LocalAgents, path: &Path) -> Index {
    let Ok(meta) = fs::metadata(path) else {
        return Index::default();
    };
    let stamp = (meta.len(), meta.modified().map(super::seconds).unwrap_or(0));
    let mut cached = crate::sync::lock(&agents.codex_index);
    if cached.stamp == stamp && !cached.titles.is_empty() {
        return cached.clone();
    }
    let mut titles = HashMap::new();
    let _ = lines::each(path, |line| {
        let (Some(id), Some(name)) = (text(line, &["id"]), text(line, &["thread_name"])) else {
            return;
        };
        let updated = text(line, &["updated_at"]).and_then(timestamp);
        titles.insert(id.to_owned(), (name.to_owned(), updated));
    });
    *cached = Index { stamp, titles };
    cached.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_rollout_name_holds_the_session_id() {
        let id = "01a120a3-f590-7b40-8e0f-7df5c5b69f4f";
        let name = format!("rollout-2026-10-09T21-29-38-{id}.jsonl");
        assert_eq!(id_of(Path::new(&name)).as_deref(), Some(id));
        assert_eq!(
            id_of(Path::new(&format!("{name}.zst"))).as_deref(),
            Some(id)
        );
        assert_eq!(id_of(Path::new("rollout-short.jsonl")), None);
        assert_eq!(id_of(Path::new("notes.jsonl")), None);
    }

    #[test]
    fn codexs_own_lines_are_not_what_the_person_asked() {
        let user = |t: &str| {
            json!({ "type": "message", "role": "user",
            "content": [{ "type": "input_text", "text": t }] })
        };
        assert_eq!(
            said(
                &user("<environment_context>cwd</environment_context>"),
                "user"
            ),
            None
        );
        assert_eq!(said(&user("# AGENTS.md instructions"), "user"), None);
        assert_eq!(
            said(&user("Rename the loader"), "user").as_deref(),
            Some("Rename the loader")
        );
        let answer = json!({ "type": "message", "role": "assistant",
            "content": [{ "type": "output_text", "text": "Done." }] });
        assert_eq!(said(&answer, "assistant").as_deref(), Some("Done."));
    }
}
