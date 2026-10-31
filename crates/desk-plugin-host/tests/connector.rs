//! The connector host runs Wasm connectors: what it installs, instances with their settings in the
//! plugin's store, syncs in rounds with every change handed to an `IndexSink`, query and act, and a
//! trap or a limit that stops one connector only. When it syncs is `connector_schedule.rs`.

mod common;

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use common::{Desk, Folder, HELLO, PluginDir, Sent, at, connector, connector_dir, fine, ran};
use common::{guest_error, hello_connector, hello_connector_copy, host_error, ids, source, state};
use desk_bridge::{ConnectorState, ItemQuery, PluginManifest};
use desk_plugin_host::{ErrorCode, Imports, Limits, LogicHost, PluginError};
use serde_json::json;

const CURSOR: &str = "desk.connector/cursor/notes";

#[test]
fn install_takes_wasm_connectors_and_refuses_other_kinds_bindings_and_worlds() {
    let desk = Desk::new(Limits::default());
    assert_eq!(desk.connectors.install(&hello_connector()).unwrap(), HELLO);
    assert_eq!(desk.connectors.installed(), [HELLO]);

    let logic = PluginDir::logic("test.logic", json!([]), &fine());
    let mcp = hello_connector_copy(|m| m["connector"]["binding"] = json!("mcp"));
    let bare = hello_connector_copy(|m| drop(m.as_object_mut().unwrap().remove("connector")));
    for dir in [&logic, &mcp, &bare] {
        let result = desk.connectors.install(&dir.path);
        assert!(
            matches!(result, Err(PluginError::Manifest(_))),
            "{result:?}"
        );
    }
    let plugin_world = connector_dir("test.plugin-world", &fine());
    let result = desk.connectors.install(&plugin_world.path);
    assert!(matches!(result, Err(PluginError::Link(_))), "{result:?}");

    let mut logic = LogicHost::new(desk.host.clone(), Limits::default()).unwrap();
    let result = logic.install(&hello_connector());
    assert!(
        matches!(result, Err(PluginError::Manifest(_))),
        "{result:?}"
    );
}

#[test]
fn an_instance_keeps_its_settings_in_the_plugin_store_and_comes_back_on_a_new_host() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.write("a.md", "# Alpha\n", -60);
    assert_eq!(desk.hello("notes", &notes).state, ConnectorState::Connected);
    let record = json!({ "id": "notes", "settings": notes.settings(), "paused": false,
        "lastSyncAt": null });
    let stored = desk.host.stored(HELLO, "desk.connector/instances");
    assert_eq!(stored, Some(json!([record])));

    let mut wrong = notes.settings();
    wrong["colour"] = json!("red");
    for settings in [json!({}), json!({ "folder": 7 }), wrong] {
        host_error(
            desk.connectors.create_instance(HELLO, "bad", settings),
            ErrorCode::InvalidParams,
        );
    }
    let named = desk
        .connectors
        .create_instance(HELLO, "Not ok", notes.settings());
    host_error(named, ErrorCode::InvalidParams);
    let again = desk
        .connectors
        .create_instance(HELLO, "notes", notes.settings());
    host_error(again, ErrorCode::AlreadyExists);

    let fresh = desk.again();
    fresh.install(&hello_connector()).unwrap();
    let listed = fresh.instances(HELLO).unwrap();
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(
        (listed[0].instance.as_str(), listed[0].connector.as_str()),
        ("notes", HELLO)
    );
    assert_eq!(listed[0].settings, notes.settings().as_object().cloned());

    let text = std::fs::read_to_string(hello_connector().join("plugin.json")).unwrap();
    let manifest: PluginManifest = serde_json::from_str(&text).unwrap();
    let imports = Imports::new(&manifest, desk.host.clone());
    let denied = [
        imports
            .store_get("desk.connector/instances")
            .map(drop)
            .unwrap_err(),
        imports.store_set(CURSOR, "null").unwrap_err(),
    ];
    for error in denied {
        assert_eq!(error.code, ErrorCode::PermissionDenied, "{error:?}");
    }
    imports.store_set("mine", "1").unwrap();

    desk.connectors.tick();
    assert!(
        desk.host
            .stored(HELLO, CURSOR)
            .is_some_and(|c| !c.is_null())
    );
    desk.sink.take();
    desk.connectors.remove_instance(HELLO, "notes").unwrap();
    assert_eq!(desk.sink.take(), [Sent::Clear(source("notes"))]);
    assert_eq!(
        desk.host.stored(HELLO, "desk.connector/instances"),
        Some(json!([]))
    );
    assert!(desk.host.stored(HELLO, CURSOR).is_none_or(|c| c.is_null()));
    assert!(desk.connectors.instances(HELLO).unwrap().is_empty());

    let secret = Desk::new(Limits::default());
    let token = json!({ "kind": "string", "title": "Token", "secret": true });
    let copy = hello_connector_copy(|m| m["connector"]["instanceSettings"]["token"] = token);
    secret.connectors.install(&copy.path).unwrap();
    let mut settings = notes.settings();
    settings["token"] = json!("s3cret");
    secret
        .connectors
        .create_instance(HELLO, "notes", settings)
        .unwrap();
    let stored = secret
        .host
        .stored(HELLO, "desk.connector/instances")
        .unwrap();
    assert_eq!(stored[0]["settings"], notes.settings());
    assert!(!stored.to_string().contains("s3cret"), "{stored}");
}

#[test]
fn a_sync_turns_a_folder_of_markdown_into_note_items() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.write("a.md", "# Alpha\n\nThe first note.\n", -3600);
    notes.write("b.md", "No heading here.\n", -1800);
    notes.write("c.txt", "# Not a note\n", -60);
    desk.hello("notes", &notes);

    assert_eq!(desk.connectors.tick(), ran(&[(HELLO, "notes")]));
    let sent = desk.sink.take();
    let [Sent::Upsert(items)] = sent.as_slice() else {
        panic!("expected one upsert, got {sent:?}");
    };
    assert_eq!(ids(&sent), [("upsert", vec!["a.md".into(), "b.md".into()])]);
    for (item, title, secs, name) in [
        (&items[0], "Alpha", -3600, "a.md"),
        (&items[1], "b", -1800, "b.md"),
    ] {
        assert_eq!(item["kind"], "note");
        assert_eq!(
            item["source"],
            json!({ "connector": HELLO, "instance": "notes" })
        );
        assert_eq!(item["title"], title);
        assert_eq!(item["updatedAt"], at(secs));
        let link = item["deepLink"].as_str().unwrap();
        assert!(
            link.starts_with("file://") && link.ends_with(&format!("/{name}")),
            "{link}"
        );
    }
    let status = desk.connectors.status(HELLO, "notes").unwrap();
    assert_eq!(status.state, ConnectorState::Connected);
    assert_eq!(status.last_sync_at, Some(at(0)));
}

#[test]
fn a_changed_file_is_synced_again_on_the_next_tick() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.write("a.md", "# Alpha\n", -3600);
    notes.write("b.md", "# Beta\n", -3600);
    notes.write("c.md", "# Gamma\n", -3600);
    desk.hello("notes", &notes);
    desk.connectors.tick();
    desk.sink.take();

    notes.write("a.md", "# Alpha 2\n", -3540);
    notes.remove("b.md");
    notes.write("d.md", "# Delta\n", 0);
    assert_eq!(desk.tick_at(300), ran(&[(HELLO, "notes")]));
    let sent = desk.sink.take();
    let changed = [
        ("upsert", vec!["a.md".to_owned(), "d.md".to_owned()]),
        ("remove", vec!["b.md".to_owned()]),
    ];
    assert_eq!(ids(&sent), changed);
    let Sent::Upsert(items) = &sent[0] else {
        unreachable!()
    };
    assert_eq!(items[0]["title"], "Alpha 2");
    assert_eq!(sent[1], Sent::Remove(source("notes"), vec!["b.md".into()]));

    assert_eq!(desk.tick_at(600), ran(&[(HELLO, "notes")]));
    assert_eq!(desk.sink.take(), []);
}

#[test]
fn a_folder_larger_than_one_round_syncs_in_rounds_within_one_tick() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    for n in 0..120 {
        notes.write(&format!("n{n:03}.md"), &format!("# Note {n}\n"), -60);
    }
    desk.hello("notes", &notes);
    let host = desk.host.clone();
    desk.sink.probe(move || host.stored(HELLO, CURSOR));

    assert_eq!(desk.connectors.tick(), ran(&[(HELLO, "notes")]));
    let sizes: Vec<usize> = ids(&desk.sink.take())
        .iter()
        .map(|(_, ids)| ids.len())
        .collect();
    assert_eq!(sizes, [50, 50, 20]);
    let mut cursors = desk.sink.probed();
    cursors.push(desk.host.stored(HELLO, CURSOR));
    let distinct: BTreeSet<String> = cursors.iter().map(|c| format!("{c:?}")).collect();
    assert_eq!(
        distinct.len(),
        4,
        "the cursor is saved after each round: {cursors:?}"
    );
    assert_eq!(state(&desk, HELLO, "notes").0, ConnectorState::Connected);
}

#[test]
fn a_trapping_connector_is_error_and_the_desk_keeps_running() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    notes.write("a.md", "# A\n", -60);
    desk.hello("notes", &notes);
    let trap = connector_dir("test.trap", &connector("(unreachable)"));
    desk.connectors.install(&trap.path).unwrap();
    let created = desk
        .connectors
        .create_instance("test.trap", "default", json!({}));
    assert_eq!(created.unwrap().state, ConnectorState::Connected);

    let both = ran(&[(HELLO, "notes"), ("test.trap", "default")]);
    assert_eq!(desk.tick_at(0), both);
    let (now, message) = state(&desk, "test.trap", "default");
    assert_eq!(now, ConnectorState::Error);
    assert!(message.contains("trap"), "{message}");
    assert_eq!(state(&desk, HELLO, "notes").0, ConnectorState::Connected);
    assert_eq!(
        ids(&desk.sink.take()),
        [("upsert", vec!["a.md".to_owned()])]
    );

    assert_eq!(desk.tick_at(300), ran(&[(HELLO, "notes")]));
    assert_eq!(desk.tick_at(100_000), ran(&[(HELLO, "notes")]));
    assert_eq!(
        state(&desk, "test.trap", "default"),
        (ConnectorState::Error, message)
    );

    trap.write("plugin.wasm", &connector(""));
    desk.connectors.reload("test.trap").unwrap();
    assert_eq!(desk.connectors.tick(), ran(&[("test.trap", "default")]));
    assert_eq!(
        state(&desk, "test.trap", "default").0,
        ConnectorState::Connected
    );
}

#[test]
fn a_connector_runs_under_the_same_limits_as_a_logic_plugin() {
    let time = Limits {
        time: Duration::from_millis(200),
        ..Limits::default()
    };
    let memory = Limits {
        memory_bytes: 16 << 20,
        ..Limits::default()
    };
    let spin = "(loop $forever (br $forever))";
    let hog = "(drop (memory.grow (i32.const 1000)))";
    for (limits, body, named) in [(time, spin, "time limit"), (memory, hog, "memory")] {
        let (desk, notes) = (Desk::new(limits), Folder::new());
        notes.write("a.md", "# A\n", -60);
        desk.hello("notes", &notes);
        let dir = connector_dir("test.limit", &connector(body));
        desk.connectors.install(&dir.path).unwrap();
        desk.connectors
            .create_instance("test.limit", "default", json!({}))
            .unwrap();

        let started = Instant::now();
        assert_eq!(desk.tick_at(0).len(), 2);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        let (now, message) = state(&desk, "test.limit", "default");
        assert_eq!(now, ConnectorState::Error);
        assert!(message.contains(named), "{named}: {message}");

        notes.write("b.md", "# B\n", 0);
        assert_eq!(desk.tick_at(300), ran(&[(HELLO, "notes")]));
        let synced = ids(&desk.sink.take());
        assert_eq!(
            synced,
            [
                ("upsert", vec!["a.md".into()]),
                ("upsert", vec!["b.md".into()])
            ]
        );
    }
}

#[test]
fn query_and_act_reach_the_guest_only_for_what_the_manifest_declares() {
    let (desk, notes) = (Desk::new(Limits::default()), Folder::new());
    desk.hello("notes", &notes);
    let query: ItemQuery = serde_json::from_value(json!({ "text": "alpha", "limit": 10 })).unwrap();
    guest_error(
        desk.connectors.query(HELLO, "notes", &query),
        ErrorCode::Unsupported,
    );
    let open = "example.hello-connector.open";
    host_error(
        desk.connectors.act(HELLO, "notes", open, &json!({})),
        ErrorCode::NotFound,
    );

    let declared = hello_connector_copy(|m| {
        m["connector"]["resources"][0]["actions"] = json!([open]);
        m["contributes"] = json!({ "commands": [{ "id": open, "title": "Open" }] });
    });
    desk.connectors.install(&declared.path).unwrap();
    guest_error(
        desk.connectors.act(HELLO, "notes", open, &json!({})),
        ErrorCode::Unsupported,
    );
}
