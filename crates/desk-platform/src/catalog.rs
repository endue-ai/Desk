//! The agent catalog (agent-catalog-service) and the conversation list (ai-agent-service).

use desk_sys::net::Method;
use serde_json::json;

use crate::error::Result;
use crate::http::{encode, with_query};
use crate::wire_catalog::{
    CatalogAgent, CatalogQuery, ConversationPage, ConversationQuery, Recommended, Used,
};
use crate::{Platform, USE_TIMEOUT};

impl Platform {
    /// The published catalog agents that match `query`.
    pub fn catalog(&self, query: &CatalogQuery) -> Result<Vec<CatalogAgent>> {
        let path = with_query(
            "/api/v1/agent-catalog/agents",
            &[
                ("q", query.q.clone().filter(|q| !q.trim().is_empty())),
                ("category", query.category.clone()),
                ("limit", Some(query.limit.unwrap_or(100).to_string())),
            ],
        );
        self.read(Method::Get, &path, None, "catalog")
    }

    /// The catalog agents that fit what the person wants help with, in `locale`.
    pub fn recommend(&self, query: &str, locale: &str) -> Result<Recommended> {
        let body = json!({ "query": query, "locale": locale });
        let path = "/api/v1/agent-catalog/recommend";
        self.read(Method::Post, path, Some(&body), "recommendation")
    }

    /// Make the person an agent of their own from the catalog agent `slug`, in `locale`.
    pub fn use_catalog(&self, slug: &str, locale: &str) -> Result<Used> {
        let path = format!("/api/v1/agent-catalog/agents/{}/use", encode(slug));
        let body = json!({ "locale": locale });
        let timeout = USE_TIMEOUT.max(self.timeout);
        self.read_within(Method::Post, &path, Some(&body), "new agent", timeout)
    }

    /// One page of the person's conversations, the most recently active first.
    pub fn conversations(&self, query: &ConversationQuery) -> Result<ConversationPage> {
        let flag = |on: Option<bool>| on.filter(|on| *on).map(|_| "true".to_owned());
        let path = with_query(
            "/api/v1/ai/conversations",
            &[
                ("agent_id", query.agent_id.clone()),
                ("awaiting_input", flag(query.awaiting_input)),
                ("running", flag(query.running)),
                ("page", query.page.map(|p| p.to_string())),
                ("limit", query.limit.map(|l| l.to_string())),
            ],
        );
        self.read(Method::Get, &path, None, "conversation list")
    }
}
