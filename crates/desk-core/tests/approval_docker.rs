//! Bind Docker approvals and shell gestures to exact built-in command invocations.

mod support;

use std::path::Path;

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const DOCKER: &str = "endue.docker";
const TERMINAL: &str = "endue.terminal";
const KILL: &str = "endue.docker.kill";
const RUN: &str = "endue.terminal.run";
const AGENT: &str = "agent:eris";

fn plugin(core: &Core, folder: &str, id: &str, built_in: bool) {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../plugins")
        .join(folder);
    let provider = id.rsplit_once('.').unwrap().0;
    assert_eq!(core.install_plugin(&dir, built_in).id, provider);
    call(
        core,
        provider,
        "cmd.register",
        json!({ "id": id, "title": id }),
    )
    .unwrap();
}

fn invoke(
    core: &Core,
    caller: &str,
    id: &str,
    args: Value,
) -> Result<Value, desk_bridge::BridgeError> {
    call(
        core,
        caller,
        "cmd.invoke",
        json!({ "id": id, "args": args, "scope": { "permission": "cmd:invoke", "ids": [id] } }),
    )
}

#[test]
fn only_a_named_builtin_docker_action_reuses_its_review() {
    for built_in in [true, false] {
        let home = home("docker-action-review");
        let core = Core::new(roots(&home)).with_prompter(NeverAsk);
        plugin(&core, "docker", KILL, built_in);
        grant(&core, "desk", manage());
        grant(
            &core,
            AGENT,
            json!({ "permission": "cmd:invoke", "ids": [KILL] }),
        );
        let events = core.events().subscribe_addressed();
        if built_in {
            assert_eq!(
                invoke(&core, AGENT, KILL, json!({})).unwrap_err().code,
                ErrorCode::InvalidParams
            );
        }
        let (_, called) = held(&core, &events, "once", || {
            invoke(&core, AGENT, KILL, json!({ "container": "web" }))
        });
        let delivery = wait_for(&events, "cmd.invoked");
        assert_eq!(
            delivery.data()["invocationId"],
            called.unwrap()["invocationId"]
        );
        assert_eq!(
            delivery.data().get("approved").and_then(Value::as_bool),
            built_in.then_some(true)
        );
    }
}

#[test]
fn only_an_exact_shell_from_a_builtin_docker_surface_gets_terminal_approval() {
    for (built_in, argv, expected) in [
        (true, vec!["exec", "-it", "--", "web", "/bin/sh"], true),
        (
            true,
            vec!["exec", "-it", "--", "web", "/bin/sh", "-c"],
            false,
        ),
        (true, vec!["run", "alpine"], false),
        (false, vec!["exec", "-it", "--", "web", "/bin/sh"], false),
    ] {
        let home = home("docker-shell-gesture");
        let core = Core::new(roots(&home)).with_prompter(NeverAsk);
        plugin(&core, "terminal", RUN, true);
        plugin(&core, "docker", KILL, built_in);
        grant(
            &core,
            DOCKER,
            json!({ "permission": "cmd:invoke", "ids": [RUN] }),
        );
        let events = core.events().subscribe_addressed();
        let invoked = invoke(
            &core,
            DOCKER,
            RUN,
            json!({"command": "docker", "args": argv, "dockerShell": true}),
        )
        .unwrap();
        let delivery = wait_for(&events, "cmd.invoked");
        assert_eq!(
            delivery.data().get("approved").and_then(Value::as_bool),
            expected.then_some(true)
        );
        let scope = json!({"permission": "proc:spawn", "commands": ["docker"], "pty": true});
        let answer = call(
            &core,
            TERMINAL,
            "perm.request",
            json!({"invocationId": invoked["invocationId"], "permission": scope}),
        )
        .unwrap();
        assert_eq!(answer["granted"], expected);
        assert_eq!(call(&core, TERMINAL, "proc.spawn", json!({
            "invocationId": invoked["invocationId"], "command": "docker", "args": ["run", "--help"],
            "pty": {"cols": 80, "rows": 24}, "scope": scope
        })).unwrap_err().code, ErrorCode::PermissionDenied);
    }
}
