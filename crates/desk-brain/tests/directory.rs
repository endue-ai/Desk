//! Conformance of the agent directory: examples/brain-echo answers listSpaces, listAgents,
//! getAgentCard and listA2ATasks the way specs/brain/v0/openapi.yaml says. Every body is checked
//! against its schema (formats included), the filters and pages narrow the lists, bad queries and
//! unknown agents are refused with the contract's codes, and HttpBrain from desk-brain-endue reads it.

mod support;

use desk_brain::{
    A2ATaskStatus, AgentQuery, AgentStatus, Brain, BrainErrorCode, BrainFailure, Pagination,
    TaskQuery,
};
use desk_brain_endue::HttpBrain;
use serde_json::{Value, json};
use support::{Contract, Echo, Wire};

const MIRA: &str = "ag_01JBZ8Q4MR0000000000000001";

/// brain-echo over raw HTTP, so the bodies are checked as they are on the wire.
struct Directory {
    wire: Wire,
    contract: Contract,
    _echo: Echo,
}

impl Directory {
    fn start() -> Self {
        let echo = Echo::start();
        Self {
            wire: Wire::new(&echo),
            contract: Contract::new(),
            _echo: echo,
        }
    }

    /// GET `path`, which answers 200 with a `schema`.
    fn get(&self, schema: &str, path: &str) -> Value {
        let (status, body) = self.wire.call("GET", path, None);
        assert_eq!(status, 200, "GET {path}: {body}");
        self.contract.check(schema, &body);
        body
    }

    /// GET `path`, which is refused with `status` and a BrainError of `code`.
    fn refused(&self, path: &str, status: u16, code: &str) {
        let (answered, error) = self.wire.call("GET", path, None);
        assert_eq!(answered, status, "GET {path}: {error}");
        self.contract.check("BrainError", &error);
        assert_eq!(error["code"], code, "GET {path}");
    }

    fn names(&self, path: &str) -> Vec<String> {
        field(&self.get("AgentList", path), "name")
    }
}

/// `name` of every item of a list.
fn field(list: &Value, name: &str) -> Vec<String> {
    let items = list["items"].as_array().expect("a list has items");
    items
        .iter()
        .map(|item| item[name].as_str().unwrap().to_owned())
        .collect()
}

/// brain-echo writes every timestamp in one format, so newest first is descending text.
fn assert_newest_first(list: &Value, at: &str) {
    let times = field(list, at);
    let mut newest = times.clone();
    newest.sort_by(|a, b| b.cmp(a));
    assert_eq!(times, newest, "the items are not newest first by {at}");
}

#[test]
fn every_directory_answer_conforms_to_the_contract() {
    let directory = Directory::start();
    let spaces = directory.get("SpaceList", "/spaces");
    assert_eq!(field(&spaces, "id"), ["sp_home", "sp_studio"]);

    let agents = directory.get("AgentList", "/agents");
    let first_page = json!({ "total": 5, "page": 1, "limit": 20, "hasNextPage": false });
    assert_eq!(agents["pagination"], first_page);
    assert_newest_first(&agents, "createdAt");
    for agent in agents["items"].as_array().unwrap() {
        let id = agent["id"].as_str().unwrap();
        let card = directory.get("AgentCard", &format!("/agents/{id}/card"));
        assert_eq!(
            (&card["agentId"], &card["name"]),
            (&agent["id"], &agent["name"])
        );
    }

    let tasks = directory.get("A2ATaskList", "/a2a/tasks");
    assert_eq!(tasks["pagination"]["total"], 4);
    assert_newest_first(&tasks, "insertedAt");
}

#[test]
fn filters_and_pages_narrow_the_lists() {
    let directory = Directory::start();
    assert_eq!(
        directory.names("/agents?spaceId=sp_home"),
        ["Mira", "Theo", "Juno"]
    );
    assert_eq!(
        directory.names("/agents?spaceId=sp_studio"),
        ["Kai", "Lena"]
    );
    assert_eq!(directory.names("/agents?status=inactive"), ["Juno"]);
    assert_eq!(
        directory.names("/agents?spaceId=sp_home&status=active"),
        ["Mira", "Theo"]
    );
    let empty = json!({ "total": 0, "page": 1, "limit": 20, "hasNextPage": false });
    let nowhere = directory.get("AgentList", "/agents?spaceId=sp_nowhere");
    assert_eq!(nowhere, json!({ "items": [], "pagination": empty }));

    let hers = directory.get("A2ATaskList", &format!("/a2a/tasks?targetAgentId={MIRA}"));
    assert_eq!(field(&hers, "targetAgentId"), [MIRA]);
    assert_eq!(field(&hers, "goal"), ["Sort the inbox"]);
    let working = directory.get("A2ATaskList", "/a2a/tasks?status=working");
    assert_eq!(field(&working, "status"), ["working", "working"]);

    let first = directory.get("AgentList", "/agents?limit=1");
    let more = json!({ "total": 5, "page": 1, "limit": 1, "hasNextPage": true });
    assert_eq!(first["pagination"], more);
    let second = directory.get("AgentList", "/agents?limit=1&page=2");
    assert_eq!(second["pagination"]["page"], 2);
    assert_eq!(second["pagination"]["hasNextPage"], true);
    assert_ne!(first["items"], second["items"]);

    // Walking the pages reads the whole list once; past the last page, a page is empty.
    let mut walked = Vec::new();
    for page in 1..=3 {
        let body = directory.get("AgentList", &format!("/agents?limit=2&page={page}"));
        assert_eq!(body["pagination"]["hasNextPage"], page < 3, "page {page}");
        walked.extend(field(&body, "name"));
    }
    assert_eq!(walked, directory.names("/agents"));
    assert!(directory.names("/agents?limit=2&page=4").is_empty());
    let tasks = directory.get("A2ATaskList", "/a2a/tasks?limit=3&page=2");
    assert_eq!(tasks["items"].as_array().unwrap().len(), 1);
    assert_eq!(tasks["pagination"]["hasNextPage"], false);
    // A page that ends on the last item has nothing after it.
    let whole = directory.get("AgentList", "/agents?limit=5");
    assert_eq!(whole["items"].as_array().unwrap().len(), 5);
    assert_eq!(whole["pagination"]["hasNextPage"], false);
    let last = directory.get("A2ATaskList", "/a2a/tasks?limit=2&page=2");
    assert_eq!(field(&last, "id").len(), 2);
    assert_eq!(last["pagination"]["hasNextPage"], false);
}

#[test]
fn bad_queries_and_unknown_agents_are_refused() {
    let directory = Directory::start();
    for path in [
        "/agents?page=0",
        "/agents?page=-1",
        "/agents?page=1.5",
        "/agents?page=first",
        "/agents?limit=0",
        "/agents?limit=101",
        "/agents?status=paused",
        "/agents?status=active&status=inactive",
        "/agents?spaceId=",
        "/a2a/tasks?page=0",
        "/a2a/tasks?limit=101",
        "/a2a/tasks?status=running",
        "/a2a/tasks?targetAgentId=",
    ] {
        directory.refused(path, 400, "invalid_request");
    }
    directory.refused("/agents/ag_nobody/card", 404, "not_found");
}

#[test]
fn the_http_client_reads_the_directory() {
    let echo = Echo::start();
    let brain = HttpBrain::new(&echo.url).unwrap();

    let spaces = brain.list_spaces().unwrap();
    let ids: Vec<&str> = spaces.items.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["sp_home", "sp_studio"]);

    let names = |query: AgentQuery| -> Vec<String> {
        let list = brain.list_agents(&query).unwrap();
        list.items.into_iter().map(|agent| agent.name).collect()
    };
    let home = AgentQuery {
        space_id: Some("sp_home".to_owned()),
        ..AgentQuery::default()
    };
    assert_eq!(names(home), ["Mira", "Theo", "Juno"]);
    let inactive = AgentQuery {
        status: Some(AgentStatus::Inactive),
        ..AgentQuery::default()
    };
    assert_eq!(names(inactive), ["Juno"]);
    // A value that needs encoding reaches the brain whole, and no space has that id.
    let odd = AgentQuery {
        space_id: Some("sp home&status=active".to_owned()),
        ..AgentQuery::default()
    };
    assert!(names(odd).is_empty());
    let second = AgentQuery {
        page: Some(2),
        limit: Some(1),
        ..AgentQuery::default()
    };
    let list = brain.list_agents(&second).unwrap();
    let pagination = Pagination {
        total: 5,
        page: 2,
        limit: 1,
        has_next_page: true,
    };
    assert_eq!(list.pagination, pagination);
    assert_eq!(list.items[0].name, "Theo");

    let card = brain.get_agent_card(MIRA).unwrap();
    assert_eq!((card.agent_id.as_str(), card.enabled), (MIRA, true));
    assert!(!card.skills.is_empty());
    match brain.get_agent_card("ag_nobody") {
        Err(BrainFailure::Refused { status: 404, error }) => {
            assert_eq!(error.code, BrainErrorCode::NotFound)
        }
        other => panic!("expected not_found, got {other:?}"),
    }

    let hers = TaskQuery {
        target_agent_id: Some(MIRA.to_owned()),
        ..TaskQuery::default()
    };
    let tasks = brain.list_a2a_tasks(&hers).unwrap();
    assert_eq!(tasks.items.len(), 1);
    assert_eq!(tasks.items[0].target_agent_id, MIRA);
    assert_eq!(tasks.items[0].progress, Some(0.62));
    // brain-echo refuses a status it does not know, so this also checks the spelling.
    let waiting = TaskQuery {
        status: Some(A2ATaskStatus::InputRequired),
        ..TaskQuery::default()
    };
    assert!(brain.list_a2a_tasks(&waiting).unwrap().items.is_empty());

    let zero = AgentQuery {
        page: Some(0),
        ..AgentQuery::default()
    };
    match brain.list_agents(&zero) {
        Err(BrainFailure::Refused { status: 400, error }) => {
            assert_eq!(error.code, BrainErrorCode::InvalidRequest)
        }
        other => panic!("expected invalid_request, got {other:?}"),
    }
}
