//! Distinguish the desk's automatic activation of a plugin from the person's saved choice.

mod support;

use std::{fs, path::Path};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, plugin_manage, roots};

const PLUGIN: &str = "example.autoload";
const READ: &str = "example.autoload.read";
const DESCRIPTION: &str = "Read the document.";

fn open(home: &Path) -> Core {
    let dir = home.join("plugin");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>Reader</p>").unwrap();
    fs::write(
        dir.join("plugin.json"),
        json!({ "id": PLUGIN, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
            "autoload": true,
            "contributes": { "commands": [{ "id": READ, "title": "Read",
                "agent": true, "readOnly": true, "description": DESCRIPTION,
                "args": { "type": "object", "properties": {} } }] } })
        .to_string(),
    )
    .unwrap();
    let core = Core::new(roots(home))
        .with_init_file(home.join("init.yaml"))
        .with_plugin_store(home.join("plugins.json"));
    core.install_plugin(&dir, true);
    grant(&core, "desk", plugin_manage());
    core
}

fn info(core: &Core) -> Value {
    let list = call(
        core,
        "desk",
        "plugin.list",
        json!({ "scope": plugin_manage() }),
    )
    .unwrap();
    list["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == PLUGIN)
        .unwrap()
        .clone()
}

fn toggle(core: &Core, caller: &str, enabled: bool, automatic: bool) -> Result<Value, BridgeError> {
    let mut params = json!({ "plugin": PLUGIN, "enabled": enabled, "scope": plugin_manage() });
    if automatic {
        params["automatic"] = json!(true);
    }
    call(core, caller, "plugin.setEnabled", params)
}

#[test]
fn automatic_activation_survives_a_restart_and_preserves_eligibility_after_closing() {
    let home = home("plugin-autoload");
    let desk = open(&home);
    assert_eq!(info(&desk)["enabled"], false);
    assert_eq!(info(&desk)["autoStart"], true);
    toggle(&desk, "desk", true, true).unwrap();
    drop(desk);

    let desk = open(&home);
    assert_eq!(info(&desk)["enabled"], true);
    assert_eq!(info(&desk)["autoStart"], true);
    toggle(&desk, "desk", false, true).unwrap();
    assert_eq!(info(&desk)["enabled"], false);
    assert_eq!(info(&desk)["autoStart"], true);
}

#[test]
fn a_manual_or_init_disable_leaves_a_plugin_ineligible_for_automatic_activation() {
    let home = home("plugin-auto-blocked");
    let desk = open(&home);
    toggle(&desk, "desk", false, false).unwrap();
    assert!(info(&desk).get("autoStart").is_none());
    let err = toggle(&desk, "desk", true, true).unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied);
    drop(desk);
    assert!(info(&open(&home)).get("autoStart").is_none());

    let held = support::home("plugin-auto-held");
    fs::write(
        held.join("init.yaml"),
        "version: 0\nplugins:\n  disabled: [example.autoload]\n",
    )
    .unwrap();
    let desk = open(&held);
    assert_eq!(info(&desk)["heldOff"], "init");
    assert!(info(&desk).get("autoStart").is_none());
    assert_eq!(
        toggle(&desk, "desk", true, true).unwrap_err().code,
        ErrorCode::PermissionDenied
    );
}

#[test]
fn only_the_desk_uses_automatic_activation_and_manual_on_wins_over_release() {
    let desk = open(&home("plugin-auto-manual"));
    grant(&desk, "cli", plugin_manage());
    assert_eq!(
        toggle(&desk, "cli", true, true).unwrap_err().code,
        ErrorCode::PermissionDenied
    );
    toggle(&desk, "desk", true, true).unwrap();
    toggle(&desk, "desk", true, false).unwrap();
    assert!(info(&desk).get("autoStart").is_none());
    assert_eq!(
        toggle(&desk, "desk", false, true).unwrap_err().code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(info(&desk)["enabled"], true);
}

#[test]
fn a_builtin_provides_the_agent_contract_declared_in_its_manifest() {
    let desk = open(&home("plugin-agent-manifest"));
    toggle(&desk, "desk", true, false).unwrap();
    let register = |id, extra: Value| {
        let mut params = json!({ "id": id, "title": "Read" });
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        call(&desk, PLUGIN, "cmd.register", params)
    };
    register(READ, json!({})).unwrap();
    let tool = call(&desk, "agent:eris", "cmd.tools", json!({})).unwrap();
    assert_eq!(tool["tools"][0]["description"], DESCRIPTION);
    assert_eq!(tool["tools"][0]["readOnly"], true);
    assert_eq!(
        register(
            READ,
            json!({ "agent": true, "description": "Another description" })
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidParams
    );
    assert_eq!(
        register(
            "example.autoload.extra",
            json!({ "agent": true, "description": DESCRIPTION })
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidParams
    );
}
