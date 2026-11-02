//! The harness `desk plugin test` runs Wasm plugins on: a case is steps, scripted bridge answers and
//! the calls (or, for a connector, the items) that must come of them. These run the examples'
//! committed components.

mod common;

use std::fs;

use common::{PluginDir, hello_connector, hello_wasm};
use desk_plugin_host::harness::{self, Case};
use serde_json::{Value, json};

fn case(value: Value) -> Case {
    serde_json::from_value(value).unwrap()
}

/// hello-wasm started and asked to greet Ada, with its hello.txt answered by the script.
fn greet() -> Value {
    json!({
        "steps": [
            "start",
            { "command": { "id": "example.hello-wasm.greet", "args": { "name": "Ada" } } }
        ],
        "answers": [
            { "method": "fs.read", "params": { "path": "${plugin}/hello.txt" }, "result": "Hi" }
        ],
        "expect": {
            "calls": [
                { "method": "cmd.register", "params": { "id": "example.hello-wasm.greet" } },
                { "method": "ui.notify", "params": { "title": "Hello from Wasm", "body": "Hi (run 1)" } },
                { "method": "cmd.answer", "params": { "result": "Hello, Ada!" } }
            ]
        }
    })
}

#[test]
fn a_logic_case_passes_when_its_calls_were_made_in_order() {
    assert_eq!(harness::run(&hello_wasm(), &case(greet())), Ok(()));
}

#[test]
fn a_logic_case_fails_naming_the_missing_call() {
    let mut wrong = greet();
    wrong["expect"]["calls"][2]["params"]["result"] = json!("Hello, Bob!");
    let why = harness::run(&hello_wasm(), &case(wrong)).unwrap_err();
    // The call it waited for, and the calls the plugin made instead.
    assert!(
        why.contains("cmd.answer") && why.contains("Hello, Bob!"),
        "{why}"
    );
    assert!(why.contains("Hello, Ada!"), "{why}");
}

#[test]
fn expected_calls_must_come_in_their_order() {
    let mut swapped = greet();
    let calls = swapped["expect"]["calls"].as_array_mut().unwrap();
    calls.swap(0, 2);
    let why = harness::run(&hello_wasm(), &case(swapped)).unwrap_err();
    assert!(why.contains("cmd.register"), "{why}");
}

#[test]
fn a_scripted_error_reaches_the_guest_and_fails_the_step() {
    let mut refused = greet();
    refused["answers"] = json!([
        { "method": "fs.read", "error": { "code": "not_found", "message": "hello.txt is gone" } }
    ]);
    let why = harness::run(&hello_wasm(), &case(refused)).unwrap_err();
    assert!(why.contains("start"), "{why}");
    assert!(
        why.contains("not-found") && why.contains("hello.txt is gone"),
        "{why}"
    );
}

#[test]
fn the_store_keeps_what_the_plugin_set_within_a_case() {
    let twice = json!({
        "steps": ["start", "start"],
        "answers": [{ "method": "fs.read", "result": "Hi" }],
        "expect": {
            "calls": [
                { "method": "store.set", "params": { "key": "runs", "value": 1 } },
                { "method": "ui.notify", "params": { "body": "Hi (run 1)" } },
                { "method": "ui.notify", "params": { "body": "Hi (run 2)" } }
            ]
        }
    });
    assert_eq!(harness::run(&hello_wasm(), &case(twice)), Ok(()));
}

/// hello-connector connected to /notes and synced, with the folder answered by the script.
fn notes() -> Value {
    json!({
        "steps": [
            { "connect": { "instance": "default", "settings": { "folder": "/notes" } } },
            { "sync": { "instance": "default" } }
        ],
        "answers": [
            { "method": "fs.list", "params": { "path": "/notes" }, "result": [
                { "name": "welcome.md", "kind": "file", "size": 25, "modifiedAt": "2026-01-01T09:00:00Z" },
                { "name": "todo.txt", "kind": "file", "size": 4, "modifiedAt": "2026-01-01T09:00:00Z" }
            ] },
            { "method": "fs.read", "params": { "path": "/notes/welcome.md" },
              "result": "# Welcome to Desk\n\nHello." }
        ],
        "expect": {
            "calls": [{ "method": "fs.read", "params": { "path": "/notes/welcome.md" } }],
            "items": [{
                "id": "welcome.md",
                "kind": "note",
                "title": "Welcome to Desk",
                "updatedAt": "2026-01-01T09:00:00Z",
                "source": { "connector": "example.hello-connector", "instance": "default" }
            }]
        }
    })
}

#[test]
fn a_connector_case_syncs_and_checks_its_items() {
    assert_eq!(harness::run(&hello_connector(), &case(notes())), Ok(()));
}

#[test]
fn a_connector_case_fails_naming_the_missing_item() {
    let mut missing = notes();
    missing["expect"]["items"][0]["id"] = json!("missing.md");
    let why = harness::run(&hello_connector(), &case(missing)).unwrap_err();
    assert!(
        why.contains("missing.md") && why.contains("welcome.md"),
        "{why}"
    );
}

#[test]
fn a_step_for_another_kind_fails_the_case() {
    let sync = json!({ "steps": [{ "sync": { "instance": "default" } }] });
    let why = harness::run(&hello_wasm(), &case(sync)).unwrap_err();
    assert!(why.contains("sync") && why.contains("connector"), "{why}");
}

/// examples/plugin-hello-wasm's manifest and component in a temporary folder, without tests.
fn hello_wasm_copy() -> PluginDir {
    let permissions = json!([
        { "permission": "fs:read", "paths": ["${plugin}/hello.txt"] },
        { "permission": "ui:notify" }
    ]);
    let component = hello_wasm().join("build/wasm32-wasip2/release/hello.wasm");
    PluginDir::logic(
        "example.hello-wasm",
        permissions,
        &fs::read(component).unwrap(),
    )
}

#[test]
fn run_folder_runs_every_test_file() {
    let dir = hello_wasm_copy();
    let tests = dir.path.join("tests");
    fs::create_dir_all(&tests).unwrap();
    let mut wrong = greet();
    wrong["expect"]["calls"][2]["params"]["result"] = json!("Hello, Bob!");
    fs::write(tests.join("greet.test.json"), greet().to_string()).unwrap();
    fs::write(tests.join("wrong.test.json"), wrong.to_string()).unwrap();
    fs::write(tests.join("broken.test.json"), "{ not json").unwrap();
    fs::write(tests.join("notes.md"), "not a test").unwrap();

    let ran = harness::run_folder(&dir.path).unwrap();
    let names: Vec<&str> = ran.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["broken", "greet", "wrong"]);
    assert!(ran[0].1.is_err(), "{:?}", ran[0].1);
    assert_eq!(ran[1].1, Ok(()));
    assert!(ran[2].1.as_ref().unwrap_err().contains("Hello, Bob!"));
}

#[test]
fn run_folder_finds_no_tests_in_a_folder_without_them() {
    assert_eq!(harness::run_folder(&hello_wasm_copy().path).unwrap(), []);
}
