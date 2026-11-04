//! An agent controls plugins through their commands (ADR 0084), against examples/brain-echo: the
//! desk's turns offer desk-tools, desk-run and every agent command by name; a tool call by a
//! command's name, by desk-run or by its id runs the command as `agent:<id>`, asking the person
//! for that one command and answering what the provider answers; desk-tools answers cmd.tools.

mod common;
mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::Echo;
use desk_brain::{
    Brain, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest,
    Session, ToolDefinition, ToolResultRequest, TurnEvent, TurnRequest,
};
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

const GIT: &str = "example.git";

/// brain-echo, keeping the tools each desk turn offers.
struct Recording {
    inner: HttpBrain,
    offered: Mutex<Vec<Option<Vec<ToolDefinition>>>>,
}

/// Brain methods handed straight to brain-echo.
macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

impl Brain for Recording {
    pass! {
        create_session(request: &CreateSessionRequest) -> Session;
        get_session(session: &str) -> Session;
        get_lease(session: &str) -> Lease;
        acquire_lease(session: &str, request: &LeaseAcquireRequest) -> Lease;
        renew_lease(session: &str, lease: &str, request: &LeaseRenewRequest) -> Lease;
        release_lease(session: &str, lease: &str) -> ();
    }
    fn create_turn(
        &self,
        session: &str,
        request: &TurnRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.offered.lock().unwrap().push(request.tools.clone());
        self.inner.create_turn(session, request, on)
    }
    fn submit_tool_result(
        &self,
        session: &str,
        turn: &str,
        request: &ToolResultRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.inner.submit_tool_result(session, turn, request, on)
    }
}

/// A shared core on a recording brain-echo that routes tool calls; the person answers as `desk`.
fn core(echo: &Echo, home: &Path) -> (Arc<Core>, Arc<Recording>, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, "").unwrap();
    let brain = Arc::new(Recording {
        inner: HttpBrain::new(echo.url()).unwrap(),
        offered: Mutex::new(Vec::new()),
    });
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file)
        .with_brain(brain.clone(), options);
    let core = Arc::new(core);
    core.route_tools();
    for permission in ["brain:converse", "perm:manage"] {
        grant(&core, "desk", json!({ "permission": permission }));
    }
    let deliveries = core.events().subscribe_addressed();
    (core, brain, deliveries)
}

/// `example.git` with one read-only agent command, `example.git.state`.
fn git_plugin(core: &Core, home: &Path) {
    let dir = home.join("plugins/git");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>git</p>").unwrap();
    let manifest = json!({ "id": GIT, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "contributes": { "commands": [
            { "id": "example.git.state", "title": "Git: state",
              "description": "The branch and the changed files.",
              "args": { "type": "object", "properties": { "path": { "type": "string" } } },
              "agent": true, "readOnly": true } ] } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    let registered = json!({ "id": "example.git.state", "title": "Git: state" });
    call(core, GIT, "cmd.register", registered).unwrap();
}

fn say(core: &Core, text: &str) -> String {
    let params = json!({ "text": text, "scope": { "permission": "brain:converse" } });
    let said = call(core, "desk", "brain.say", params).unwrap();
    said["turnId"].as_str().unwrap().to_owned()
}

/// The turn's answer once it completes, after the provider answered `example.git.state` with
/// `result` whenever the agent invoked it; `invoked` keeps each cmd.invoked's data.
fn answer(
    core: &Core,
    deliveries: &Receiver<Delivery>,
    turn: &str,
    result: Value,
    invoked: &mut Vec<Value>,
) -> String {
    let mut text = String::new();
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .expect("a delivery within 10 s");
        let event = serde_json::to_value(delivery.event).unwrap();
        let (name, data) = (event["event"].as_str().unwrap_or(""), &event["data"]);
        if name == "cmd.invoked" {
            invoked.push(data.clone());
            let answered = json!({ "invocationId": data["invocationId"], "result": result });
            call(core, GIT, "cmd.answer", answered).unwrap();
        }
        if name != "brain.turn" || data["turnId"] != turn {
            continue;
        }
        match data["kind"].as_str().unwrap() {
            "delta" => text.push_str(data["text"].as_str().unwrap()),
            "completed" => return text,
            "error" => panic!("the turn failed: {data}"),
            _ => {}
        }
    }
}

fn names(offered: &Option<Vec<ToolDefinition>>) -> Vec<String> {
    let tools = offered.as_deref().unwrap_or_default();
    tools.iter().map(|t| t.name.clone()).collect()
}

#[test]
fn a_desk_turn_offers_the_desks_tools_once_a_plugin_has_agent_commands() {
    let echo = Echo::start();
    let home = home("agent-tools-offer");
    let (core, brain, deliveries) = core(&echo, &home);
    let turn = say(&core, "hello");
    answer(&core, &deliveries, &turn, json!(null), &mut Vec::new());
    git_plugin(&core, &home);
    let turn = say(&core, "hello again");
    answer(&core, &deliveries, &turn, json!(null), &mut Vec::new());

    let offered = brain.offered.lock().unwrap().clone();
    assert_eq!(offered[0], None, "no agent commands, no tools");
    assert_eq!(
        names(&offered[1]),
        ["desk-tools", "desk-run", "example_git_state"]
    );
    let state = &offered[1].as_ref().unwrap()[2];
    assert!(
        state
            .description
            .starts_with("The branch and the changed files.")
    );
    assert!(state.description.ends_with("It only reads."));
    assert_eq!(state.schema["properties"]["path"]["type"], "string");
}

#[test]
fn an_agent_runs_a_command_by_its_tool_name_after_the_person_allows_that_command() {
    let echo = Echo::start();
    let home = home("agent-tools-name");
    let (core, _brain, deliveries) = core(&echo, &home);
    git_plugin(&core, &home);
    let turn = say(
        &core,
        r#"tool example_git_state as mira: {"path": "~/repo"}"#,
    );

    let prompt = wait_for(&deliveries, "perm.prompt");
    assert_eq!(prompt.data()["caller"], "agent:mira");
    let scope = json!({ "permission": "cmd:invoke", "ids": ["example.git.state"] });
    assert_eq!(prompt.data()["permission"], scope);
    let params = json!({ "promptId": prompt.data()["promptId"], "granted": true,
        "duration": "session", "scope": manage() });
    call(&core, "desk", "perm.answer", params).unwrap();

    let mut invoked = Vec::new();
    let state = json!({ "branch": "main", "changed": 2 });
    let said = answer(&core, &deliveries, &turn, state, &mut invoked);
    assert_eq!(invoked.len(), 1);
    assert_eq!(invoked[0]["caller"], "agent:mira");
    assert_eq!(invoked[0]["args"], json!({ "path": "~/repo" }));
    assert!(said.contains("The example_git_state tool said:"), "{said}");
    assert!(said.contains(r#""branch":"main""#), "{said}");
}

#[test]
fn desk_run_and_the_command_id_run_it_too_and_desk_tools_lists_it() {
    let echo = Echo::start();
    let home = home("agent-tools-run");
    let (core, _brain, deliveries) = core(&echo, &home);
    git_plugin(&core, &home);
    grant(
        &core,
        "agent:mira",
        json!({ "permission": "cmd:invoke", "ids": ["example.git.*"] }),
    );
    let lines = [
        r#"tool desk-run as mira: {"command": "example.git.state", "args": {"path": "~/a"}}"#,
        r#"tool example.git.state as mira: {"path": "~/b"}"#,
        r#"tool desk-tools as mira: {"query": "changed"}"#,
    ];
    let turn = say(&core, &lines.join("\n"));
    let mut invoked = Vec::new();
    let said = answer(
        &core,
        &deliveries,
        &turn,
        json!({ "branch": "main" }),
        &mut invoked,
    );
    let args: Vec<&Value> = invoked.iter().map(|i| &i["args"]).collect();
    assert_eq!(args, [&json!({ "path": "~/a" }), &json!({ "path": "~/b" })]);
    assert!(said.contains("The desk-run tool said:"), "{said}");
    assert!(said.contains("The example.git.state tool said:"), "{said}");
    assert!(said.contains("The desk-tools tool said:"), "{said}");
    assert!(said.contains(r#""name":"example_git_state""#), "{said}");
    assert!(said.contains(r#""granted":true"#), "{said}");
}

#[test]
fn a_tool_call_naming_no_command_fails_with_what_desk_has() {
    let echo = Echo::start();
    let home = home("agent-tools-unknown");
    let (core, _brain, deliveries) = core(&echo, &home);
    git_plugin(&core, &home);
    let lines = [
        r#"tool desk-run as mira: {"command": "example.git.nothing"}"#,
        r#"tool desk-run as mira: {"command": "example.git.state", "args": [1]}"#,
        r#"tool example_git_nothing as mira: {}"#,
    ];
    let turn = say(&core, &lines.join("\n"));
    let mut invoked = Vec::new();
    let said = answer(&core, &deliveries, &turn, json!(null), &mut invoked);
    assert!(invoked.is_empty());
    assert!(
        said.contains("Desk has no command example.git.nothing"),
        "{said}"
    );
    assert!(said.contains("desk-run takes { command, args? }"), "{said}");
    assert!(
        said.contains("Desk has no tool named example_git_nothing"),
        "{said}"
    );
}
