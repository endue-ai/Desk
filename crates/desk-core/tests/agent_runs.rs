//! One registry for every agent and its runs (ADR 0100): an agent's command call is a run item
//! from cmd.invoke to its answer, waiting while it is held for approval; agent.list names Eris,
//! init.yaml's agents and every agent that called, with its state; agent.cancel stops a run; a
//! plugin reports the runs of the agents it runs; the brain directory's tasks become runs.

mod common;
mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const NOTES: &str = "example.notes";
const MIRA: &str = "agent:mira";
const SEARCH: &str = "example.notes.search";
const DROP: &str = "example.notes.drop";

/// A core with an item index and init.yaml naming mira and theo, `desk` holding perm:manage and
/// reading runs, a router listening, and example.notes providing a read-only and an irreversible
/// command; mira may run both.
fn core(tag: &str) -> (Core, Receiver<Delivery>) {
    let home = home(tag);
    let init = home.join("init.yaml");
    fs::write(&init, "agents:\n  mira: {}\n  theo:\n    allow:\n      - { permission: cmd:invoke, ids: [example.notes.search] }\n").unwrap();
    let core = Core::new(roots(&home))
        .with_prompter(NeverAsk)
        .with_init_file(init)
        .with_index_file(home.join("index.sqlite"));
    notes_plugin(&core, &home);
    grant(&core, "desk", manage());
    grant(
        &core,
        "desk",
        json!({ "permission": "data:read", "kinds": ["run"] }),
    );
    grant(
        &core,
        MIRA,
        json!({ "permission": "cmd:invoke", "ids": [SEARCH, DROP] }),
    );
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn notes_plugin(core: &Core, home: &Path) {
    let dir = home.join("plugins/notes");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>notes</p>").unwrap();
    let manifest = json!({ "id": NOTES, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "contributes": { "commands": [
            { "id": SEARCH, "title": "Search notes", "description": "Finds notes.", "agent": true, "readOnly": true },
            { "id": DROP, "title": "Drop a note", "description": "Deletes a note.", "agent": true, "irreversible": true } ] } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    for (id, title) in [(SEARCH, "Search notes"), (DROP, "Drop a note")] {
        call(
            core,
            NOTES,
            "cmd.register",
            json!({ "id": id, "title": title }),
        )
        .unwrap();
    }
}

fn invoke(core: &Core, id: &str, args: Value) -> Result<Value, desk_bridge::BridgeError> {
    let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
    call(
        core,
        MIRA,
        "cmd.invoke",
        json!({ "id": id, "args": args, "scope": scope }),
    )
}

/// The plugin answers its next invocation with `result`, or fails it with `error`.
fn plugin_answers(
    core: &Core,
    deliveries: &Receiver<Delivery>,
    result: Value,
    error: Option<&str>,
) {
    let invoked = wait_for(deliveries, "cmd.invoked");
    let mut answer = json!({ "invocationId": invoked.data()["invocationId"] });
    match error {
        Some(message) => answer["error"] = json!({ "code": "failed", "message": message }),
        None => answer["result"] = result,
    }
    call(core, NOTES, "cmd.answer", answer).unwrap();
}

fn runs(core: &Core) -> Vec<Value> {
    let scope = json!({ "permission": "data:read", "kinds": ["run"] });
    let query = json!({ "kinds": ["run"], "sort": [{ "field": "startedAt", "dir": "asc" }] });
    let page = call(
        core,
        "desk",
        "data.query",
        json!({ "query": query, "scope": scope }),
    )
    .unwrap();
    page["items"].as_array().unwrap().clone()
}

fn agents(core: &Core) -> Vec<Value> {
    let listed = call(core, "desk", "agent.list", json!({ "scope": manage() })).unwrap();
    listed["agents"].as_array().unwrap().clone()
}

fn agent(core: &Core, id: &str) -> Value {
    agents(core)
        .into_iter()
        .find(|a| a["id"] == id)
        .unwrap_or_else(|| panic!("no agent {id}"))
}

#[test]
fn an_agents_command_call_is_a_run_from_start_to_answer() {
    let (core, deliveries) = core("runs-answer");
    invoke(&core, SEARCH, json!({ "prompt": "the launch plan" })).unwrap();
    let running = &runs(&core)[0];
    assert_eq!(running["kind"], "run");
    assert_eq!(
        running["source"],
        json!({ "connector": "desk.agents", "instance": "default" })
    );
    assert_eq!(running["agent"], "mira");
    assert_eq!(running["state"], "running");
    assert_eq!(running["command"], SEARCH);
    assert_eq!(running["title"], "Search notes: the launch plan");
    assert_eq!(agent(&core, "mira")["state"], "working");

    plugin_answers(
        &core,
        &deliveries,
        json!({ "text": "Two notes match." }),
        None,
    );
    let done = &runs(&core)[0];
    assert_eq!(done["state"], "done");
    assert_eq!(done["result"], "Two notes match.");
    assert!(done["endedAt"].is_string());

    invoke(&core, SEARCH, json!({})).unwrap();
    plugin_answers(&core, &deliveries, Value::Null, Some("the index is gone"));
    let failed = &runs(&core)[1];
    assert_eq!(failed["state"], "failed");
    assert_eq!(failed["result"], "the index is gone");
    assert_eq!(agent(&core, "mira")["state"], "error");
}

#[test]
fn a_held_call_is_a_waiting_run_with_its_approval() {
    let (core, deliveries) = core("runs-waiting");
    std::thread::scope(|s| {
        let calling = s.spawn(|| invoke(&core, DROP, json!({ "note": "old.md" })));
        let approval = wait_for(&deliveries, "perm.approval");
        let waiting = &runs(&core)[0];
        assert_eq!(waiting["state"], "waiting");
        assert_eq!(waiting["approval"], approval.data()["approvalId"]);
        assert_eq!(agent(&core, "mira")["state"], "waiting");
        approve_as_desk(&core, &approval, "deny");
        assert!(calling.join().unwrap().is_err());
    });
    let refused = &runs(&core)[0];
    assert_eq!(refused["state"], "cancelled");
    assert!(refused.get("approval").is_none());
}

#[test]
fn the_registry_lists_eris_init_agents_and_callers_with_their_state() {
    let (core, _) = core("runs-registry");
    grant(
        &core,
        "agent:claude-code",
        json!({ "permission": "cmd:invoke", "ids": [SEARCH] }),
    );
    let listed = agents(&core);
    let ids: Vec<&str> = listed.iter().map(|a| a["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["eris", "claude-code", "mira", "theo"]);
    assert_eq!(listed[0]["source"], "eris");
    assert_eq!(listed[0]["caller"], "agent:eris");
    let mira = agent(&core, "mira");
    assert_eq!(mira["source"], "init");
    assert_eq!(mira["state"], "idle");
    assert_eq!(mira["tools"], json!([SEARCH, DROP]));
    assert_eq!(mira["grants"][0]["permission"], "cmd:invoke");
    assert_eq!(agent(&core, "theo")["tools"], json!([SEARCH]));
    assert_eq!(agent(&core, "claude-code")["source"], "caller");

    let refused = call(&core, NOTES, "agent.list", json!({ "scope": manage() })).unwrap_err();
    assert_eq!(
        serde_json::to_value(refused.code).unwrap(),
        "permission_denied"
    );
}

#[test]
fn cancel_ends_a_run_and_tells_whoever_runs_it() {
    let (core, deliveries) = core("runs-cancel");
    let started = invoke(&core, SEARCH, json!({})).unwrap();
    wait_for(&deliveries, "cmd.invoked");
    let run = runs(&core)[0]["id"].clone();
    let cancel = json!({ "runId": run, "scope": manage() });
    assert_eq!(
        call(&core, "desk", "agent.cancel", cancel.clone()).unwrap(),
        json!({ "cancelled": true })
    );
    let answered = wait_for(&deliveries, "cmd.answered");
    assert_eq!(answered.data()["invocationId"], started["invocationId"]);
    assert_eq!(answered.data()["error"]["code"], "cancelled");
    assert_eq!(runs(&core)[0]["state"], "cancelled");
    assert_eq!(
        call(&core, "desk", "agent.cancel", cancel).unwrap(),
        json!({ "cancelled": false })
    );

    let report = json!({ "id": "r1", "agent": { "id": "claude", "name": "Claude Code" },
        "title": "Which tests fail?", "state": "running", "startedAt": "2026-11-05T09:32:00Z" });
    call(&core, "endue.local-agents", "agent.report", report).unwrap();
    let source = json!({ "connector": "endue.local-agents", "instance": "default" });
    let stop = json!({ "runId": "r1", "source": source, "scope": manage() });
    call(&core, "desk", "agent.cancel", stop).unwrap();
    let told = wait_for(&deliveries, "agent.cancelled");
    assert_eq!(told.to, strings(&["endue.local-agents"]));
    assert_eq!(told.data()["runId"], "r1");
}

#[test]
fn a_plugin_reports_runs_of_its_own_agents() {
    let (core, _) = core("runs-report");
    let report = |state: &str| {
        json!({ "id": "r7", "agent": { "id": "codex", "name": "Codex", "brain": "codex" },
        "title": "Run the tests", "state": state, "startedAt": "2026-11-05T09:40:00Z", "result": "Three pass." })
    };
    call(
        &core,
        "endue.local-agents",
        "agent.report",
        report("running"),
    )
    .unwrap();
    assert_eq!(agent(&core, "endue.local-agents/codex")["state"], "working");
    call(&core, "endue.local-agents", "agent.report", report("done")).unwrap();
    let all = runs(&core);
    assert_eq!(all.len(), 1, "the same id updates the run");
    assert_eq!(all[0]["source"]["connector"], "endue.local-agents");
    assert_eq!(all[0]["agent"], "endue.local-agents/codex");
    assert_eq!(all[0]["state"], "done");
    assert!(all[0]["endedAt"].is_string());
    let codex = agent(&core, "endue.local-agents/codex");
    assert_eq!(
        (
            codex["name"].clone(),
            codex["source"].clone(),
            codex["brain"].clone()
        ),
        (json!("Codex"), json!("local"), json!("codex"))
    );
    assert!(
        call(&core, MIRA, "agent.report", report("done")).is_err(),
        "an agent reports nothing"
    );
}

#[test]
fn directory_tasks_become_runs() {
    use std::sync::Arc;
    let echo = common::Echo::start();
    let home = home("runs-directory");
    let brain = Arc::new(desk_brain_endue::HttpBrain::new(echo.url()).unwrap());
    let core = Core::new(roots(&home))
        .with_index_file(home.join("index.sqlite"))
        .with_brain(brain, desk_core::BrainOptions::default());
    grant(&core, "desk", manage());
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    grant(
        &core,
        "desk",
        json!({ "permission": "data:read", "kinds": ["run"] }),
    );
    let scope = json!({ "permission": "brain:converse" });
    let tasks = call(&core, "desk", "brain.tasks.list", json!({ "scope": scope })).unwrap();
    let tasks = tasks["items"].as_array().unwrap();
    assert!(!tasks.is_empty());
    let all = runs(&core);
    assert_eq!(all.len(), tasks.len());
    for task in tasks {
        let run = all.iter().find(|r| r["id"] == task["id"]).unwrap();
        assert_eq!(run["agent"], task["targetAgentId"]);
        assert_eq!(run["source"]["connector"], "desk.agents");
        let target = task["targetAgentId"].as_str().unwrap();
        assert_eq!(agent(&core, target)["source"], "directory");
    }
}
