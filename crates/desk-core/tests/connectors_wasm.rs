//! connector.* over the connector host: Wasm connectors (a copy of examples/plugin-hello-connector)
//! feeding the index through the core's `desk:host`, settings checked, secrets kept out of
//! everything listed and removed on disconnect, instances paused with their plugin, and connections
//! across a restart. Syncs run on an explicit tick and a fake clock.

mod layer;

use std::sync::Arc;

use desk_bridge::ErrorCode;
use desk_sys::calendar::{Authorization, CalendarSource};
use layer::event_observation::collect_disconnect;
use layer::fixtures::{hello, mac, mac_desk, notes, state, write_at};
use layer::{DAY, Desk, HELLO, NOW, connector_manage, source, time};
use serde_json::{Value, json};

#[test]
fn connect_checks_the_connector_the_instance_and_its_settings() {
    let (desk, _calendar) = mac_desk("connector-checks", mac());
    let code = |params: Value| desk.connect(params).unwrap_err().code;
    assert_eq!(
        code(json!({ "connector": "example.nothing" })),
        ErrorCode::NotFound
    );
    let work = json!({ "connector": "desk.calendar", "instance": "work" });
    assert_eq!(code(work), ErrorCode::InvalidParams);
    desk.connect(json!({ "connector": "desk.calendar" }))
        .unwrap();
    assert_eq!(
        code(json!({ "connector": "desk.calendar" })),
        ErrorCode::AlreadyExists
    );

    hello(&desk, true, |_| {});
    let with =
        |settings: Value| json!({ "connector": HELLO, "instance": "notes", "settings": settings });
    assert_eq!(
        code(with(json!({ "folder": "~/Notes", "colour": "red" }))),
        ErrorCode::InvalidParams
    );
    assert_eq!(code(with(json!({ "folder": 3 }))), ErrorCode::InvalidParams);
    assert_eq!(code(with(json!({}))), ErrorCode::InvalidParams);
    assert!(desk.instances(HELLO).is_empty());
}

#[test]
fn a_wasm_connector_feeds_the_index_through_the_host() {
    let desk = Desk::new("connector-wasm", None);
    write_at(
        &desk.home.join("Notes/alpha.md"),
        "# Alpha\n\nThe first.",
        NOW - DAY,
    );
    write_at(
        &desk.home.join("Notes/beta.md"),
        "No heading here.",
        NOW - 2 * DAY,
    );
    hello(&desk, false, |_| {});
    notes(&desk, "early").unwrap();
    let early = desk.instances(HELLO);
    assert_eq!(
        state(&early[0]),
        "error",
        "its status export met permission-denied: {early:?}"
    );

    let grant = json!({ "permission": "fs:read", "paths": ["~/Notes/**"] });
    desk.grant(HELLO, grant);
    assert_eq!(
        notes(&desk, "notes").unwrap(),
        json!({ "instance": "notes" })
    );
    desk.tick();
    let items = desk.items(json!({ "kinds": ["note"], "sources": [format!("{HELLO}/notes")] }));
    let mut found: Vec<(String, String, String)> = items
        .iter()
        .map(|i| {
            assert_eq!(i["source"], source(HELLO, "notes"));
            let text = |key: &str| i[key].as_str().unwrap().to_owned();
            (text("id"), text("title"), text("updatedAt"))
        })
        .collect();
    found.sort();
    assert_eq!(
        found,
        [
            ("alpha.md".into(), "Alpha".into(), time(NOW - DAY)),
            ("beta.md".into(), "beta".into(), time(NOW - 2 * DAY)),
        ]
    );
    let listed = desk.instances(HELLO);
    let notes = listed.iter().find(|i| i["instance"] == "notes").unwrap();
    assert_eq!(notes["title"], "Notes");
    assert_eq!(notes["settings"], json!({ "folder": "~/Notes" }));
    assert_eq!(state(notes), "connected");
}

#[test]
fn disconnect_clears_the_items_and_the_secrets() {
    let (desk, _calendar) = mac_desk("connector-disconnect", mac());
    write_at(&desk.home.join("Notes/alpha.md"), "# Alpha", NOW - DAY);
    hello(&desk, true, |m| {
        let token = json!({ "kind": "string", "title": "Token", "secret": true });
        m["connector"]["instanceSettings"]["token"] = token;
    });
    let settings = json!({ "folder": "~/Notes", "token": "s3cret-t0ken" });
    desk.connect(json!({ "connector": HELLO, "instance": "notes", "settings": settings }))
        .unwrap();
    let secrets = desk.data.join("secrets.json");
    let kept: Value = serde_json::from_str(&std::fs::read_to_string(&secrets).unwrap()).unwrap();
    assert_eq!(kept["version"], 1);
    assert_eq!(
        kept["secrets"][format!("{HELLO}/notes")]["token"],
        "s3cret-t0ken"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&secrets).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    desk.tick();
    desk.connect(json!({ "connector": "desk.calendar" }))
        .unwrap();
    desk.tick();
    let listed = serde_json::to_string(&desk.connectors()).unwrap();
    assert!(!listed.contains("s3cret"), "{listed}");
    assert_eq!(desk.items(json!({ "kinds": ["note"] })).len(), 1);

    desk.ok(
        "desk",
        "data.subscribe",
        json!({ "query": {}, "scope": { "permission": "data:read" } }),
    );
    let disconnect = |connector: &str, instance: &str| {
        let params =
            json!({ "connector": connector, "instance": instance, "scope": connector_manage() });
        desk.call("desk", "connector.disconnect", params)
    };
    assert_eq!(disconnect(HELLO, "notes").unwrap(), json!({}));
    let events = collect_disconnect(&desk.seen, HELLO, "notes").unwrap();
    let removed = &events
        .iter()
        .find(|(_, event)| event["event"] == "data.changed")
        .unwrap()
        .1["data"];
    assert_eq!(
        removed["changes"],
        json!([{ "change": "removed", "source": source(HELLO, "notes"), "id": "alpha.md" }])
    );
    assert!(desk.items(json!({ "kinds": ["note"] })).is_empty());
    assert!(
        !std::fs::read_to_string(&secrets)
            .unwrap()
            .contains("s3cret")
    );
    assert!(desk.instances(HELLO).is_empty());
    assert!(!serde_json::to_string(&events).unwrap().contains("s3cret"));
    let gone = events
        .iter()
        .find(|(_, e)| e["data"]["change"] == "disconnected")
        .unwrap();
    assert_eq!(
        gone.1["data"],
        json!({ "connector": HELLO, "instance": "notes", "change": "disconnected" })
    );
    assert_eq!(
        disconnect(HELLO, "notes").unwrap_err().code,
        ErrorCode::NotFound
    );

    assert!(!desk.items(json!({ "kinds": ["event"] })).is_empty());
    disconnect("desk.calendar", "default").unwrap();
    assert!(desk.items(json!({ "kinds": ["event"] })).is_empty());
    assert!(desk.instances("desk.calendar").is_empty());
}

#[test]
fn a_connector_plugin_turned_off_pauses_its_instances() {
    let desk = Desk::new("connector-paused", None);
    write_at(&desk.home.join("Notes/alpha.md"), "# Alpha", NOW - DAY);
    hello(&desk, true, |_| {});
    notes(&desk, "notes").unwrap();
    desk.tick();
    assert_eq!(desk.items(json!({ "kinds": ["note"] })).len(), 1);
    desk.grant("desk", json!({ "permission": "plugin:manage" }));
    let enable = |enabled: bool| {
        let scope = json!({ "permission": "plugin:manage" });
        desk.ok(
            "desk",
            "plugin.setEnabled",
            json!({ "plugin": HELLO, "enabled": enabled, "scope": scope }),
        );
    };
    desk.drain();
    enable(false);
    let (_, paused) = desk.wait_for("connector.changed");
    assert_eq!(
        (
            paused["change"].as_str(),
            paused["status"]["state"].as_str()
        ),
        (Some("updated"), Some("paused"))
    );

    write_at(&desk.home.join("Notes/gamma.md"), "# Gamma", NOW);
    desk.clock.advance(400);
    desk.tick();
    assert_eq!(
        desk.items(json!({ "kinds": ["note"] })).len(),
        1,
        "a paused instance syncs nothing"
    );
    assert_eq!(state(&desk.instances(HELLO)[0]), "paused");

    enable(true);
    desk.tick();
    assert_eq!(desk.items(json!({ "kinds": ["note"] })).len(), 2);
    assert_eq!(state(&desk.instances(HELLO)[0]), "connected");
}

#[test]
fn connections_survive_a_restart() {
    let calendar = || -> Arc<dyn CalendarSource> {
        Arc::new(mac().with_authorization(Authorization::FullAccess))
    };
    let desk = Desk::new("connector-restart", Some(calendar()));
    write_at(&desk.home.join("Notes/alpha.md"), "# Alpha", NOW - DAY);
    hello(&desk, true, |_| {});
    notes(&desk, "notes").unwrap();
    desk.connect(json!({ "connector": "desk.calendar", "title": "Mac calendar" }))
        .unwrap();
    desk.tick();

    let desk = desk.restart(Some(calendar()));
    hello(&desk, true, |_| {});
    let listed = desk.connectors();
    let titles: Vec<(String, String, String)> = listed
        .iter()
        .flat_map(|c| c["instances"].as_array().unwrap().clone())
        .map(|i| {
            let text = |key: &str| i[key].as_str().unwrap_or_default().to_owned();
            (text("connector"), text("instance"), text("title"))
        })
        .collect();
    assert_eq!(
        titles,
        [
            (
                "desk.calendar".into(),
                "default".into(),
                "Mac calendar".into()
            ),
            (HELLO.into(), "notes".into(), "Notes".into()),
        ]
    );
    assert_eq!(desk.items(json!({ "kinds": ["note"] })).len(), 1);
    assert_eq!(desk.items(json!({ "kinds": ["event"] })).len(), 3);
}
