//! Only a logged user choice can transfer file access to an opener or drop target.

mod common;
mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::Receiver;

use common::Echo;
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

const PATH: &str = "~/Documents/hello.md";
const ERIS: &str = "agent:eris";
const EXPLORER: &str = "endue.explorer";

fn file_read(path: &str) -> Value {
    json!({ "permission": "fs:read", "paths": [path] })
}

fn opened(core: &Core, events: &Receiver<Delivery>) -> Value {
    let invoked = wait_for(events, "cmd.invoked");
    call(
        core,
        "desk",
        "cmd.answer",
        json!({ "invocationId": invoked.data()["invocationId"], "result": {} }),
    )
    .unwrap();
    invoked.data()["fileOpenGranted"].clone()
}

fn turn(core: &Core, events: &Receiver<Delivery>, speaker: &str, arguments: Value) -> Value {
    let text = format!("tool desk.files.open as eris: {arguments}");
    call(
        core,
        speaker,
        "brain.say",
        json!({ "text": text, "scope": { "permission": "brain:converse" } }),
    )
    .unwrap();
    opened(core, events)
}

#[test]
fn eris_passes_the_file_only_in_a_persons_turn_and_under_her_own_read_grant() {
    let echo = Echo::start();
    let root = home("file-choice-turn");
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let core = Arc::new(
        Core::new(roots(&root))
            .with_prompter(NeverAsk)
            .with_brain(brain, BrainOptions::default()),
    );
    core.route_tools();
    for caller in ["desk", "fixture.background"] {
        grant(&core, caller, json!({ "permission": "brain:converse" }));
    }
    let scope = json!({ "permission": "cmd:invoke", "ids": ["desk.files.open"] });
    grant(&core, ERIS, scope.clone());
    call(
        &core,
        "desk",
        "cmd.register",
        json!({ "id": "desk.files.open", "title": "Open a file" }),
    )
    .unwrap();
    let events = core.events().subscribe_addressed();

    assert_eq!(
        turn(&core, &events, "desk", json!({ "path": PATH })),
        Value::Null
    );
    grant(&core, ERIS, file_read(PATH));
    assert_eq!(turn(&core, &events, "desk", json!({ "path": PATH })), true);
    assert_eq!(
        turn(
            &core,
            &events,
            "desk",
            json!({ "path": PATH, "plugin": "fixture.reader" })
        ),
        Value::Null
    );
    assert_eq!(
        turn(
            &core,
            &events,
            "fixture.background",
            json!({ "path": PATH })
        ),
        Value::Null
    );

    call(
        &core,
        ERIS,
        "cmd.invoke",
        json!({ "id": "desk.files.open", "args": { "path": PATH }, "scope": scope }),
    )
    .unwrap();
    assert_eq!(opened(&core, &events), Value::Null);
}

fn install(core: &Core, root: &Path, id: &str, built_in: bool) {
    let plugin = root.join(id);
    fs::create_dir_all(&plugin).unwrap();
    fs::write(plugin.join("index.html"), "<p>Window</p>").unwrap();
    fs::write(plugin.join("plugin.json"), json!({
        "id": id, "version": "0.0.1", "kind": "ui", "entry": "index.html",
        "permissions": [{ "permission": "fs:read", "paths": ["/**"] }, { "permission": "fs:write", "paths": ["/**"] }],
    }).to_string()).unwrap();
    assert!(core.install_plugin(&plugin, built_in).enabled);
}

#[test]
fn a_drop_grants_only_the_validated_source_and_destination() {
    let root = home("chosen-drop");
    let core = Core::new(roots(&root));
    install(&core, &root, EXPLORER, true);
    let source = "fixture.source";
    grant(&core, source, file_read(PATH));
    let write = |path: &str| {
        call(
            &core,
            EXPLORER,
            "fs.write",
            json!({ "path": path, "content": "copied", "scope": { "permission": "fs:write", "paths": [path] } }),
        )
    };
    let read = |path: &str| {
        call(
            &core,
            EXPLORER,
            "fs.read",
            json!({ "path": path, "scope": file_read(path) }),
        )
    };
    core.grant_file_drop(
        Some(source),
        EXPLORER,
        [PATH, "~/Calendar/today.ics", "~/Documents/*.md"],
        Some("~/Calendar"),
    );
    assert_eq!(read(PATH).unwrap()["content"], "# Hello");
    assert!(read("~/Calendar/today.ics").is_err());
    assert!(write("~/Calendar/copy.md").is_err());
    grant(&core, EXPLORER, file_read("~/Calendar/**"));
    core.grant_file_drop(Some(source), EXPLORER, [PATH], Some("~/Calendar"));
    write("~/Calendar/copy.md").unwrap();
    assert!(write(PATH).is_err());

    let viewer = "fixture.viewer";
    install(&core, &root, viewer, false);
    core.grant_file_drop(None, viewer, ["~/Calendar/today.ics"], Some("~/Calendar"));
    assert_eq!(query(&core, viewer).len(), 1);
    assert_eq!(
        query(&core, viewer)[0]["permission"],
        file_read("~/Calendar/today.ics")
    );
}
