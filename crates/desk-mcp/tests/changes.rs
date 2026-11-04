//! Resources and changes: each plugin is a resource with its manifest, and the client hears that its
//! lists changed when a plugin registers a command, once it is initialized.
#![cfg(unix)]

mod support;

use std::time::{Duration, Instant};

use desk_mcp::PROTOCOL_VERSIONS;
use serde_json::{Value, json};
use support::{Desk, Mcp, call};

#[test]
fn every_plugin_is_a_resource_that_reads_as_its_manifest_and_commands() {
    let desk = Desk::start();
    let (mut mcp, _) = Mcp::initialized(desk.options(&[]), PROTOCOL_VERSIONS[0]);
    let listed = mcp.request("resources/list", json!({}));
    let resources = listed["result"]["resources"].as_array().unwrap();
    let uris: Vec<&str> = resources
        .iter()
        .map(|r| r["uri"].as_str().unwrap())
        .collect();
    assert_eq!(
        uris,
        [
            "desk://plugins",
            "desk://plugins/example.git",
            "desk://plugins/example.notes"
        ]
    );
    assert_eq!(resources[1]["mimeType"], "application/json");
    assert_eq!(resources[1]["description"], "The example.git example");

    let read = mcp.request(
        "resources/read",
        json!({ "uri": "desk://plugins/example.git" }),
    );
    let contents = &read["result"]["contents"][0];
    assert_eq!(contents["uri"], "desk://plugins/example.git");
    let plugin: Value = serde_json::from_str(contents["text"].as_str().unwrap()).unwrap();
    assert_eq!(plugin["manifest"]["version"], "0.1.0");
    assert_eq!(plugin["commands"][1]["id"], "example.git.push");

    let index = mcp.request("resources/read", json!({ "uri": "desk://plugins" }));
    let text = index["result"]["contents"][0]["text"].as_str().unwrap();
    let all: Value = serde_json::from_str(text).unwrap();
    assert_eq!(all["plugins"].as_array().unwrap().len(), 2);

    for uri in [
        "desk://plugins/example.none",
        "desk://plugins/",
        "file:///etc/passwd",
    ] {
        let missing = mcp.request("resources/read", json!({ "uri": uri }));
        assert_eq!(missing["error"]["code"], -32002, "{uri}: {missing}");
    }
    let templates = mcp.request("resources/templates/list", json!({}));
    assert_eq!(templates["result"]["resourceTemplates"], json!([]));
}

#[test]
fn the_client_hears_that_its_lists_changed_when_a_command_is_registered() {
    let desk = Desk::start();
    let (mut mcp, _) = Mcp::initialized(desk.options(&["*"]), PROTOCOL_VERSIONS[0]);
    // The watch connects on a thread of its own: register until it has heard one.
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut n = 0;
    let heard = loop {
        assert!(Instant::now() < deadline, "no tools/list_changed arrived");
        n += 1;
        let params = json!({ "id": format!("example.git.extra{n}"), "title": "Extra" });
        call(&desk.core, "example.git", "cmd.register", params);
        if let Some(note) = mcp.receive(Duration::from_millis(500)) {
            break note;
        }
    };
    assert_eq!(
        heard["method"], "notifications/tools/list_changed",
        "{heard}"
    );
    assert!(heard.get("id").is_none());
    let listed = mcp.request("tools/list", json!({}));
    let names: Vec<&str> = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"example_git_extra1"), "{names:?}");
}

#[test]
fn nothing_is_sent_before_the_client_is_initialized() {
    let desk = Desk::start();
    let mut mcp = Mcp::start(desk.options(&["*"]));
    let params = json!({ "id": "example.git.early", "title": "Early" });
    std::thread::sleep(Duration::from_millis(300));
    call(&desk.core, "example.git", "cmd.register", params);
    assert!(
        mcp.receive(Duration::from_millis(600)).is_none(),
        "a notification before initialize"
    );
}
