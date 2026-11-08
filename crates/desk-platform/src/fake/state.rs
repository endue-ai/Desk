//! What the fake platform keeps: tokens it accepts, agents with their facets, the catalog,
//! conversations, a failure to answer next, a delay, and the requests it saw.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use serde_json::{Value, json};

use super::Seen;

/// One agent and its facets.
#[derive(Debug, Clone, PartialEq)]
pub struct FakeAgent {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub status: String,
    /// Another person's agent: every call about it is 403.
    pub foreign: bool,
    pub description: Option<String>,
    pub role: String,
    pub languages: Vec<String>,
    pub personality: Value,
    pub personal_color: Option<String>,
    pub source_catalog: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    /// Every revision, oldest first: `{ rev, content, source, restored_from_rev?, created_at }`.
    pub revisions: Vec<Value>,
    pub active_rev: Option<u64>,
    pub visibility: String,
    pub model: Option<String>,
    pub skills: Vec<Value>,
    pub connectors: Vec<Value>,
    pub traits: Vec<Value>,
}

#[derive(Debug)]
pub struct State {
    pub seen: Vec<Seen>,
    pub tokens: BTreeSet<String>,
    pub agents: Vec<FakeAgent>,
    pub catalog: Vec<Value>,
    pub conversations: Vec<Value>,
    /// The next answer, whatever is asked: status, code and message of an error envelope.
    pub fail_next: Option<(u16, String, String)>,
    /// Paths (without query) answered with an error envelope every time: status, code, message.
    pub fail_at: BTreeMap<String, (u16, String, String)>,
    /// How long every answer waits.
    pub delay: Option<Duration>,
    pub(super) clock: u64,
}

impl State {
    pub(super) fn new() -> Self {
        Self {
            seen: Vec::new(),
            tokens: BTreeSet::from(["token-1".to_owned()]),
            agents: Vec::new(),
            catalog: vec![catalog_agent()],
            conversations: Vec::new(),
            fail_next: None,
            fail_at: BTreeMap::new(),
            delay: None,
            clock: 0,
        }
    }

    /// A timestamp later than every one before it.
    pub(super) fn tick(&mut self) -> String {
        self.clock += 1;
        let (minute, second) = (self.clock / 60 % 60, self.clock % 60);
        format!("2026-11-01T09:{minute:02}:{second:02}Z")
    }

    /// Accept `token` from now on.
    pub fn accept(&mut self, token: &str) {
        self.tokens.insert(token.to_owned());
    }

    /// Accept no token any more, as when endue ID revoked them.
    pub fn refuse(&mut self, token: &str) {
        self.tokens.remove(token);
    }

    /// Answer the next request with an error envelope.
    pub fn fail_next(&mut self, status: u16, code: &str, message: &str) {
        self.fail_next = Some((status, code.to_owned(), message.to_owned()));
    }

    /// Answer every request to `path` with an error envelope from now on.
    pub fn fail_at(&mut self, path: &str, status: u16, code: &str, message: &str) {
        let error = (status, code.to_owned(), message.to_owned());
        self.fail_at.insert(path.to_owned(), error);
    }

    /// Seed an agent of the person's with `name` and role; its id.
    pub fn add_agent(&mut self, name: &str, role: &str) -> String {
        let id = format!("ag_{:026}", self.agents.len() + 1);
        let at = self.tick();
        let slug = slug_of(name, self.agents.len() + 1);
        self.agents.push(FakeAgent {
            id: id.clone(),
            slug,
            name: name.to_owned(),
            status: "active".to_owned(),
            foreign: false,
            description: None,
            role: role.to_owned(),
            languages: vec!["en".to_owned()],
            personality: json!({
                "v": "1.0", "tone": 0.7, "agency": 0.3, "thinking": 0.2, "rigor": 0.85,
                "expression": 0.7, "humor": 0.15, "integrity": 0.85, "epistemic_humility": 0.65
            }),
            personal_color: Some("#B6A3F5".to_owned()),
            source_catalog: None,
            created_at: at.clone(),
            updated_at: at,
            revisions: Vec::new(),
            active_rev: None,
            visibility: "private".to_owned(),
            model: None,
            skills: Vec::new(),
            connectors: Vec::new(),
            traits: Vec::new(),
        });
        id
    }

    /// Seed another person's agent; its id.
    pub fn add_foreign_agent(&mut self, name: &str) -> String {
        let id = self.add_agent(name, "someone else's");
        if let Some(agent) = self.agents.last_mut() {
            agent.foreign = true;
        }
        id
    }

    pub fn agent(&self, id: &str) -> Option<&FakeAgent> {
        self.agents.iter().find(|a| a.id == id)
    }

    pub(super) fn agent_mut(&mut self, id: &str) -> Option<&mut FakeAgent> {
        self.agents.iter_mut().find(|a| a.id == id)
    }

    /// Seed a conversation with `agent_id`: its last run's status and whether it waits; its id.
    pub fn add_conversation(
        &mut self,
        agent_id: &str,
        title: &str,
        run: Option<&str>,
        awaiting: bool,
    ) -> String {
        let id = format!("cnv_{}", self.conversations.len() + 1);
        let at = self.tick();
        let mut conversation = json!({
            "id": id, "agent_id": agent_id, "owner_id": "usr_1", "title": title,
            "status": "active", "message_count": 2, "last_message_at": at,
            "last_message_preview": format!("About {title}"), "awaiting_input": awaiting,
            "created_at": at, "updated_at": at, "space_id": null
        });
        if let Some(run) = run {
            conversation["last_run_status"] = json!(run);
            if run == "failed" {
                conversation["last_run_error_code"] = json!("LLM_TIMEOUT");
            }
        }
        // The most recently active first, as ai-agent-service sorts them.
        self.conversations.insert(0, conversation);
        id
    }
}

/// The slug endue AI derives from a name.
pub(super) fn slug_of(name: &str, n: usize) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_owned();
    if slug.is_empty() {
        format!("agent-{n}")
    } else {
        slug
    }
}

fn catalog_agent() -> Value {
    let l10n = |en: &str, ko: &str| json!({ "en": en, "ko": ko });
    json!({
        "id": "cat_support_mail", "slug": "support-mail", "category": "support", "tags": ["mail"],
        "featured": true, "publisher": { "kind": "official", "name": "endue" }, "version": 3,
        "manifest": {
            "identity": {
                "name": "Mailie", "role": l10n("Support mail", "고객 메일"),
                "avatar_url": "https://cdn.endue.ai/c/mailie.png"
            },
            "tagline": l10n("Answers support mail", "고객 문의 메일에 답해요"),
            "description": l10n("Reads and answers.", "읽고 답해요."),
            "strengths": [l10n("Fast", "빨라요")],
            "use_cases": [{
                "title": l10n("Refunds", "환불"),
                "example": l10n("Answer this refund mail", "이 환불 메일에 답해 줘")
            }],
            "connectors": [{ "type": "gmail", "required": true }],
            "channels": ["web", "slack"],
            "preset": { "traits": ["personality"], "skills": ["mail-triage"], "model": null }
        },
        "published_at": "2026-10-01T00:00:00Z"
    })
}
