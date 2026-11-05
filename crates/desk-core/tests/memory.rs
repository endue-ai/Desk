//! Eris's memory over the bridge (ADR 0095): memory.list, memory.get and memory.search under
//! memory:read, memory.remember and memory.forget under memory:write, the caller kept as the writer,
//! memory.changed to the holders of memory:read, and the same facts after the core starts again.

mod support;

use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const INSPECTOR: &str = "endue.memory";
const READ: &str = r#"{ "permission": "memory:read" }"#;
const WRITE: &str = r#"{ "permission": "memory:write" }"#;

fn scope(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

fn core_on(home: &Path) -> Core {
    Core::new(roots(home)).with_memory_dir(home.join("data/memory"))
}

fn remember(core: &Core, caller: &str, text: &str) -> Value {
    let params = json!({ "text": text, "scope": scope(WRITE) });
    call(core, caller, "memory.remember", params).unwrap()["fact"].clone()
}

fn changed(deliveries: &Receiver<Delivery>) -> Vec<Value> {
    named(deliveries, "memory.changed")
        .iter()
        .map(|seen| seen.data().clone())
        .collect()
}

#[test]
fn reading_needs_memory_read_and_writing_memory_write() {
    let home = home("memory-perms");
    let core = core_on(&home);
    let params = json!({ "text": "Likes green tea", "scope": scope(WRITE) });
    let refused = call(&core, INSPECTOR, "memory.remember", params.clone()).unwrap_err();
    assert_eq!(
        serde_json::to_value(refused.code).unwrap(),
        "permission_denied"
    );
    let listing = json!({ "scope": scope(READ) });
    let refused = call(&core, INSPECTOR, "memory.list", listing.clone()).unwrap_err();
    assert_eq!(
        serde_json::to_value(refused.code).unwrap(),
        "permission_denied"
    );

    grant(&core, INSPECTOR, scope(WRITE));
    let fact = call(&core, INSPECTOR, "memory.remember", params).unwrap()["fact"].clone();
    assert_eq!(fact["by"], INSPECTOR);
    // Writing is not reading.
    assert!(call(&core, INSPECTOR, "memory.list", listing.clone()).is_err());
    grant(&core, INSPECTOR, scope(READ));
    let listed = call(&core, INSPECTOR, "memory.list", listing).unwrap();
    assert_eq!(listed["entries"], json!([fact]));
}

#[test]
fn remember_get_search_edit_and_forget_over_the_bridge() {
    let home = home("memory-calls");
    let core = core_on(&home);
    grant(&core, "desk", scope(READ));
    grant(&core, "desk", scope(WRITE));
    let deliveries = core.events().subscribe_addressed();

    let fact = remember(&core, "desk", "Reviews pull requests in the morning");
    assert_eq!(fact["by"], "person", "the runtime writes for the person");
    let id = fact["id"].as_str().unwrap().to_owned();
    let got = call(
        &core,
        "desk",
        "memory.get",
        json!({ "id": id, "scope": scope(READ) }),
    );
    assert_eq!(got.unwrap()["entry"], fact);

    let edit =
        json!({ "id": id, "text": "Reviews pull requests after lunch", "scope": scope(WRITE) });
    let edited = call(&core, "desk", "memory.remember", edit).unwrap()["fact"].clone();
    assert_eq!(edited["id"], fact["id"]);
    let search = |query: &str| {
        let params = json!({ "query": query, "scope": scope(READ) });
        call(&core, "desk", "memory.search", params).unwrap()["hits"].clone()
    };
    assert_eq!(search("lunch")[0]["entry"]["id"], fact["id"]);
    assert_eq!(search("morning"), json!([]));

    let forgot = call(
        &core,
        "desk",
        "memory.forget",
        json!({ "id": id, "scope": scope(WRITE) }),
    );
    assert_eq!(forgot.unwrap()["forgotten"], 1);
    assert_eq!(search("lunch"), json!([]));
    let missing = call(
        &core,
        "desk",
        "memory.get",
        json!({ "id": id, "scope": scope(READ) }),
    );
    assert_eq!(
        serde_json::to_value(missing.unwrap_err().code).unwrap(),
        "not_found"
    );

    let changes: Vec<Value> = changed(&deliveries)
        .iter()
        .map(|data| data["change"].clone())
        .collect();
    assert_eq!(changes, ["remembered", "edited", "forgotten"]);
}

#[test]
fn memory_changed_reaches_only_the_holders_of_memory_read() {
    let home = home("memory-events");
    let core = core_on(&home);
    grant(&core, "desk", scope(WRITE));
    grant(&core, INSPECTOR, scope(READ));
    let deliveries = core.events().subscribe_addressed();
    remember(&core, "desk", "Keeps receipts in a shoebox");
    let seen = named(&deliveries, "memory.changed");
    assert_eq!(seen.len(), 1);
    assert!(seen[0].is_for(INSPECTOR));
    assert!(!seen[0].is_for("desk"), "desk holds memory:write only");
}

#[test]
fn forget_everything_and_episodes_from_the_core() {
    let home = home("memory-all");
    let core = core_on(&home);
    grant(&core, "desk", scope(READ));
    grant(&core, "desk", scope(WRITE));
    remember(&core, "desk", "one");
    let episode = core
        .record_episode(
            "check my mail",
            "Two new messages.",
            Vec::new(),
            "agent:eris",
        )
        .expect("an episode is kept");
    assert_eq!(episode.by, "eris");
    let episodes = json!({ "kind": "episode", "scope": scope(READ) });
    let listed = call(&core, "desk", "memory.list", episodes).unwrap();
    assert_eq!(listed["entries"][0]["asked"], "check my mail");

    let all = json!({ "all": true, "scope": scope(WRITE) });
    assert_eq!(
        call(&core, "desk", "memory.forget", all).unwrap()["forgotten"],
        2
    );
    let listed = call(
        &core,
        "desk",
        "memory.list",
        json!({ "scope": scope(READ) }),
    )
    .unwrap();
    assert_eq!(listed["entries"], json!([]));
}

#[test]
fn a_core_started_again_knows_the_same_facts() {
    let home = home("memory-restart");
    let fact = {
        let core = core_on(&home);
        grant(&core, "desk", scope(WRITE));
        remember(&core, "desk", "Works on Desk this month")
    };
    let core = core_on(&home);
    grant(&core, "desk", scope(READ));
    let params = json!({ "query": "desk month", "scope": scope(READ) });
    let hits = call(&core, "desk", "memory.search", params).unwrap()["hits"].clone();
    assert_eq!(hits[0]["entry"], fact);
}

#[test]
fn a_desk_without_memory_answers_unsupported() {
    let home = home("memory-none");
    let core = Core::new(roots(&home));
    grant(&core, "desk", scope(READ));
    let failed = call(
        &core,
        "desk",
        "memory.list",
        json!({ "scope": scope(READ) }),
    )
    .unwrap_err();
    assert_eq!(serde_json::to_value(failed.code).unwrap(), "unsupported");
}
