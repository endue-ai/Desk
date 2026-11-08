//! The agent directory and the brain's status over the bridge, against examples/brain-echo through
//! HttpBrain: brain.agents.list, brain.agents.card, brain.spaces.list and brain.tasks.list pass the
//! brain's answers through (filters, pages, its 400 and 404), brain.status is cloud while the brain
//! answers and offline while it cannot be reached, and all five need brain:converse and a brain.

mod common;

use std::fs;
use std::path::Path;
use std::sync::Arc;

use common::{Echo, free_port};
use desk_brain::{AgentQuery, Brain};
use desk_brain_endue::HttpBrain;
use desk_bridge::{
    BrainConversePermission, BrainStatusResult, BridgeError, BridgeRequest, BridgeResponse,
    ErrorCode, Permission, SCHEMAS,
};
use desk_core::{BrainMode, BrainOptions, Core, Roots};
use serde_json::{Value, json};

const DESK: &str = "desk";
const MIRA: &str = "ag_01JBZ8Q4MR0000000000000001";
const METHODS: [&str; 5] = [
    "brain.agents.list",
    "brain.agents.card",
    "brain.spaces.list",
    "brain.tasks.list",
    "brain.status",
];

fn converse() -> Permission {
    Permission::BrainConverse(BrainConversePermission {
        permission: Default::default(),
    })
}

fn bare() -> Core {
    Core::new(Roots {
        home: std::env::temp_dir(),
    })
}

/// A core whose brain is at `url`, with the runtime (`desk`) granted brain:converse.
fn core(url: &str) -> Core {
    let brain = Arc::new(HttpBrain::new(url).unwrap());
    let core = bare().with_brain(brain, BrainOptions::default());
    core.grant(DESK, converse());
    core
}

/// One call as `caller`, with the brain:converse scope added to `params`.
fn call(core: &Core, caller: &str, method: &str, mut params: Value) -> Result<Value, BridgeError> {
    params["scope"] = json!({ "permission": "brain:converse" });
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 3, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => {
            assert_eq!(ok.id, 3);
            Ok(ok.result)
        }
        BridgeResponse::BridgeFailure(err) => Err(err.error),
    }
}

fn agents(core: &Core, query: Value) -> Value {
    call(core, DESK, "brain.agents.list", query).unwrap()
}

fn tasks(core: &Core, query: Value) -> Value {
    call(core, DESK, "brain.tasks.list", query).unwrap()
}

/// `name` of every item of a list.
fn field(list: &Value, name: &str) -> Vec<String> {
    let items = list["items"].as_array().expect("a list has items");
    items
        .iter()
        .map(|item| item[name].as_str().unwrap().to_owned())
        .collect()
}

fn code(answer: Result<Value, BridgeError>) -> ErrorCode {
    answer.expect_err("the call should fail").code
}

/// Whether `value` is a BrainStatusResult as specs/bridge/v0/brain.schema.json says.
fn is_status(value: &Value) -> bool {
    let resources = SCHEMAS.iter().map(|(id, text)| {
        let schema: Value = serde_json::from_str(text).unwrap();
        ((*id).to_owned(), schema)
    });
    let registry = jsonschema::Registry::new()
        .extend(resources)
        .unwrap()
        .prepare()
        .unwrap();
    let target = "https://endue.ai/specs/bridge/v0/brain.schema.json#/$defs/BrainStatusResult";
    let valid = jsonschema::options()
        .with_registry(&registry)
        .build(&json!({ "$ref": target }))
        .unwrap()
        .is_valid(value);
    valid && serde_json::from_value::<BrainStatusResult>(value.clone()).is_ok()
}

#[test]
fn brain_agents_list_answers_the_brains_page_with_its_filters() {
    let echo = Echo::start();
    let core = core(echo.url());

    let all = agents(&core, json!({}));
    assert_eq!(field(&all, "name"), ["Mira", "Theo", "Juno", "Kai", "Lena"]);
    let first = json!({ "total": 5, "page": 1, "limit": 20, "hasNextPage": false });
    assert_eq!(all["pagination"], first);
    // Passed through: the page is the one the brain sends.
    let direct = HttpBrain::new(echo.url())
        .unwrap()
        .list_agents(&AgentQuery::default())
        .unwrap();
    assert_eq!(all, serde_json::to_value(direct).unwrap());

    let studio = agents(&core, json!({ "spaceId": "sp_studio" }));
    assert_eq!(field(&studio, "name"), ["Kai", "Lena"]);
    let inactive = agents(&core, json!({ "status": "inactive" }));
    assert_eq!(field(&inactive, "name"), ["Juno"]);
    let second = agents(&core, json!({ "page": 2, "limit": 2 }));
    assert_eq!(field(&second, "name"), ["Juno", "Kai"]);
    let more = json!({ "total": 5, "page": 2, "limit": 2, "hasNextPage": true });
    assert_eq!(second["pagination"], more);

    // The brain's 400, and a status the brain contract does not know, before the brain is asked.
    let over = call(&core, DESK, "brain.agents.list", json!({ "limit": 101 }));
    assert_eq!(code(over), ErrorCode::InvalidParams);
    let paused = call(
        &core,
        DESK,
        "brain.agents.list",
        json!({ "status": "paused" }),
    );
    assert_eq!(code(paused), ErrorCode::InvalidParams);
}

#[test]
fn brain_agents_card_answers_the_card_and_not_found_for_an_unknown_agent() {
    let echo = Echo::start();
    let core = core(echo.url());

    let card = call(&core, DESK, "brain.agents.card", json!({ "agentId": MIRA })).unwrap();
    assert_eq!(card["agentId"], MIRA);
    assert_eq!(card["name"], "Mira");
    assert!(!card["skills"].as_array().unwrap().is_empty());
    assert!(card["capabilities"]["maxConcurrentTasks"].is_u64());
    let direct = HttpBrain::new(echo.url())
        .unwrap()
        .get_agent_card(MIRA)
        .unwrap();
    assert_eq!(card, serde_json::to_value(direct).unwrap());

    let nobody = call(
        &core,
        DESK,
        "brain.agents.card",
        json!({ "agentId": "ag_nobody" }),
    );
    assert_eq!(code(nobody), ErrorCode::NotFound);
}

#[test]
fn brain_spaces_list_answers_every_space() {
    let echo = Echo::start();
    let core = core(echo.url());
    let spaces = call(&core, DESK, "brain.spaces.list", json!({})).unwrap();
    assert_eq!(field(&spaces, "id"), ["sp_home", "sp_studio"]);
    let direct = HttpBrain::new(echo.url()).unwrap().list_spaces().unwrap();
    assert_eq!(spaces, serde_json::to_value(direct).unwrap());
}

#[test]
fn brain_tasks_list_filters_by_target_agent_and_status() {
    let echo = Echo::start();
    let core = core(echo.url());

    let all = tasks(&core, json!({}));
    assert_eq!(
        field(&all, "goal"),
        [
            "Tidy meeting notes",
            "Compare flights",
            "Sort the inbox",
            "Draft the brief"
        ]
    );
    assert_eq!(all["pagination"]["total"], 4);
    let hers = tasks(&core, json!({ "targetAgentId": MIRA }));
    assert_eq!(field(&hers, "goal"), ["Sort the inbox"]);
    assert_eq!(hers["items"][0]["progress"], 0.62);
    let working = tasks(&core, json!({ "status": "working" }));
    assert_eq!(
        field(&working, "goal"),
        ["Compare flights", "Sort the inbox"]
    );
    let page = tasks(&core, json!({ "page": 2, "limit": 3 }));
    assert_eq!(field(&page, "goal"), ["Draft the brief"]);

    let running = call(
        &core,
        DESK,
        "brain.tasks.list",
        json!({ "status": "running" }),
    );
    assert_eq!(code(running), ErrorCode::InvalidParams);
}

#[test]
fn brain_status_is_offline_while_the_brain_is_unreachable() {
    let nowhere = core(&format!("http://127.0.0.1:{}/v0", free_port()));
    let offline = call(&nowhere, DESK, "brain.status", json!({})).unwrap();
    assert_eq!(offline, json!({ "mode": "offline" }));
    assert!(is_status(&offline));
    let list = call(&nowhere, DESK, "brain.agents.list", json!({}));
    assert_eq!(code(list), ErrorCode::IoError);

    let echo = Echo::start();
    let cloud = call(&core(echo.url()), DESK, "brain.status", json!({})).unwrap();
    assert_eq!(cloud, json!({ "mode": "cloud" }));
    assert!(is_status(&cloud));

    // The status vectors are responses (the contract tests map no Rust type to a bare result):
    // their results are the statuses brain.status answers.
    let vectors = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/bridge/v0/vectors");
    for mode in ["local", "cloud", "offline"] {
        let file = vectors.join(format!("valid/brain-status-result-{mode}.json"));
        let vector: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        let result = &vector["instance"]["result"];
        assert_eq!(result["mode"], mode);
        assert!(is_status(result), "{}", file.display());
    }
    let unknown = vectors.join("invalid/brain-status-unknown-mode.json");
    let vector: Value = serde_json::from_str(&fs::read_to_string(unknown).unwrap()).unwrap();
    assert!(!is_status(&vector["instance"]));
}

#[test]
fn brain_status_names_a_local_brains_model_while_it_answers() {
    let echo = Echo::start();
    let options = BrainOptions {
        mode: BrainMode::Local {
            model: "llama-3.2-3b".to_owned(),
        },
        ..BrainOptions::default()
    };
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let local = bare().with_brain(brain, options.clone());
    local.grant(DESK, converse());
    let status = call(&local, DESK, "brain.status", json!({})).unwrap();
    assert_eq!(status, json!({ "mode": "local", "model": "llama-3.2-3b" }));
    assert!(is_status(&status));

    let gone = Arc::new(HttpBrain::new(&format!("http://127.0.0.1:{}/v0", free_port())).unwrap());
    let unreachable = bare().with_brain(gone, options);
    unreachable.grant(DESK, converse());
    let status = call(&unreachable, DESK, "brain.status", json!({})).unwrap();
    assert_eq!(status, json!({ "mode": "offline" }));
}

#[test]
fn the_directory_needs_brain_converse_and_a_configured_brain() {
    let echo = Echo::start();
    let core = core(echo.url());
    for method in METHODS {
        let params = if method == "brain.agents.card" {
            json!({ "agentId": MIRA })
        } else {
            json!({})
        };
        let denied = call(&core, "example.notes", method, params.clone()).unwrap_err();
        assert_eq!(denied.code, ErrorCode::PermissionDenied, "{method}");
        assert_eq!(denied.permission, Some(converse()), "{method}");
        // The runtime holds the grant.
        assert!(call(&core, DESK, method, params).is_ok(), "{method}");
    }

    let brainless = bare();
    brainless.grant(DESK, converse());
    for method in &METHODS[..4] {
        let params = if *method == "brain.agents.card" {
            json!({ "agentId": MIRA })
        } else {
            json!({})
        };
        let answer = call(&brainless, DESK, method, params);
        assert_eq!(code(answer), ErrorCode::Unsupported, "{method}");
    }
    let status = call(&brainless, DESK, "brain.status", json!({})).unwrap();
    assert_eq!(status, json!({ "mode": "offline" }));
}
