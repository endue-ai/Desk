//! The agent directory of a local brain: Ollama has no agents, spaces or A2A tasks, so every list is
//! an empty page and every card is unknown. Pages and limits are still checked as the contract says.

use desk_brain::{
    A2ATaskList, AgentCard, AgentList, AgentQuery, BrainFailure, Pagination, SpaceList, TaskQuery,
};

use crate::store::{invalid, not_found};

pub fn agents(query: &AgentQuery) -> Result<AgentList, BrainFailure> {
    Ok(AgentList {
        items: Vec::new(),
        pagination: empty_page(query.page, query.limit)?,
    })
}

pub fn agent_card(agent_id: &str) -> Result<AgentCard, BrainFailure> {
    Err(not_found(format!("A local brain has no agent {agent_id}.")))
}

pub fn spaces() -> Result<SpaceList, BrainFailure> {
    Ok(SpaceList { items: Vec::new() })
}

pub fn tasks(query: &TaskQuery) -> Result<A2ATaskList, BrainFailure> {
    Ok(A2ATaskList {
        items: Vec::new(),
        pagination: empty_page(query.page, query.limit)?,
    })
}

/// The pagination of an empty list, with brain-echo's defaults and bounds (page from 1, limit 1 to 100).
fn empty_page(page: Option<u64>, limit: Option<u64>) -> Result<Pagination, BrainFailure> {
    let page = page.unwrap_or(1);
    let limit = limit.unwrap_or(20);
    if page < 1 {
        return Err(invalid(format!(
            "page is a whole number from 1, not {page}."
        )));
    }
    if !(1..=100).contains(&limit) {
        return Err(invalid(format!(
            "limit is a whole number from 1 to 100, not {limit}."
        )));
    }
    Ok(Pagination {
        total: 0,
        page,
        limit,
        has_next_page: false,
    })
}
