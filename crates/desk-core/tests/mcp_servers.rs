//! An MCP server's tools are commands of the caller `mcp:<name>` (ADR 0098). It has no manifest, so
//! the core decides what the manifest would: a command the server says only reads is read-only, and
//! every other one is irreversible, so an agent's call of it waits for the person's approval. The
//! server keeps to its own ids, `mcp.<name>.*`.

mod support;

use desk_core::{Core, mcp_caller};
use serde_json::{Value, json};
use support::*;

fn tool(id: &str, read_only: Option<bool>) -> Value {
    let mut params = json!({ "id": id, "title": "Tool", "description": "Does it.", "agent": true });
    if let Some(read_only) = read_only {
        params["readOnly"] = json!(read_only);
    }
    params
}

fn listed(core: &Core, id: &str) -> Value {
    let scope = json!({ "permission": "cmd:invoke", "ids": ["*"] });
    grant(core, "desk", scope.clone());
    let commands = call(core, "desk", "cmd.list", json!({ "scope": scope })).unwrap();
    let all = commands["commands"].as_array().unwrap();
    all.iter().find(|c| c["id"] == id).cloned().unwrap()
}

#[test]
fn an_mcp_servers_command_is_irreversible_unless_read_only() {
    let home = home("mcp-irreversible");
    let core = Core::new(roots(&home));
    let server = mcp_caller("notes").unwrap();
    assert_eq!(server, "mcp:notes");
    call(
        &core,
        &server,
        "cmd.register",
        tool("mcp.notes.search", Some(true)),
    )
    .unwrap();
    call(&core, &server, "cmd.register", tool("mcp.notes.add", None)).unwrap();
    call(
        &core,
        &server,
        "cmd.register",
        tool("mcp.notes.drop", Some(false)),
    )
    .unwrap();

    let search = listed(&core, "mcp.notes.search");
    assert_eq!(search["readOnly"], true);
    assert_eq!(search.get("irreversible"), None);
    for id in ["mcp.notes.add", "mcp.notes.drop"] {
        let acting = listed(&core, id);
        assert_eq!(acting["irreversible"], true, "{id}");
        assert_eq!(acting.get("readOnly"), None, "{id}");
    }
}

#[test]
fn an_mcp_server_registers_only_its_own_ids() {
    let home = home("mcp-own-ids");
    let core = Core::new(roots(&home));
    for id in ["mcp.other.search", "desk.files.open", "mcp.notesx.search"] {
        let refused = call(&core, "mcp:notes", "cmd.register", tool(id, Some(true))).unwrap_err();
        assert!(
            refused.message.contains("mcp.notes."),
            "{id}: {}",
            refused.message
        );
    }
    call(
        &core,
        "mcp:notes",
        "cmd.register",
        tool("mcp.notes.search", Some(true)),
    )
    .unwrap();
}

#[test]
fn a_server_name_desk_can_use() {
    assert_eq!(mcp_caller("github").as_deref(), Some("mcp:github"));
    assert_eq!(mcp_caller("my-tools2").as_deref(), Some("mcp:my-tools2"));
    for bad in ["", "GitHub", "2fa", "a.b", "a:b", &"x".repeat(33)] {
        assert_eq!(mcp_caller(bad), None, "{bad}");
    }
}
