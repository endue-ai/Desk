//! The MCP handshake and JSON-RPC rules, with no desk running: the client's version when the server
//! speaks it, the four tools, `ping`, errors for unknown methods, tools and lines, and tool calls
//! that say there is no desk.
#![cfg(unix)]

mod support;

use std::time::Duration;

use desk_mcp::{
    CALL_BRIDGE, LIST_COMMANDS, LIST_PLUGINS, Options, PROTOCOL_VERSIONS, RUN_COMMAND, SERVER_NAME,
};
use serde_json::{Value, json};
use support::{AGENT, Mcp, nowhere};

fn options() -> Options {
    Options {
        agent: AGENT.to_owned(),
        plugins: Vec::new(),
        socket: Some(nowhere()),
    }
}

#[test]
fn initialize_answers_in_the_clients_version_with_what_the_server_serves() {
    let (_mcp, result) = Mcp::initialized(options(), "2025-06-18");
    assert_eq!(result["protocolVersion"], "2025-06-18");
    assert_eq!(result["serverInfo"]["name"], SERVER_NAME);
    assert_eq!(result["capabilities"]["tools"]["listChanged"], false);
    assert_eq!(result["capabilities"]["resources"]["listChanged"], true);
    assert!(
        result["instructions"]
            .as_str()
            .unwrap()
            .contains("list-plugins")
    );

    let (_mcp, newer) = Mcp::initialized(options(), "2999-01-01");
    assert_eq!(newer["protocolVersion"], PROTOCOL_VERSIONS[0]);
}

#[test]
fn the_four_tools_work_with_every_plugin_and_need_no_desk_to_be_listed() {
    let (mut mcp, _) = Mcp::initialized(options(), PROTOCOL_VERSIONS[0]);
    let listed = mcp.request("tools/list", json!({}));
    let tools = listed["result"]["tools"].as_array().unwrap();
    let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
    assert_eq!(
        names,
        [LIST_PLUGINS, LIST_COMMANDS, RUN_COMMAND, CALL_BRIDGE]
    );
    for tool in tools {
        assert_eq!(tool["inputSchema"]["type"], "object", "{tool}");
        assert!(tool["description"].as_str().unwrap().len() > 40);
    }
    assert_eq!(tools[0]["annotations"]["readOnlyHint"], true);
    assert_eq!(tools[2]["inputSchema"]["required"], json!(["command"]));
}

#[test]
fn without_a_desk_a_tool_call_says_so_and_how_to_fix_it() {
    let (mut mcp, _) = Mcp::initialized(options(), PROTOCOL_VERSIONS[0]);
    for (tool, arguments) in [
        (LIST_PLUGINS, json!({})),
        (RUN_COMMAND, json!({ "command": "example.git.status" })),
    ] {
        let (output, is_error) = mcp.tool(tool, arguments);
        assert!(is_error, "{output}");
        assert_eq!(output["error"]["code"], "no_desk");
        assert!(
            output["error"]["message"]
                .as_str()
                .unwrap()
                .contains("no desk at")
        );
        assert!(
            output["hint"]
                .as_str()
                .unwrap()
                .contains("Start endue Desk")
        );
        assert_eq!(output["caller"], format!("agent:{AGENT}"));
    }
    let resources = mcp.request("resources/list", json!({}));
    let uris: Vec<&Value> = resources["result"]["resources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| &r["uri"])
        .collect();
    assert_eq!(uris, [&json!("desk://plugins")]);
}

#[test]
fn ping_unknown_methods_and_bad_lines_are_answered_by_json_rpcs_rules() {
    let (mut mcp, _) = Mcp::initialized(options(), PROTOCOL_VERSIONS[0]);
    assert_eq!(mcp.request("ping", json!({}))["result"], json!({}));

    let unknown = mcp.request("prompts/list", json!({}));
    assert_eq!(unknown["error"]["code"], -32601, "{unknown}");

    let no_tool = mcp.request(
        "tools/call",
        json!({ "name": "no_such_tool", "arguments": {} }),
    );
    assert_eq!(no_tool["error"]["code"], -32602, "{no_tool}");
    let no_name = mcp.request("tools/call", json!({ "arguments": {} }));
    assert_eq!(no_name["error"]["code"], -32602);
    let bad_args = mcp.request(
        "tools/call",
        json!({ "name": RUN_COMMAND, "arguments": { "command": 7 } }),
    );
    assert_eq!(bad_args["error"]["code"], -32602, "{bad_args}");
    let no_uri = mcp.request("resources/read", json!({}));
    assert_eq!(no_uri["error"]["code"], -32602);

    mcp.send_line("not json");
    let parse = mcp.receive(Duration::from_secs(5)).unwrap();
    assert_eq!(parse["error"]["code"], -32700);
    assert_eq!(parse["id"], Value::Null);
    mcp.send_line(r#"[{"jsonrpc":"2.0","id":9,"method":"ping"}]"#);
    let batch = mcp.receive(Duration::from_secs(5)).unwrap();
    assert_eq!(batch["error"]["code"], -32600);

    // A notification, and an answer to nothing, get no answer; the session carries on.
    mcp.send(&json!({ "jsonrpc": "2.0", "method": "notifications/roots/list_changed" }));
    mcp.send(&json!({ "jsonrpc": "2.0", "id": "x", "result": {} }));
    mcp.send_line("");
    assert_eq!(mcp.request("ping", json!({}))["result"], json!({}));
    assert!(
        mcp.notes.is_empty(),
        "nothing else arrived: {:?}",
        mcp.notes
    );
}

#[test]
fn string_ids_come_back_as_they_were_sent() {
    let mut mcp = Mcp::start(options());
    mcp.send(&json!({ "jsonrpc": "2.0", "id": "a-1", "method": "ping" }));
    let answer = mcp.receive(Duration::from_secs(5)).unwrap();
    assert_eq!(answer["id"], "a-1");
    assert_eq!(answer["result"], json!({}));
    mcp.close();
    assert!(
        mcp.receive(Duration::from_secs(5)).is_none(),
        "the session ends with stdin"
    );
}
