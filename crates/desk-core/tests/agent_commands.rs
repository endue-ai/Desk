//! Commands as agents' tools (ADR 0088): a registration takes what it leaves out from the manifest,
//! an agent command needs a description and an irreversible one never reads only, and cmd.tools
//! lists the agent commands an agent's allowlist could let it run, or another caller's grants cover.

mod support;

use std::fs;
use std::path::Path;

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const GIT: &str = "example.git";
const MIRA: &str = "agent:mira";

fn core_with(home: &Path, init: &str) -> Core {
    let file = home.join("init.yaml");
    fs::write(&file, init).unwrap();
    Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file)
}

/// `example.git`: a read-only agent command with schemas, an irreversible one, and one for people.
fn git_plugin(core: &Core, home: &Path) {
    let dir = home.join("plugins/git");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>git</p>").unwrap();
    let manifest = json!({ "id": GIT, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "contributes": { "commands": [
            { "id": "example.git.state", "title": "Git: state", "keywords": ["branch"],
              "description": "The branch and the changed files.",
              "args": { "type": "object", "properties": { "path": { "type": "string" } },
                        "additionalProperties": false },
              "result": { "type": "object" }, "agent": true, "readOnly": true },
            { "id": "example.git.push", "title": "Git: push", "description": "Push the branch.",
              "agent": true, "irreversible": true },
            { "id": "example.git.open", "title": "Git: open" } ] } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    for id in ["example.git.state", "example.git.push", "example.git.open"] {
        call(core, GIT, "cmd.register", json!({ "id": id, "title": id })).unwrap();
    }
}

fn every_command() -> Value {
    json!({ "permission": "cmd:invoke", "ids": ["*"] })
}

fn tools(core: &Core, caller: &str, params: Value) -> Vec<Value> {
    let listed = call(core, caller, "cmd.tools", params).unwrap();
    listed["tools"].as_array().unwrap().clone()
}

fn commands_of(tools: &[Value]) -> Vec<&str> {
    tools
        .iter()
        .map(|t| t["command"].as_str().unwrap())
        .collect()
}

#[test]
fn a_registration_takes_what_it_leaves_out_from_the_manifest() {
    let home = home("agent-cmd-manifest");
    let core = core_with(&home, "");
    git_plugin(&core, &home);
    grant(&core, "desk", every_command());
    let listed = call(
        &core,
        "desk",
        "cmd.list",
        json!({ "scope": every_command() }),
    )
    .unwrap();
    let commands = listed["commands"].as_array().unwrap();
    let state = &commands[0];
    assert_eq!(state["description"], "The branch and the changed files.");
    assert_eq!(state["argsSchema"]["properties"]["path"]["type"], "string");
    assert_eq!(state["resultSchema"], json!({ "type": "object" }));
    assert_eq!(
        (state["agent"].clone(), state["readOnly"].clone()),
        (json!(true), json!(true))
    );
    assert_eq!(commands[1]["irreversible"], true);
    assert!(commands[2].get("agent").is_none(), "{}", commands[2]);

    // The manifest's args are checked like any argsSchema.
    let params = json!({ "id": "example.git.state", "args": { "branch": 1 },
        "scope": every_command() });
    let refused = call(&core, "desk", "cmd.invoke", params).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidParams);

    // What the call says wins over the manifest: agent false takes the command off the tools.
    let updated = json!({ "id": "example.git.state", "title": "State", "agent": false });
    call(&core, GIT, "cmd.register", updated).unwrap();
    let left = tools(&core, "desk", json!({}));
    assert_eq!(commands_of(&left), ["example.git.push"]);
}

#[test]
fn an_agent_command_needs_a_description_and_an_irreversible_one_never_reads_only() {
    let home = home("agent-cmd-rules");
    let core = core_with(&home, "");
    git_plugin(&core, &home);
    let bare = json!({ "id": "example.git.blame", "title": "Blame", "agent": true });
    let refused = call(&core, GIT, "cmd.register", bare).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidParams);
    assert!(
        refused.message.contains("description"),
        "{}",
        refused.message
    );
    let empty = json!({ "id": "example.git.blame", "title": "Blame", "agent": true,
        "description": "" });
    assert!(call(&core, GIT, "cmd.register", empty).is_err());

    let reading = json!({ "id": "example.git.push", "title": "Push", "readOnly": true });
    let refused = call(&core, GIT, "cmd.register", reading).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidParams);
    // The refused update left the command as it was.
    grant(&core, "desk", every_command());
    let push = &tools(&core, "desk", json!({ "query": "push" }))[0];
    assert_eq!(push["irreversible"], true);
    assert!(push.get("readOnly").is_none());

    let described = json!({ "id": "example.git.blame", "title": "Blame", "agent": true,
        "description": "Who changed each line.", "readOnly": true,
        "resultSchema": { "type": "array" } });
    call(&core, GIT, "cmd.register", described).unwrap();
    let blame = &tools(&core, "desk", json!({ "query": "blame" }))[0];
    assert_eq!(blame["name"], "example_git_blame");
    assert_eq!(blame["resultSchema"], json!({ "type": "array" }));
}

#[test]
fn a_caller_that_is_no_agent_sees_the_tools_its_grants_cover() {
    let home = home("agent-cmd-callers");
    let core = core_with(&home, "");
    git_plugin(&core, &home);
    assert!(tools(&core, NOTES, json!({})).is_empty());
    grant(
        &core,
        NOTES,
        json!({ "permission": "cmd:invoke", "ids": ["example.git.state"] }),
    );
    let shown = tools(&core, NOTES, json!({}));
    assert_eq!(commands_of(&shown), ["example.git.state"]);
    assert_eq!(shown[0]["granted"], true);
    assert_eq!(shown[0]["provider"], GIT);
    assert_eq!(shown[0]["title"], "example.git.state");

    grant(&core, "desk", every_command());
    let all = tools(&core, "desk", json!({}));
    assert_eq!(commands_of(&all), ["example.git.state", "example.git.push"]);
    let first = tools(&core, "desk", json!({ "limit": 1 }));
    assert_eq!(commands_of(&first), ["example.git.state"]);
    let found = tools(&core, "desk", json!({ "query": "GIT Changed" }));
    assert_eq!(commands_of(&found), ["example.git.state"]);
}

#[test]
fn an_agent_sees_what_its_allowlist_could_let_it_run_and_what_it_holds() {
    let home = home("agent-cmd-agent");
    let core = core_with(&home, "");
    git_plugin(&core, &home);
    let shown = tools(&core, MIRA, json!({}));
    assert_eq!(
        commands_of(&shown),
        ["example.git.state", "example.git.push"]
    );
    assert!(shown.iter().all(|t| t["granted"] == false), "{shown:?}");

    grant(
        &core,
        MIRA,
        json!({ "permission": "cmd:invoke", "ids": ["example.git.state"] }),
    );
    let shown = tools(&core, MIRA, json!({}));
    assert_eq!(shown[0]["granted"], true);
    assert_eq!(shown[1]["granted"], false);

    let capped = "agents:\n  mira:\n    allow:\n      - { permission: cmd:invoke, ids: [\"example.git.state\"] }\n";
    fs::write(home.join("init.yaml"), capped).unwrap();
    let shown = tools(&core, MIRA, json!({}));
    assert_eq!(commands_of(&shown), ["example.git.state"]);
    // Another agent, with no allowlist of its own, still sees both.
    assert_eq!(tools(&core, "agent:theo", json!({})).len(), 2);
}

#[test]
fn a_tool_goes_when_its_provider_unregisters_it() {
    let home = home("agent-cmd-gone");
    let core = core_with(&home, "");
    git_plugin(&core, &home);
    call(
        &core,
        GIT,
        "cmd.unregister",
        json!({ "id": "example.git.push" }),
    )
    .unwrap();
    let shown = tools(&core, MIRA, json!({}));
    assert_eq!(commands_of(&shown), ["example.git.state"]);
}
