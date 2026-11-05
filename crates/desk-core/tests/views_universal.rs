//! Universal views (ADR 0087) in the person's views folder beside item views (ADR 0102): view.save
//! checks one against `specs/view/v0/universal.schema.json` and writes `~/.desk/views/<id>.yaml`,
//! view.get answers it whole, view.list lists it with its type and no version, view.remove deletes
//! it. One without an id, or one the schema refuses, is refused; a valid file is not a problem.
//! (A value serde cannot read as either language never reaches the core: the bridge refuses it.)

mod layer;

use std::fs;
use std::path::PathBuf;

use desk_bridge::ErrorCode;
use layer::{Desk, view_manage};
use serde_json::{Value, json};

const ID: &str = "eris.issues-as-a-board";

fn board() -> Value {
    json!({
        "id": ID,
        "title": "Issues as a board",
        "type": "kanban",
        "types": ["kanban", "list", "timeline", "calendar"],
        "source": { "items": { "kinds": ["task"] } },
        "map": { "group": "status", "start": "due" },
        "options": { "groups": ["todo", "doing", "done"] },
        "provenance": {
            "author": "eris",
            "createdAt": "2026-10-30T09:00:00+09:00",
            "words": "show this repo's issues as a board",
        },
    })
}

fn folder(desk: &Desk) -> PathBuf {
    desk.home.join(".desk/views")
}

fn manager(tag: &str) -> Desk {
    let desk = Desk::new(tag, None);
    desk.grant("desk", view_manage());
    desk
}

fn save(desk: &Desk, view: Value) -> Result<Value, desk_bridge::BridgeError> {
    desk.call(
        "desk",
        "view.save",
        json!({ "view": view, "scope": view_manage() }),
    )
}

#[test]
fn a_universal_view_is_saved_read_listed_and_removed_like_an_item_view() {
    let desk = manager("universal-save");
    assert_eq!(save(&desk, board()).unwrap(), json!({}));
    let file = folder(&desk).join(format!("{ID}.yaml"));
    let parsed: Value = yaml_serde::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(parsed, board());

    let got = desk.ok(
        "desk",
        "view.get",
        json!({ "id": ID, "scope": view_manage() }),
    );
    assert_eq!(got, json!({ "view": board(), "source": "file" }));

    let listed = desk.ok("desk", "view.list", json!({ "scope": view_manage() }));
    let summary = json!({
        "id": ID, "title": "Issues as a board", "type": "kanban", "source": "file",
    });
    assert_eq!(listed, json!({ "views": [summary] }));
    assert!(desk.core.view_problems().is_empty(), "a universal file is a view");

    let removed = desk.call(
        "desk",
        "view.remove",
        json!({ "id": ID, "scope": view_manage() }),
    );
    assert_eq!(removed.unwrap(), json!({}));
    assert!(!file.exists());
}

#[test]
fn a_universal_view_without_a_title_is_listed_by_its_id() {
    let desk = manager("universal-untitled");
    let mut untitled = board();
    untitled.as_object_mut().unwrap().remove("title");
    save(&desk, untitled).unwrap();
    let listed = desk.ok("desk", "view.list", json!({ "scope": view_manage() }));
    assert_eq!(listed["views"][0]["title"], json!(ID));
}

#[test]
fn a_universal_view_without_an_id_or_that_the_schema_refuses_is_not_saved() {
    let desk = manager("universal-refused");
    let mut unnamed = board();
    unnamed.as_object_mut().unwrap().remove("id");
    let mut hasty = board();
    hasty["refresh"] = json!(2);
    let mut twice = board();
    twice["types"] = json!(["kanban", "kanban"]);
    let mut misnamed = board();
    misnamed["id"] = json!("Board");
    for (view, said) in [
        (unnamed, "needs its id"),
        (hasty, "/refresh"),
        (twice, "/types"),
        (misnamed, "/id"),
    ] {
        let error = save(&desk, view.clone()).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidParams, "{view}");
        assert!(error.message.contains(said), "{said}: {}", error.message);
    }
    let written = fs::read_dir(folder(&desk)).map(|d| d.count()).unwrap_or(0);
    assert_eq!(written, 0, "nothing is written");
}

#[test]
fn a_hand_written_universal_file_is_read_and_a_broken_one_named() {
    let desk = manager("universal-files");
    fs::create_dir_all(folder(&desk)).unwrap();
    let yaml = "id: my.notes-timeline\ntype: timeline\nsource:\n  file: ~/notes/log.yaml\nmap:\n  start: date\n";
    fs::write(folder(&desk).join("my.notes-timeline.yaml"), yaml).unwrap();
    fs::write(
        folder(&desk).join("my.broken.yaml"),
        "id: my.broken\ntype: timeline\n",
    )
    .unwrap();
    let got = desk.ok(
        "desk",
        "view.get",
        json!({ "id": "my.notes-timeline", "scope": view_manage() }),
    );
    assert_eq!(got["view"]["source"], json!({ "file": "~/notes/log.yaml" }));
    let problems = desk.core.view_problems();
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].starts_with("my.broken.yaml"), "{problems:?}");
}
