//! Work requests to the agent programs on this computer (ADR 0110): agents.ask runs the program
//! once, read-only unless asked otherwise, in the folder it names, and reports each step as
//! agents.run to the holders of agents:manage; agents.stop ends a run, and a program that fails
//! says why. Fake programs stand in for Claude Code and Codex. Unix only: they are shell scripts.
#![cfg(unix)]

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_core::{Core, LocalAgents, LocalAgentsOptions};
use serde_json::{Value, json};
use support::*;

const SESSION: &str = "11111111-1111-4111-8111-111111111111";

fn desk(home: &Path, bin: PathBuf) -> Core {
    let options = LocalAgentsOptions {
        home: home.to_path_buf(),
        claude_home: home.join(".claude"),
        codex_home: home.join(".codex"),
        app_data: None,
        data: None,
        path: None,
        extra_path: vec![bin],
    };
    let core = Core::new(roots(home)).with_local_agents(LocalAgents::new(options));
    grant(&core, "desk", json!({ "permission": "agents:manage" }));
    core
}

fn agents(core: &Core, method: &str, mut params: Value) -> Result<Value, desk_bridge::BridgeError> {
    params["scope"] = json!({ "permission": "agents:manage" });
    call(core, "desk", method, params)
}

fn program(bin: &Path, name: &str, script: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(bin).unwrap();
    let path = bin.join(name);
    fs::write(&path, script).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn a_work_request_runs_the_program_read_only_and_reports_each_step() {
    let home = home("agents-ask");
    let bin = home.join("bin");
    let init = json!({ "type": "system", "subtype": "init", "session_id": SESSION });
    let said = json!({ "type": "assistant", "message": { "content": [
        { "type": "text", "text": "Running the tests." },
        { "type": "tool_use", "name": "Bash", "input": { "command": "pnpm test" } }] } });
    let result = json!({ "type": "result", "subtype": "success", "result": "Two tests fail.", "session_id": SESSION });
    let at = bin.display();
    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{at}/args.txt'\npwd > '{at}/cwd.txt'\necho '{init}'\necho '{said}'\necho '{result}'\n"
    );
    program(&bin, "claude", &script);
    let work = home.join("work");
    fs::create_dir_all(&work).unwrap();
    let core = desk(&home, bin.clone());
    let listed = agents(&core, "agents.list", json!({})).unwrap();
    assert_eq!(
        listed["agents"][0]["program"],
        bin.join("claude").display().to_string()
    );
    let deliveries = core.events().subscribe_addressed();

    let ask = json!({ "agent": "claude", "prompt": "-run the tests", "sessionId": SESSION, "cwd": "~/work" });
    let started = agents(&core, "agents.ask", ask).unwrap();
    let run_id = started["run"]["runId"].as_str().unwrap().to_owned();
    assert_eq!(started["run"]["state"], "running");
    assert_eq!(started["run"]["access"], "read-only");
    assert_eq!(started["run"]["caller"], "desk");

    let mut kinds = Vec::new();
    let end = loop {
        let step = wait_for(&deliveries, "agents.run");
        assert!(step.is_for("desk"));
        assert_eq!(step.data()["runId"], run_id.as_str());
        let kind = step.data()["kind"].as_str().unwrap().to_owned();
        kinds.push(kind.clone());
        if kind != "started" && kind != "text" && kind != "tool" {
            break step;
        }
    };
    assert_eq!(kinds, ["started", "text", "tool", "done"]);
    let run = &end.data()["run"];
    assert_eq!(run["state"], "done");
    assert_eq!(run["text"], "Two tests fail.");
    assert_eq!(run["tools"], 1);
    assert_eq!(run["sessionId"], SESSION);
    assert!(run["endedAt"].is_string());

    let args = fs::read_to_string(bin.join("args.txt")).unwrap();
    let args: Vec<&str> = args.lines().collect();
    assert_eq!(
        args,
        [
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-mode",
            "plan",
            "--resume",
            SESSION,
            " -run the tests"
        ]
    );
    let cwd = fs::read_to_string(bin.join("cwd.txt")).unwrap();
    assert_eq!(
        fs::canonicalize(cwd.trim()).unwrap(),
        fs::canonicalize(&work).unwrap()
    );

    let runs = agents(&core, "agents.runs", json!({ "agent": "claude" })).unwrap();
    assert_eq!(runs["runs"][0]["state"], "done");
    assert_eq!(
        agents(&core, "agents.runs", json!({ "agent": "codex" })).unwrap()["runs"],
        json!([])
    );
    let ended = agents(&core, "agents.stop", json!({ "runId": run_id })).unwrap_err();
    assert_eq!(serde_json::to_value(ended.code).unwrap(), "not_found");
}

#[test]
fn a_run_that_is_stopped_ends_stopped_and_one_that_fails_says_why() {
    let home = home("agents-stop");
    let bin = home.join("bin");
    program(&bin, "codex", "#!/bin/sh\nexec sleep 30\n");
    program(
        &bin,
        "claude",
        "#!/bin/sh\necho 'quota reached' >&2\nexit 3\n",
    );
    let core = desk(&home, bin);
    let deliveries = core.events().subscribe_addressed();

    let ask = json!({ "agent": "codex", "prompt": "Rename the loader", "access": "agent" });
    let started = agents(&core, "agents.ask", ask).unwrap();
    let run_id = started["run"]["runId"].as_str().unwrap().to_owned();
    assert_eq!(started["run"]["access"], "agent");
    let stopped = agents(&core, "agents.stop", json!({ "runId": run_id })).unwrap();
    assert_eq!(stopped["run"]["state"], "stopped");
    let end = loop {
        let step = wait_for(&deliveries, "agents.run");
        if step.data()["kind"] != "started" {
            break step;
        }
    };
    assert_eq!(end.data()["kind"], "stopped");
    assert_eq!(end.data()["run"]["state"], "stopped");

    agents(
        &core,
        "agents.ask",
        json!({ "agent": "claude", "prompt": "hi" }),
    )
    .unwrap();
    let end = loop {
        let step = wait_for(&deliveries, "agents.run");
        if step.data()["kind"] != "started" {
            break step;
        }
    };
    assert_eq!(end.data()["kind"], "failed");
    assert_eq!(end.data()["run"]["error"], "quota reached");
}
