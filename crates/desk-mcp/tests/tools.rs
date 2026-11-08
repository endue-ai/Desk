//! The tools against a real desk with two plugins and the runtime: the catalog shows every plugin's
//! commands; running one is the agent's call, refused until the person allows it, held for approval
//! when the plugin marks it irreversible; the plugins `--plugin` names get a tool per command.
#![cfg(unix)]

mod support;

use desk_mcp::{CALL_BRIDGE, LIST_COMMANDS, LIST_PLUGINS, PROTOCOL_VERSIONS, RUN_COMMAND};
use serde_json::{Value, json};
use support::{AGENT, Desk, Mcp};

fn ids(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect()
}

#[test]
fn list_plugins_shows_every_plugin_with_the_commands_it_provides() {
    let desk = Desk::start();
    let (mut mcp, _) = Mcp::initialized(desk.options(&[]), PROTOCOL_VERSIONS[0]);
    let (all, is_error) = mcp.tool(LIST_PLUGINS, json!({}));
    assert!(!is_error, "{all}");
    assert_eq!(ids(&all["plugins"]), ["example.git", "example.notes"]);
    let git = &all["plugins"][0];
    assert_eq!(git["kind"], "ui");
    assert_eq!(git["enabled"], true);
    assert_eq!(git["description"], "The example.git example");
    assert_eq!(
        ids(&git["commands"]),
        ["example.git.status", "example.git.push"]
    );
    assert_eq!(ids(&all["desk"]["commands"]), ["desk.theme.toggle"]);

    let (notes, _) = mcp.tool(LIST_PLUGINS, json!({ "plugin": "example.notes" }));
    assert_eq!(ids(&notes["plugins"]), ["example.notes"]);
    assert!(notes.get("desk").is_none());
    let (missing, is_error) = mcp.tool(LIST_PLUGINS, json!({ "plugin": "example.none" }));
    assert!(is_error);
    assert_eq!(missing["error"]["code"], "not_found");
}

#[test]
fn list_commands_filters_by_plugin_and_words_and_says_what_is_irreversible() {
    let desk = Desk::start();
    let (mut mcp, _) = Mcp::initialized(desk.options(&[]), PROTOCOL_VERSIONS[0]);
    let (all, _) = mcp.tool(LIST_COMMANDS, json!({}));
    let commands = &all["commands"];
    assert_eq!(
        ids(commands),
        [
            "example.git.status",
            "example.git.push",
            "example.notes.open",
            "desk.theme.toggle"
        ]
    );
    assert_eq!(commands[1]["irreversible"], true);
    assert!(commands[0].get("irreversible").is_none());
    assert_eq!(commands[2]["argsSchema"]["required"], json!(["path"]));
    assert_eq!(commands[2]["provider"], "example.notes");
    assert!(
        commands[0].get("tool").is_none(),
        "no tool of its own unless --plugin names it"
    );

    let (git, _) = mcp.tool(LIST_COMMANDS, json!({ "plugin": "example.git" }));
    assert_eq!(
        ids(&git["commands"]),
        ["example.git.status", "example.git.push"]
    );
    let (found, _) = mcp.tool(LIST_COMMANDS, json!({ "query": "REPOSITORY git" }));
    assert_eq!(ids(&found["commands"]), ["example.git.status"]);
    let (theirs, _) = mcp.tool(LIST_COMMANDS, json!({ "plugin": "desk" }));
    assert_eq!(ids(&theirs["commands"]), ["desk.theme.toggle"]);
}

#[test]
fn run_command_is_the_agents_call_and_waits_for_the_person() {
    let desk = Desk::start();
    let (mut mcp, _) = Mcp::initialized(desk.options(&[]), PROTOCOL_VERSIONS[0]);
    let open = json!({ "command": "example.notes.open", "args": { "path": "a.md" } });

    // Nobody holds perm:manage here, so the default prompter answers the prompt: no.
    let (refused, is_error) = mcp.tool(RUN_COMMAND, open.clone());
    assert!(is_error, "{refused}");
    assert_eq!(refused["error"]["code"], "permission_denied");
    assert_eq!(refused["error"]["permission"]["permission"], "cmd:invoke");
    assert!(refused["hint"].as_str().unwrap().contains("allowlist"));

    desk.allow(&["example.*", "desk.*"]);
    let (ran, is_error) = mcp.tool(RUN_COMMAND, open);
    assert!(!is_error, "{ran}");
    assert_eq!(ran["command"], "example.notes.open");
    assert_eq!(ran["result"]["args"], json!({ "path": "a.md" }));
    assert_eq!(ran["result"]["caller"], format!("agent:{AGENT}"));
    let (toggled, _) = mcp.tool(RUN_COMMAND, json!({ "command": "desk.theme.toggle" }));
    assert_eq!(toggled["result"]["ran"], "desk.theme.toggle");

    let (wrong, is_error) = mcp.tool(RUN_COMMAND, json!({ "command": "example.notes.open" }));
    assert!(is_error);
    assert_eq!(
        wrong["error"]["code"], "invalid_params",
        "the args miss path"
    );
    assert!(wrong["hint"].as_str().unwrap().contains("argsSchema"));

    // Irreversible: held for approval, which nobody can give here, so it is refused.
    let (held, is_error) = mcp.tool(RUN_COMMAND, json!({ "command": "example.git.push" }));
    assert!(is_error, "{held}");
    assert_eq!(held["error"]["code"], "permission_denied");
    assert!(
        held["error"]["message"]
            .as_str()
            .unwrap()
            .contains("did not approve")
    );
}

#[test]
fn call_bridge_calls_any_method_as_the_agent() {
    let desk = Desk::start();
    desk.allow(&["example.git.status"]);
    let (mut mcp, _) = Mcp::initialized(desk.options(&[]), PROTOCOL_VERSIONS[0]);
    let (own, is_error) = mcp.tool(CALL_BRIDGE, json!({ "method": "perm.query" }));
    assert!(!is_error, "{own}");
    let grants = own["result"]["grants"].as_array().unwrap();
    assert_eq!(grants.len(), 1, "the agent's own grant only: {own}");
    assert_eq!(
        grants[0]["permission"]["ids"],
        json!(["example.git.status"])
    );

    let invoke = json!({ "method": "cmd.invoke", "params": { "id": "example.git.status",
        "scope": { "permission": "cmd:invoke", "ids": ["example.git.status"] } } });
    let (ran, is_error) = mcp.tool(CALL_BRIDGE, invoke);
    assert!(!is_error, "{ran}");
    assert_eq!(
        ran["result"]["ran"], "example.git.status",
        "cmd.invoke waits for the answer"
    );

    let (unknown, is_error) = mcp.tool(CALL_BRIDGE, json!({ "method": "no.such" }));
    assert!(is_error);
    assert_eq!(unknown["error"]["code"], "invalid_params");
    let socket = json!({ "method": "socket.agent", "params": { "agent": "other" } });
    let (refused, is_error) = mcp.tool(CALL_BRIDGE, socket);
    assert!(
        is_error,
        "the socket's own request is not a bridge method: {refused}"
    );
}

#[test]
fn the_plugins_named_get_a_tool_per_command() {
    let desk = Desk::start();
    desk.allow(&["example.*"]);
    let (mut mcp, init) = Mcp::initialized(desk.options(&["example.git"]), PROTOCOL_VERSIONS[0]);
    assert_eq!(init["capabilities"]["tools"]["listChanged"], true);
    let listed = mcp.request("tools/list", json!({}));
    let tools = listed["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(
        names,
        [
            LIST_PLUGINS,
            LIST_COMMANDS,
            RUN_COMMAND,
            CALL_BRIDGE,
            "example_git_status",
            "example_git_push"
        ]
    );
    assert_eq!(tools[4]["title"], "example.git: status");
    assert_eq!(tools[4]["annotations"]["destructiveHint"], false);
    assert_eq!(tools[5]["annotations"]["destructiveHint"], true);
    assert!(
        tools[5]["description"]
            .as_str()
            .unwrap()
            .contains("irreversible")
    );

    let (ran, is_error) = mcp.tool("example_git_status", json!({}));
    assert!(!is_error, "{ran}");
    assert_eq!(ran["result"]["caller"], format!("agent:{AGENT}"));
    let not_named = mcp.request("tools/call", json!({ "name": "example_notes_open" }));
    assert_eq!(not_named["error"]["code"], -32602, "{not_named}");
    let (listed, _) = mcp.tool(LIST_COMMANDS, json!({ "plugin": "example.git" }));
    assert_eq!(listed["commands"][0]["tool"], "example_git_status");

    let (mut every, _) = Mcp::initialized(desk.options(&["*"]), PROTOCOL_VERSIONS[0]);
    let listed = every.request("tools/list", json!({}));
    let tools = listed["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 8, "the four and one per command");
    let open = tools
        .iter()
        .find(|t| t["name"] == "example_notes_open")
        .unwrap();
    assert_eq!(open["inputSchema"]["required"], json!(["path"]));
    let toggle = tools
        .iter()
        .find(|t| t["name"] == "desk_theme_toggle")
        .unwrap();
    assert_eq!(toggle["inputSchema"]["type"], "object");
}
