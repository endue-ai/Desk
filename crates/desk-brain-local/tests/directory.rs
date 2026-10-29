//! The agent directory: a local brain has no agents, spaces or A2A tasks, and says so in the
//! contract's shapes.

mod support;

use desk_brain::{AgentQuery, Brain, TaskQuery};
use support::{Contract, Folder, brain, closed_url, refused};

#[test]
fn every_list_is_an_empty_page_the_contract_accepts() {
    let contract = Contract::new();
    let folder = Folder::new();
    // The directory is local, so it answers without the server.
    let brain = brain(&closed_url(), &folder);

    let agents = brain.list_agents(&AgentQuery::default()).unwrap();
    contract.check("AgentList", &serde_json::to_value(&agents).unwrap());
    assert!(agents.items.is_empty());
    assert_eq!((agents.pagination.page, agents.pagination.limit), (1, 20));
    assert!(!agents.pagination.has_next_page);

    let tasks = brain
        .list_a2a_tasks(&TaskQuery {
            page: Some(3),
            limit: Some(100),
            ..TaskQuery::default()
        })
        .unwrap();
    contract.check("A2ATaskList", &serde_json::to_value(&tasks).unwrap());
    assert_eq!((tasks.pagination.page, tasks.pagination.limit), (3, 100));

    let spaces = brain.list_spaces().unwrap();
    contract.check("SpaceList", &serde_json::to_value(&spaces).unwrap());
    assert!(spaces.items.is_empty());
}

#[test]
fn an_agent_card_is_not_found_and_bad_pages_are_invalid() {
    let folder = Folder::new();
    let brain = brain(&closed_url(), &folder);

    assert_eq!(
        refused(brain.get_agent_card("agent_1")),
        (404, "not_found".to_owned())
    );
    let zero = AgentQuery {
        page: Some(0),
        ..AgentQuery::default()
    };
    assert_eq!(
        refused(brain.list_agents(&zero)),
        (400, "invalid_request".to_owned())
    );
    let wide = TaskQuery {
        limit: Some(101),
        ..TaskQuery::default()
    };
    assert_eq!(
        refused(brain.list_a2a_tasks(&wide)),
        (400, "invalid_request".to_owned())
    );
}
