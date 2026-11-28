//! One session while its transcript is read, and the record item it becomes.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use desk_bridge::{
    AgentLinkKind, AgentLinkPlace, AgentLinkRel, AgentProgram, AgentSessionFields, Item,
    ItemSource, RecordItem, RecordItemKind,
};

use crate::links::{Links, Paths};
use crate::text::{clip, first_line, is_harness, redact, strip_injected};
use crate::time::{has_offset, rfc3339};

/// The `$id` of `specs/item/v0/agent-session.schema.json`, every session item's `schema`.
pub const SCHEMA: &str = "https://endue.ai/specs/item/v0/agent-session.schema.json";
/// The built-in connector the items come from, and its one instance.
pub const CONNECTOR: &str = "desk.agent-sessions";
pub const INSTANCE: &str = "default";

/// Characters kept of one prompt, of the last answer, and of the whole body.
const PROMPT_CHARS: usize = 1200;
const ANSWER_CHARS: usize = 2000;
const BODY_CHARS: usize = 16_000;
const TITLE_CHARS: usize = 120;
const TOOLS: usize = 20;

/// A session being read. Adapters feed it; `into_item` makes the record.
#[derive(Debug)]
pub struct Session {
    pub agent: AgentProgram,
    pub session_id: String,
    pub parent: Option<String>,
    pub subagent: bool,
    paths: Paths,
    file: String,
    modified_ms: u64,
    title: Option<(u8, String)>,
    cwd: Option<String>,
    branch: Option<String>,
    model: Option<String>,
    started: Option<String>,
    ended: Option<String>,
    prompts: Vec<String>,
    prompt_chars: usize,
    turns: u64,
    answer: Option<String>,
    tools: BTreeMap<String, u64>,
    tool_calls: u64,
    mcp: BTreeSet<String>,
    skills: BTreeSet<String>,
    pub links: Links,
}

impl Session {
    pub fn new(agent: AgentProgram, session_id: &str, file: &Path, paths: &Paths) -> Self {
        Self {
            agent,
            session_id: session_id.to_owned(),
            parent: None,
            subagent: false,
            paths: paths.clone(),
            file: paths.tilde(&file.to_string_lossy()),
            modified_ms: 0,
            title: None,
            cwd: None,
            branch: None,
            model: None,
            started: None,
            ended: None,
            prompts: Vec::new(),
            prompt_chars: 0,
            turns: 0,
            answer: None,
            tools: BTreeMap::new(),
            tool_calls: 0,
            mcp: BTreeSet::new(),
            skills: BTreeSet::new(),
            links: Links::default(),
        }
    }

    pub fn modified(&mut self, ms: u64) {
        self.modified_ms = ms;
    }

    /// A title the program gave; a higher `rank` wins, a later one of the same rank too.
    pub fn title(&mut self, text: &str, rank: u8) {
        let Some(line) = first_line(&redact(text), TITLE_CHARS) else {
            return;
        };
        if self.title.as_ref().is_none_or(|(held, _)| rank >= *held) {
            self.title = Some((rank, line));
        }
    }

    /// A time from the transcript; the first and the last make the session's span.
    pub fn time(&mut self, at: &str) {
        if !has_offset(at) {
            return;
        }
        if self.started.as_deref().is_none_or(|first| at < first) {
            self.started = Some(at.to_owned());
        }
        if self.ended.as_deref().is_none_or(|last| at > last) {
            self.ended = Some(at.to_owned());
        }
    }

    /// The folder the session works in; the first one holds.
    pub fn cwd(&mut self, cwd: &str) {
        if self.cwd.is_none() && !cwd.is_empty() {
            self.cwd = Some(cwd.to_owned());
        }
    }

    /// The branch the session runs on; the last one holds.
    pub fn branch(&mut self, branch: &str) {
        if !branch.is_empty() && branch != "HEAD" {
            self.branch = Some(branch.to_owned());
        }
    }

    pub fn model(&mut self, model: &str) {
        if !model.is_empty() && !model.starts_with('<') {
            self.model = Some(model.to_owned());
        }
    }

    /// Something the person wrote. Injected blocks and harness messages are not prompts.
    pub fn prompt(&mut self, text: &str) {
        let text = strip_injected(text);
        if text.is_empty() || is_harness(&text) {
            return;
        }
        self.turns += 1;
        self.links.scan(&text, AgentLinkPlace::Prompt);
        if self.title.is_none() && self.prompts.is_empty() {
            self.title = first_line(&redact(&text), TITLE_CHARS).map(|line| (0, line));
        }
        if self.prompt_chars < BODY_CHARS - ANSWER_CHARS {
            let kept = clip(&redact(&text), PROMPT_CHARS);
            self.prompt_chars += kept.chars().count() + 2;
            self.prompts.push(kept);
        }
    }

    /// Something the agent answered; the last one is kept.
    pub fn answer(&mut self, text: &str, last: bool) {
        let text = strip_injected(text);
        if text.is_empty() {
            return;
        }
        self.links.scan(&text, AgentLinkPlace::Answer);
        if last {
            self.answer = Some(clip(&redact(&text), ANSWER_CHARS));
        }
    }

    /// A tool call by name; `mcp__<server>__<tool>` names its server.
    pub fn tool(&mut self, name: &str) {
        if name.is_empty() {
            return;
        }
        self.tool_calls += 1;
        *self.tools.entry(name.to_owned()).or_default() += 1;
        if let Some(server) = name
            .strip_prefix("mcp__")
            .and_then(|r| r.split("__").next())
        {
            self.mcp(server);
        }
    }

    pub fn mcp(&mut self, server: &str) {
        if !server.is_empty() && self.mcp.len() < 50 {
            self.mcp.insert(clip(server, 200));
        }
    }

    pub fn skill(&mut self, skill: &str) {
        if !skill.is_empty() && self.skills.len() < 50 {
            self.skills.insert(clip(skill, 200));
        }
    }

    /// A command a tool ran: the tickets and pull requests it names.
    pub fn command(&mut self, text: &str) {
        self.links.scan(text, AgentLinkPlace::Tool);
    }

    /// A file a tool changed or read; a relative path is under the session's folder.
    pub fn path(&mut self, path: &str, rel: AgentLinkRel) {
        let path = path.trim();
        if path.is_empty() {
            return;
        }
        let full = match (path.starts_with('/'), self.cwd.as_deref()) {
            (false, Some(cwd)) => format!("{}/{path}", cwd.trim_end_matches('/')),
            _ => path.to_owned(),
        };
        self.links.path(&self.paths, &full, rel);
    }

    /// Whether the transcript held anything worth an item.
    pub fn is_empty(&self) -> bool {
        self.turns == 0 && self.tool_calls == 0 && self.answer.is_none()
    }

    /// The record item: id `<agent>:<session id>`, the fields of agent-session v0.
    pub fn into_item(self) -> Item {
        let agent = agent_name(self.agent);
        let repo = self.cwd.as_deref().map(|cwd| self.paths.fold(cwd));
        let mut links = self.links;
        if let Some(repo) = &repo {
            links.add(AgentLinkKind::Repo, repo, AgentLinkRel::In, None);
            if let Some(branch) = &self.branch {
                let key = format!("{repo}@{branch}");
                links.add(AgentLinkKind::Branch, &key, AgentLinkRel::On, None);
            }
        }
        if let Some(branch) = &self.branch {
            links.branch(branch);
        }
        let (links, domains) = links.finish(repo.as_deref());
        let mut tools: Vec<(String, u64)> = self.tools.into_iter().collect();
        tools.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        tools.truncate(TOOLS);
        let modified = rfc3339(self.modified_ms);
        let fields = AgentSessionFields {
            agent: self.agent,
            session_id: self.session_id.clone(),
            parent: self.parent,
            subagent: self.subagent,
            file: self.file.clone(),
            cwd: self.cwd.as_deref().map(|cwd| self.paths.tilde(cwd)),
            repo,
            branch: self.branch,
            model: self.model,
            started_at: self.started.clone(),
            ended_at: self.ended.clone(),
            turns: self.turns,
            tool_calls: Some(self.tool_calls),
            tools: (!tools.is_empty()).then(|| tools.into_iter().collect()),
            mcp: (!self.mcp.is_empty()).then(|| self.mcp.into_iter().collect()),
            skills: (!self.skills.is_empty()).then(|| self.skills.into_iter().collect()),
            domains: (!domains.is_empty()).then_some(domains),
            links,
        };
        let fields = match serde_json::to_value(fields) {
            Ok(serde_json::Value::Object(map)) => map,
            _ => serde_json::Map::new(),
        };
        let mut body = self.prompts.join("\n\n");
        if let Some(answer) = self.answer {
            body.push_str("\n\n---\n\n");
            body.push_str(&answer);
        }
        let untitled = format!("{} session {}", program_title(self.agent), self.session_id);
        Item::Record(RecordItem {
            id: format!("{agent}:{}", self.session_id),
            source: ItemSource {
                connector: CONNECTOR.to_owned(),
                instance: INSTANCE.to_owned(),
            },
            kind: RecordItemKind::Record,
            title: self.title.map_or(untitled, |(_, title)| title),
            updated_at: self.ended.unwrap_or_else(|| modified.clone()),
            created_at: self.started,
            deep_link: Some(file_url(&self.paths, &self.file)),
            body: (!body.is_empty()).then(|| clip(&body, BODY_CHARS)),
            raw: None,
            schema: SCHEMA.to_owned(),
            fields,
        })
    }
}

/// The id prefix of a program's sessions.
pub fn agent_name(agent: AgentProgram) -> &'static str {
    match agent {
        AgentProgram::Claude => "claude",
        AgentProgram::Codex => "codex",
        AgentProgram::Hermes => "hermes",
    }
}

fn program_title(agent: AgentProgram) -> &'static str {
    match agent {
        AgentProgram::Claude => "Claude Code",
        AgentProgram::Codex => "Codex",
        AgentProgram::Hermes => "Hermes",
    }
}

/// A `file://` URL for a `~` path, every byte but `A-Za-z0-9-._~/` percent-encoded.
fn file_url(paths: &Paths, tilde: &str) -> String {
    let full = paths.untilde(tilde);
    let mut url = String::from("file://");
    for byte in full.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/".contains(&byte) {
            url.push(char::from(byte));
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url
}
