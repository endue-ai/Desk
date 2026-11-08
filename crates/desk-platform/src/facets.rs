//! What Studio shows of one agent (agent-service): identity, settings, the prompt and its revisions,
//! skills, connectors and traits.

use desk_sys::net::Method;
use serde::Deserialize;
use serde_json::json;

use crate::Platform;
use crate::agents::agent_path;
use crate::error::Result;
use crate::http::with_query;
use crate::wire::{
    ConnectorBinding, Identity, PromptRevision, RevisionSummary, Settings, SettingsPatch,
    SkillBinding, Trait,
};

impl Platform {
    pub fn identity(&self, id: &str) -> Result<Identity> {
        let path = format!("{}/identity", agent_path(id));
        self.read(Method::Get, &path, None, "identity")
    }

    pub fn settings(&self, id: &str) -> Result<Settings> {
        let path = format!("{}/settings", agent_path(id));
        self.read(Method::Get, &path, None, "settings")
    }

    /// Change the visibility and the chat model; the answer is the settings now.
    pub fn update_settings(&self, id: &str, patch: &SettingsPatch) -> Result<Settings> {
        let path = format!("{}/settings", agent_path(id));
        self.read(Method::Patch, &path, Some(&patch.body()), "settings")
    }

    /// The revision in force; `None` while the agent has no prompt.
    pub fn prompt(&self, id: &str) -> Result<Option<PromptRevision>> {
        #[derive(Deserialize)]
        struct Answer {
            #[serde(default)]
            prompt: Option<PromptRevision>,
        }
        let path = format!("{}/prompt", agent_path(id));
        let answer: Answer = self.read(Method::Get, &path, None, "prompt")?;
        Ok(answer.prompt)
    }

    /// Save `content` as a new revision in force.
    pub fn save_prompt(&self, id: &str, content: &str) -> Result<PromptRevision> {
        let path = format!("{}/prompt", agent_path(id));
        let body = json!({ "content": content });
        self.read(Method::Put, &path, Some(&body), "prompt revision")
    }

    /// Put revision `rev` back in force as a new revision.
    pub fn restore_prompt(&self, id: &str, rev: u64) -> Result<PromptRevision> {
        let path = format!("{}/prompt/revisions/{rev}/restore", agent_path(id));
        self.read(Method::Post, &path, None, "prompt revision")
    }

    /// The newest `limit` revisions, newest first.
    pub fn prompt_revisions(&self, id: &str, limit: u64) -> Result<Vec<RevisionSummary>> {
        #[derive(Deserialize)]
        struct Answer {
            #[serde(default, deserialize_with = "crate::wire::nullable")]
            revisions: Vec<RevisionSummary>,
        }
        let base = format!("{}/prompt/revisions", agent_path(id));
        let path = with_query(&base, &[("limit", Some(limit.to_string()))]);
        let answer: Answer = self.read(Method::Get, &path, None, "prompt revisions")?;
        Ok(answer.revisions)
    }

    pub fn skills(&self, id: &str) -> Result<Vec<SkillBinding>> {
        let path = format!("{}/skills", agent_path(id));
        self.read(Method::Get, &path, None, "skills")
    }

    pub fn connectors(&self, id: &str) -> Result<Vec<ConnectorBinding>> {
        let path = format!("{}/connectors", agent_path(id));
        self.read(Method::Get, &path, None, "connectors")
    }

    pub fn traits(&self, id: &str) -> Result<Vec<Trait>> {
        #[derive(Deserialize)]
        struct Answer {
            #[serde(default, deserialize_with = "crate::wire::nullable")]
            traits: Vec<Trait>,
        }
        let path = format!("{}/traits", agent_path(id));
        let answer: Answer = self.read(Method::Get, &path, None, "traits")?;
        Ok(answer.traits)
    }
}
