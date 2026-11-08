//! The person's agents (agent-service): list, get, create, update, set status, delete.

use std::collections::BTreeSet;

use desk_sys::net::Method;
use serde::Deserialize;
use serde_json::json;

use crate::error::{ErrorKind, PlatformError, Result};
use crate::http::{encode, with_query};
use crate::wire::{Agent, AgentPage, AgentPatch, AgentStatus, NewAgent};
use crate::{MAX_PAGES, PAGE, Platform};

/// What `setAgentStatus` can set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Switch {
    Active,
    Inactive,
}

impl Switch {
    fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Inactive => "inactive",
        }
    }
}

pub(crate) fn agent_path(id: &str) -> String {
    format!("/api/v1/agents/{}", encode(id))
}

impl Platform {
    /// One page of agents as endue AI answers it, deleted ones included.
    pub fn list_agents_page(&self, page: u64, limit: u64) -> Result<AgentPage> {
        let path = with_query(
            "/api/v1/agents",
            &[
                ("page", Some(page.to_string())),
                ("limit", Some(limit.to_string())),
            ],
        );
        self.read(Method::Get, &path, None, "agent list")
    }

    /// Every agent that is not deleted, newest first: the pages read in turn (`PAGE` each, at most
    /// `MAX_PAGES`), an agent that moved across a page boundary kept once.
    pub fn list_agents(&self) -> Result<Vec<Agent>> {
        let mut seen = BTreeSet::new();
        let mut agents = Vec::new();
        for page in 1..=MAX_PAGES {
            let answer = self.list_agents_page(page, PAGE)?;
            let last = !answer.pagination.has_next_page || answer.items.is_empty();
            for agent in answer.items {
                if agent.status != AgentStatus::Deleted && seen.insert(agent.id.clone()) {
                    agents.push(agent);
                }
            }
            if last {
                break;
            }
        }
        Ok(agents)
    }

    pub fn get_agent(&self, id: &str) -> Result<Agent> {
        self.read(Method::Get, &agent_path(id), None, "agent")
    }

    /// Create an agent; the answer is its id.
    pub fn create_agent(&self, agent: &NewAgent) -> Result<String> {
        #[derive(Deserialize)]
        struct Created {
            agent_id: String,
        }
        let body = serde_json::to_value(agent).map_err(|e| PlatformError::unexpected("body", e))?;
        let created: Created =
            self.read(Method::Post, "/api/v1/agents", Some(&body), "new agent")?;
        Ok(created.agent_id)
    }

    /// Change the agent's nature and profile. Nothing to change is `Invalid`, as the platform says.
    pub fn update_agent(&self, id: &str, patch: &AgentPatch) -> Result<()> {
        if patch.is_empty() {
            return Err(PlatformError::new(
                ErrorKind::Invalid,
                "nature or profile is required",
            ));
        }
        let body = serde_json::to_value(patch).map_err(|e| PlatformError::unexpected("body", e))?;
        self.send(Method::Patch, &agent_path(id), Some(&body))
    }

    /// Turn the agent on or off. The status it already has (409) is no error.
    pub fn set_status(&self, id: &str, status: Switch) -> Result<()> {
        let path = format!("{}/status", agent_path(id));
        let body = json!({ "status": status.as_str() });
        match self.send(Method::Put, &path, Some(&body)) {
            Err(e) if e.kind == ErrorKind::Conflict => Ok(()),
            other => other,
        }
    }

    /// Delete the agent softly: endue AI purges it after 30 days. One already deleted (409) or past
    /// the purge window (410) is `NotFound`.
    pub fn delete_agent(&self, id: &str) -> Result<()> {
        self.send(Method::Delete, &agent_path(id), None)
            .map_err(|e| match e.kind {
                ErrorKind::Conflict => PlatformError {
                    kind: ErrorKind::NotFound,
                    ..e
                },
                _ => e,
            })
    }
}
