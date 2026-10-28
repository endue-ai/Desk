//! Conformance of the agent directory: examples/brain-echo answers endue AI's API gateway paths
//! (listAgents, listSpaces, listSpaceAgents at /api/v1, beside the brain under /v0) the way
//! specs/brain/v0/openapi.yaml says. Every body is checked against its schema (formats included),
//! agents come newest first and page like the agent service (page at least 1, limit 1 to 50), an
//! unknown space is not_found, and HttpBrain from desk-brain-endue reads it through the gateway origin.

mod support;

use std::net::TcpListener;

use desk_brain::{AgentQuery, Brain, BrainErrorCode, BrainFailure, Pagination};
use desk_brain_endue::HttpBrain;
use desk_brain_endue::http::Endpoint;
use serde_json::{Value, json};
use support::{Contract, Echo, Wire};

const MIRA: &str = "ag_01JBZ8Q4MR0000000000000001";
const THEO: &str = "ag_01JBZ8Q4MR0000000000000002";
const JUNO: &str = "ag_01JBZ8Q4MR0000000000000003";

/// brain-echo's gateway paths over raw HTTP, so the bodies are checked as they are on the wire.
struct Gateway {
    wire: Wire,
    contract: Contract,
    _echo: Echo,
}

impl Gateway {
    fn start() -> Self {
        let echo = Echo::start();
        Self {
            wire: Wire(Endpoint::parse(&echo.url).unwrap().origin()),
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

    fn agents(&self, query: &str) -> Value {
        self.get("AgentList", &format!("/api/v1/agents{query}"))
    }
}

/// `name` of every element of `items`.
fn field(items: &Value, name: &str) -> Vec<String> {
    let items = items.as_array().expect("an array");
    items
        .iter()
        .map(|item| item[name].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn every_gateway_answer_conforms_to_the_contract() {
    let gateway = Gateway::start();
    let spaces = gateway.get("SpaceList", "/api/v1/spaces");
    assert_eq!(field(&spaces, "id"), ["sp_home", "sp_studio"]);

    let agents = gateway.agents("");
    let first = json!({ "total": 5, "page": 1, "limit": 20, "has_next_page": false });
    assert_eq!(agents["pagination"], first);
    // brain-echo writes every timestamp in one format, so newest first is descending text.
    let created = field(&agents["items"], "created_at");
    let mut newest = created.clone();
    newest.sort_by(|a, b| b.cmp(a));
    assert_eq!(created, newest, "agents are not newest first");
    let known = field(&agents["items"], "id");

    for space in spaces.as_array().unwrap() {
        let id = space["id"].as_str().unwrap();
        let members = gateway.get("SpaceAgentList", &format!("/api/v1/spaces/{id}/agents"));
        let rows = members["data"].as_array().unwrap();
        assert!(!rows.is_empty(), "{id} has no agents");
        assert!(rows.iter().all(|row| row["space_id"] == id));
        assert!(
            rows.iter()
                .all(|row| known.contains(&row["agent_id"].as_str().unwrap().to_owned()))
        );
        let fronts: Vec<&Value> = rows.iter().filter(|row| row["is_front"] == true).collect();
        assert_eq!(fronts.len(), 1, "{id} has one front agent");
        assert_eq!(fronts[0]["agent_id"], space["front_agent_id"]);
    }
}

#[test]
fn agents_page_and_clamp_like_the_agent_service() {
    let gateway = Gateway::start();
    let names = |query: &str| field(&gateway.agents(query)["items"], "name");
    assert_eq!(names(""), ["Mira", "Theo", "Juno", "Kai", "Lena"]);

    let first = gateway.agents("?limit=1");
    let more = json!({ "total": 5, "page": 1, "limit": 1, "has_next_page": true });
    assert_eq!(first["pagination"], more);
    assert_eq!(names("?limit=1&page=2"), ["Theo"]);

    // Walking the pages reads the whole list once; a page ending on the last item has no next one.
    let mut walked = Vec::new();
    for page in 1..=3 {
        let body = gateway.agents(&format!("?limit=2&page={page}"));
        assert_eq!(body["pagination"]["has_next_page"], page < 3, "page {page}");
        walked.extend(field(&body["items"], "name"));
    }
    assert_eq!(walked, names(""));
    assert_eq!(
        gateway.agents("?limit=5")["pagination"]["has_next_page"],
        false
    );
    assert!(names("?limit=2&page=4").is_empty());

    // Out of range is lowered or raised, never refused.
    let clamped = |query: &str| gateway.agents(query)["pagination"].clone();
    assert_eq!(clamped("?limit=0")["limit"], 1);
    assert_eq!(clamped("?limit=500")["limit"], 50);
    assert_eq!(
        gateway.agents("?limit=500")["items"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    assert_eq!(clamped("?page=0")["page"], 1);
    assert_eq!(clamped("?page=-3")["page"], 1);
}

#[test]
fn an_unknown_space_is_not_found_and_the_old_paths_are_gone() {
    let gateway = Gateway::start();
    let (status, error) = gateway
        .wire
        .call("GET", "/api/v1/spaces/sp_nowhere/agents", None);
    assert_eq!(status, 404, "{error}");
    gateway.contract.check("BrainError", &error);
    assert_eq!(error["code"], "not_found");
    for old in ["/v0/agents", "/v0/spaces", "/v0/a2a/tasks"] {
        assert_eq!(gateway.wire.call("GET", old, None).0, 404, "GET {old}");
    }
}

#[test]
fn the_http_client_reads_the_directory_through_the_gateway() {
    let echo = Echo::start();
    let brain = HttpBrain::new(&echo.url)
        .unwrap()
        .with_token("endue-id-token");
    let origin = echo.url.trim_end_matches("/v0");
    assert_eq!(brain.gateway_url(), origin);

    let spaces = brain.list_spaces().unwrap();
    let ids: Vec<&str> = spaces.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["sp_home", "sp_studio"]);

    let all = brain.list_agents(&AgentQuery::default()).unwrap();
    assert_eq!(all.items.len(), 5);
    assert!(
        all.items[0]
            .pinned_at
            .as_ref()
            .is_some_and(Value::is_string)
    );
    let second = AgentQuery {
        page: Some(2),
        limit: Some(1),
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
    let big = AgentQuery {
        limit: Some(500),
        ..AgentQuery::default()
    };
    assert_eq!(brain.list_agents(&big).unwrap().pagination.limit, 50);

    let home = brain.list_space_agents("sp_home").unwrap();
    let members: Vec<&str> = home.data.iter().map(|m| m.agent_id.as_str()).collect();
    assert_eq!(members, [MIRA, THEO, JUNO]);
    assert!(home.data[0].is_front);
    // An id that needs encoding reaches the gateway whole.
    match brain.list_space_agents("sp home/x") {
        Err(BrainFailure::Refused { status: 404, error }) => {
            assert_eq!(error.code, BrainErrorCode::NotFound);
            assert!(error.message.contains("sp home/x"), "{}", error.message);
        }
        other => panic!("expected not_found, got {other:?}"),
    }

    // The gateway may live elsewhere than the brain.
    let explicit = HttpBrain::new(&echo.url)
        .unwrap()
        .with_gateway(origin)
        .unwrap();
    assert_eq!(explicit.list_spaces().unwrap(), spaces);
    let closed = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let elsewhere = HttpBrain::new(&echo.url)
        .unwrap()
        .with_gateway(&format!("http://127.0.0.1:{closed}"))
        .unwrap();
    assert!(matches!(
        elsewhere.list_spaces(),
        Err(BrainFailure::Unreachable(_))
    ));
}
