//! What an agent may run of an installed plugin (ADR 0268, ADR 0367): a command the plugin offers
//! agents (`agent`) runs without a question; one it keeps for the person asks, as any call does; and
//! no agent runs a command of a plugin that answers the person's questions (`perm:manage`), whatever
//! it holds, so an agent never answers an approval.

mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use desk_bridge::{BridgeError, ErrorCode, Permission};
use desk_core::{Core, Prompter};
use serde_json::{Value, json};
use support::*;

const MIRA: &str = "agent:mira";
const GIT: &str = "example.git";
const ASKS: &str = "example.asks";

/// The person, who says no and is counted each time they are asked.
#[derive(Clone, Default)]
struct SaysNo(Arc<AtomicUsize>);

impl SaysNo {
    fn asked(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

impl Prompter for SaysNo {
    fn ask(&self, _caller: &str, _permission: &Permission, _reason: &str) -> bool {
        self.0.fetch_add(1, Ordering::SeqCst);
        false
    }
}

/// A core whose person says no, with nobody holding perm:manage, and whose desk runs any command.
fn core(home: &Path) -> (Core, SaysNo) {
    let file = home.join("init.yaml");
    fs::write(&file, "").unwrap();
    let person = SaysNo::default();
    let core = Core::new(roots(home))
        .with_prompter(person.clone())
        .with_init_file(file);
    grant(
        &core,
        "desk",
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    (core, person)
}

/// Install `id` with `commands` and `permissions` in its manifest and register each command.
fn plugin(core: &Core, home: &Path, id: &str, commands: Value, permissions: Value) {
    let dir = home.join("plugins").join(id);
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>x</p>").unwrap();
    let manifest = json!({ "id": id, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "permissions": permissions, "contributes": { "commands": commands } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    for command in commands.as_array().unwrap() {
        let registered = json!({ "id": command["id"], "title": command["title"] });
        call(core, id, "cmd.register", registered).unwrap();
    }
}

fn invoke(core: &Core, caller: &str, id: &str) -> Result<Value, BridgeError> {
    let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
    call(
        core,
        caller,
        "cmd.invoke",
        json!({ "id": id, "scope": scope }),
    )
}

#[test]
fn a_command_the_plugin_keeps_for_the_person_asks_an_agent_while_its_agent_commands_do_not() {
    let home = home("agent-gate-offered");
    let (core, person) = core(&home);
    let commands = json!([
        { "id": "example.git.state", "title": "Git: state", "description": "The branch.",
          "agent": true, "readOnly": true },
        { "id": "example.git.wipe", "title": "Git: wipe the work tree" }
    ]);
    plugin(&core, &home, GIT, commands, json!([]));

    assert!(
        invoke(&core, MIRA, "example.git.state").is_ok(),
        "offered to agents"
    );
    assert_eq!(person.asked(), 0);
    let refused = invoke(&core, MIRA, "example.git.wipe").unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert_eq!(person.asked(), 1, "asked, and refused");
    // The person, as ever, runs it.
    assert!(invoke(&core, "desk", "example.git.wipe").is_ok());
}

#[test]
fn a_grant_still_lets_an_agent_run_a_command_kept_for_the_person() {
    let home = home("agent-gate-granted");
    let (core, person) = core(&home);
    let commands = json!([{ "id": "example.git.wipe", "title": "Git: wipe the work tree" }]);
    plugin(&core, &home, GIT, commands, json!([]));
    grant(
        &core,
        MIRA,
        json!({ "permission": "cmd:invoke", "ids": ["example.git.wipe"] }),
    );
    assert!(invoke(&core, MIRA, "example.git.wipe").is_ok());
    assert_eq!(person.asked(), 0);
}

#[test]
fn no_agent_runs_a_command_of_a_plugin_that_answers_the_persons_questions() {
    let home = home("agent-gate-manage");
    let (core, person) = core(&home);
    let commands = json!([
        { "id": "example.asks.approve", "title": "Approve the run",
          "description": "Approve the approval a run waits for.", "agent": true },
        { "id": "example.asks.deny", "title": "Deny the run" }
    ]);
    plugin(
        &core,
        &home,
        ASKS,
        commands,
        json!([{ "permission": "perm:manage" }]),
    );
    let ids = json!({ "permission": "cmd:invoke", "ids": ["example.asks.*"] });
    grant(&core, MIRA, ids);
    for id in ["example.asks.approve", "example.asks.deny"] {
        let refused = invoke(&core, MIRA, id).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{id}");
    }
    assert_eq!(person.asked(), 0, "refused without a question");
    // The person answers through it as before.
    assert!(invoke(&core, "desk", "example.asks.approve").is_ok());
}
