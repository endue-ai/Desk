//! examples/plugin-hello-connector on the connector host: its sample notes become note items, its
//! `status` checks the folder setting, and it answers `unsupported` to `query` and `act`. This is
//! the example's one command: `cargo test -p desk-plugin-host --test hello_connector`.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::{Desk, HELLO, Sent, guest_error, hello_connector, hello_connector_copy, ids};
use desk_bridge::{ConnectorState, ItemQuery};
use desk_plugin_host::{ErrorCode, Limits, rfc3339};
use serde_json::json;

/// examples/plugin-hello-connector/notes, as an absolute path without `..`.
fn sample_notes() -> PathBuf {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap();
    repo.join("examples")
        .join("plugin-hello-connector")
        .join("notes")
}

fn folder(path: &Path) -> serde_json::Value {
    json!({ "folder": path.to_str().unwrap() })
}

#[test]
fn hello_connector_turns_its_sample_notes_into_note_items() {
    let desk = Desk::new(Limits::default());
    let notes = sample_notes();
    desk.connectors.install(&hello_connector()).unwrap();
    let created = desk
        .connectors
        .create_instance(HELLO, "default", folder(&notes));
    assert_eq!(created.unwrap().state, ConnectorState::Connected);
    desk.connectors.tick();

    let sent = desk.sink.take();
    assert_eq!(
        ids(&sent),
        [("upsert", vec!["untitled.md".into(), "welcome.md".into()])]
    );
    let Sent::Upsert(items) = &sent[0] else {
        unreachable!()
    };
    let titles = [
        ("untitled.md", "untitled"),
        ("welcome.md", "Welcome to Desk"),
    ];
    for (item, (name, title)) in items.iter().zip(titles) {
        let path = notes.join(name);
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        assert_eq!(item["kind"], "note");
        assert_eq!(item["title"], title);
        assert_eq!(item["updatedAt"], rfc3339(modified));
        assert_eq!(item["body"], fs::read_to_string(&path).unwrap());
        assert_eq!(item["path"], format!("{}/{name}", notes.to_str().unwrap()));
        let link = item["deepLink"].as_str().unwrap();
        let tail = format!("/notes/{name}");
        assert!(
            link.starts_with("file://") && link.ends_with(&tail),
            "{link}"
        );
    }
}

#[test]
fn hello_connector_status_checks_its_folder_setting() {
    let desk = Desk::new(Limits::default());
    let optional = hello_connector_copy(|m| {
        m["connector"]["instanceSettings"]["folder"]["required"] = json!(false);
    });
    desk.connectors.install(&optional.path).unwrap();
    let gone = std::env::temp_dir().join(format!("desk-no-notes-{}", std::process::id()));

    let cases = [
        ("unset", json!({}), Some("invalid-params")),
        ("gone", folder(&gone), Some("not-found")),
        ("sample", folder(&sample_notes()), None),
    ];
    for (instance, settings, named) in cases {
        let status = desk
            .connectors
            .create_instance(HELLO, instance, settings)
            .unwrap();
        match named {
            Some(code) => {
                assert_eq!(status.state, ConnectorState::Error, "{instance}");
                let message = status.error.unwrap().message;
                assert!(message.contains(code), "{instance}: {message}");
            }
            None => assert_eq!(status.state, ConnectorState::Connected, "{status:?}"),
        }
    }
}

#[test]
fn hello_connector_answers_unsupported_to_query_and_act() {
    let desk = Desk::new(Limits::default());
    let open = "example.hello-connector.open";
    let declared = hello_connector_copy(|m| {
        m["connector"]["resources"][0]["actions"] = json!([open]);
        m["contributes"] = json!({ "commands": [{ "id": open, "title": "Open" }] });
    });
    desk.connectors.install(&declared.path).unwrap();
    desk.connectors
        .create_instance(HELLO, "default", folder(&sample_notes()))
        .unwrap();

    let query: ItemQuery = serde_json::from_value(json!({ "kinds": ["note"] })).unwrap();
    guest_error(
        desk.connectors.query(HELLO, "default", &query),
        ErrorCode::Unsupported,
    );
    let acted = desk.connectors.act(HELLO, "default", open, &json!({}));
    guest_error(acted, ErrorCode::Unsupported);
}
