//! perm.grant (ADR 0131): a perm:manage holder grants another caller a permission for the person,
//! without a prompt, when an act of theirs answers it. The runtime gives the plugin that opens a file
//! the person chose read access to its folder, so opening a file never asks.

mod support;

use std::fs;
use std::path::Path;

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const IMAGES: &str = "example.images";

fn pictures() -> Value {
    json!({ "permission": "fs:read", "paths": ["~/Pictures/trip/**"] })
}

fn give(
    core: &Core,
    caller: &str,
    to: &str,
    permission: Value,
) -> Result<Value, desk_bridge::BridgeError> {
    call(
        core,
        caller,
        "perm.grant",
        json!({
            "caller": to,
            "permission": permission,
            "reason": "The person opened ~/Pictures/trip/beach.png",
            "scope": manage(),
        }),
    )
}

fn read_beach(core: &Core, caller: &str) -> Result<Value, desk_bridge::BridgeError> {
    call(
        core,
        caller,
        "fs.read",
        json!({ "path": "~/Pictures/trip/beach.png", "scope": pictures() }),
    )
}

fn with_picture(tag: &str) -> (Core, std::path::PathBuf) {
    let home = home(tag);
    fs::create_dir_all(home.join("Pictures/trip")).unwrap();
    fs::write(home.join("Pictures/trip/beach.png"), b"png").unwrap();
    // NeverAsk: a read that needed the person would fail the test instead of waiting.
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    grant(&core, "desk", manage());
    (core, home)
}

#[test]
fn a_manager_grants_another_caller_for_the_session_and_its_read_then_passes() {
    let (core, _home) = with_picture("perm-grant");
    assert_eq!(
        read_beach(&core, IMAGES).unwrap_err().code,
        ErrorCode::PermissionDenied
    );
    let answer = give(&core, "desk", IMAGES, pictures()).unwrap();
    assert_eq!(answer["grant"]["permission"], pictures());
    assert_eq!(answer["grant"]["duration"], "session");
    read_beach(&core, IMAGES).unwrap();
    // The holder sees it as its own grant.
    let grants = query(&core, IMAGES);
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0]["grantId"], answer["grant"]["grantId"]);
}

#[test]
fn a_grant_that_already_covers_it_is_answered_as_it_is() {
    let (core, _home) = with_picture("perm-grant-again");
    let wide = json!({ "permission": "fs:read", "paths": ["~/Pictures/**"] });
    let first = give(&core, "desk", IMAGES, wide).unwrap();
    let second = give(&core, "desk", IMAGES, pictures()).unwrap();
    assert_eq!(second["grant"]["grantId"], first["grant"]["grantId"]);
    assert_eq!(query(&core, IMAGES).len(), 1);
}

#[test]
fn only_a_perm_manage_holder_may_grant() {
    let (core, _home) = with_picture("perm-grant-refused");
    let refused = give(&core, IMAGES, IMAGES, pictures()).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert!(query(&core, IMAGES).is_empty());
}

#[test]
fn an_agent_is_never_granted_outside_its_allowlist() {
    let home = home("perm-grant-agent");
    let file = home.join("init.yaml");
    fs::write(
        &file,
        "agents:\n  mira:\n    allow:\n      - { permission: fs:read, paths: [\"~/Notes/**\"] }\n",
    )
    .unwrap();
    let core = Core::new(roots(Path::new(&home)))
        .with_prompter(NeverAsk)
        .with_init_file(file);
    grant(&core, "desk", manage());
    let refused = give(&core, "desk", "agent:mira", pictures()).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    let notes = json!({ "permission": "fs:read", "paths": ["~/Notes/**"] });
    give(&core, "desk", "agent:mira", notes).unwrap();
}
