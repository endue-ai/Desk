//! connector.* over the OS calendar: the built-in connectors desk.calendar and desk.reminders on a
//! FakeCalendar (never the OS), their items, statuses as connector.changed, and the OS asked only on
//! connect. Syncs run on an explicit tick and a fake clock. Wasm connectors: `connectors_wasm.rs`.

mod layer;

use std::sync::{Arc, Mutex};

use desk_bridge::ErrorCode;
use desk_sys::Error;
use desk_sys::calendar::{Authorization, Calendar, CalendarSource, Event, Reminder, Status};
use layer::fixtures::{by_id, calendars, event, mac, mac_desk, state};
use layer::{DAY, Desk, HOUR, NOW, connector_manage, ids, source, time};
use serde_json::{Value, json};

#[test]
fn connector_list_needs_connector_manage_and_names_the_built_in_connectors() {
    let (desk, calendar) = mac_desk("connector-list", mac());
    let scope = json!({ "scope": connector_manage() });
    desk.fails("desk", "connector.list", scope, ErrorCode::PermissionDenied);
    let listed = desk.connectors();
    let summary: Vec<(String, Value, Value)> = listed
        .iter()
        .map(|c| {
            (
                c["id"].as_str().unwrap().to_owned(),
                c["instances"].clone(),
                c["resources"].clone(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (
                "desk.calendar".into(),
                json!([]),
                json!([{ "kind": "event" }])
            ),
            (
                "desk.reminders".into(),
                json!([]),
                json!([{ "kind": "task" }])
            ),
        ]
    );
    assert_eq!(calendar.authorization(), Authorization::NotDetermined);
}

#[test]
fn connecting_desk_calendar_asks_the_os_and_brings_events_in() {
    let (desk, calendar) = mac_desk("connector-calendar", mac());
    let answer = desk
        .connect(json!({ "connector": "desk.calendar" }))
        .unwrap();
    assert_eq!(answer, json!({ "instance": "default" }));
    assert_eq!(calendar.authorization(), Authorization::FullAccess);
    let (to, data) = desk.wait_for("connector.changed");
    assert_eq!(to, Some(vec!["desk".to_owned()]));
    assert_eq!(
        (data["connector"].as_str(), data["change"].as_str()),
        (Some("desk.calendar"), Some("connected"))
    );

    desk.tick();
    let items =
        desk.items(json!({ "kinds": ["event"], "sort": [{ "field": "start", "dir": "asc" }] }));
    let first = NOW + DAY;
    let second = NOW + 8 * DAY;
    let review = |at: u64| format!("e-review@{}", time(at));
    assert_eq!(
        ids(&items),
        ["e-standup".to_owned(), review(first), review(second)]
    );
    let standup = by_id(&items, "e-standup");
    assert_eq!(standup["source"], source("desk.calendar", "default"));
    assert_eq!(standup["title"], "Standup");
    assert_eq!(standup["start"], time(NOW + 9 * HOUR));
    assert_eq!(standup["end"], time(NOW + 10 * HOUR));
    assert_eq!(standup["allDay"], false);
    assert_eq!(standup["location"], "Room 1");
    assert_eq!(standup["calendar"], "Work");
    assert_eq!(standup["raw"]["calendarId"], "cal-work");
    assert_eq!(standup["raw"]["eventId"], "e-standup");
    assert_eq!(standup["updatedAt"], desk.clock.text());
    assert!(standup.get("deepLink").is_none(), "{standup}");
    let weekly = by_id(&items, &review(second));
    assert_eq!(weekly["recurrence"], "FREQ=WEEKLY");
    assert_eq!(weekly["start"], time(second));
}

#[test]
fn connecting_desk_reminders_brings_reminders_in_as_tasks() {
    let (desk, _calendar) = mac_desk("connector-reminders", mac());
    desk.connect(json!({ "connector": "desk.reminders" }))
        .unwrap();
    desk.tick();
    let items = desk.items(json!({ "kinds": ["task"] }));
    let mut found = ids(&items);
    found.sort();
    assert_eq!(
        found,
        ["r-called", "r-rent"],
        "a reminder done 40 days ago is left out"
    );
    let rent = by_id(&items, "r-rent");
    assert_eq!(rent["source"], source("desk.reminders", "default"));
    assert_eq!(rent["status"], "open");
    assert_eq!(rent["due"], time(NOW + 2 * DAY));
    assert_eq!(rent["priority"], 1);
    assert_eq!(rent["project"], "Home");
    assert_eq!(rent["raw"]["listId"], "list-home");
    assert!(rent.get("completedAt").is_none(), "{rent}");
    let called = by_id(&items, "r-called");
    assert_eq!(called["status"], "done");
    assert_eq!(called["completedAt"], time(NOW - 2 * DAY));
}

/// A calendar whose events a test swaps between syncs.
struct Swappable(Mutex<Vec<Event>>);

impl CalendarSource for Swappable {
    fn authorization(&self) -> Authorization {
        Authorization::FullAccess
    }
    fn request_access(&self) -> Result<Authorization, Error> {
        Ok(Authorization::FullAccess)
    }
    fn calendars(&self) -> Result<Vec<Calendar>, Error> {
        Ok(calendars())
    }
    fn events(&self, _from: &str, _to: &str) -> Result<Vec<Event>, Error> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn reminders(&self, _status: Status) -> Result<Vec<Reminder>, Error> {
        Ok(Vec::new())
    }
}

#[test]
fn a_calendar_sync_writes_only_what_changed() {
    let a = event("e-a", "Planning", NOW + HOUR, 1);
    let b = event("e-b", "Lunch", NOW + 3 * HOUR, 1);
    let source_events = Arc::new(Swappable(Mutex::new(vec![a.clone(), b.clone()])));
    let shared: Arc<dyn CalendarSource> = source_events.clone();
    let desk = Desk::new("connector-changed", Some(shared));
    desk.connect(json!({ "connector": "desk.calendar" }))
        .unwrap();
    desk.grant("desk", json!({ "permission": "data:read" }));
    let scope = json!({ "permission": "data:read" });
    desk.ok(
        "desk",
        "data.subscribe",
        json!({ "query": { "kinds": ["event"] }, "scope": scope }),
    );
    desk.tick();
    let (_, first) = desk.wait_for("data.changed");
    assert_eq!(first["changes"].as_array().unwrap().len(), 2, "{first}");

    // Nothing changed: nothing is written, and updatedAt stays.
    desk.clock.advance(1_000);
    desk.tick();
    let items = desk.items(json!({ "kinds": ["event"] }));
    assert!(
        items.iter().all(|i| i["updatedAt"] == time(NOW)),
        "{items:?}"
    );

    // One renamed event is one upsert, stamped with the clock.
    *source_events.0.lock().unwrap() = vec![
        Event {
            title: "Planning, moved".into(),
            ..a
        },
        b.clone(),
    ];
    desk.clock.advance(1_000);
    desk.tick();
    let (_, renamed) = desk.wait_for("data.changed");
    let changes = renamed["changes"].as_array().unwrap();
    assert_eq!(
        changes.len(),
        1,
        "the unchanged sync sent nothing, and this one sends one: {renamed}"
    );
    assert_eq!(changes[0]["change"], "upserted");
    assert_eq!(changes[0]["item"]["title"], "Planning, moved");
    assert_eq!(changes[0]["item"]["updatedAt"], desk.clock.text());

    // An event gone from the source is removed.
    *source_events.0.lock().unwrap() = vec![b];
    desk.ok(
        "desk",
        "connector.sync",
        json!({ "connector": "desk.calendar", "instance": "default", "scope": connector_manage() }),
    );
    let (_, gone) = desk.wait_for("data.changed");
    assert_eq!(
        gone["changes"],
        json!([{ "change": "removed", "source": source("desk.calendar", "default"), "id": "e-a" }])
    );
}

#[test]
fn an_os_refusal_is_permission_denied_and_leaves_the_instance_in_error() {
    let refusing = mac().with_answer(Authorization::Denied);
    let refused = mac().with_authorization(Authorization::Denied);
    for (tag, calendar) in [
        ("connector-refusing", refusing),
        ("connector-refused", refused),
    ] {
        let (desk, calendar) = mac_desk(tag, calendar);
        let error = desk
            .connect(json!({ "connector": "desk.calendar" }))
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PermissionDenied, "{}", error.message);
        assert!(error.permission.is_none(), "{error:?}");
        assert_eq!(calendar.authorization(), Authorization::Denied);
        desk.tick();
        let instances = desk.instances("desk.calendar");
        assert_eq!(instances.len(), 1, "{instances:?}");
        assert_eq!(state(&instances[0]), "error");
        let message = instances[0]["status"]["error"]["message"].as_str().unwrap();
        assert!(message.contains("System Settings"), "{message}");
        assert_eq!(calendar.calls(), 0);
        assert!(desk.items(json!({})).is_empty());
    }
}

#[test]
fn connector_sync_starts_at_once_and_reports_its_progress() {
    let (desk, _calendar) = mac_desk("connector-sync", mac());
    desk.connect(json!({ "connector": "desk.calendar" }))
        .unwrap();
    desk.drain();
    let sync = |connector: &str, instance: &str| {
        let params =
            json!({ "connector": connector, "instance": instance, "scope": connector_manage() });
        desk.call("desk", "connector.sync", params)
    };
    assert_eq!(
        sync("desk.calendar", "default").unwrap(),
        json!({ "started": true })
    );
    let (to, syncing) = desk.wait_for("connector.changed");
    assert_eq!(to, Some(vec!["desk".to_owned()]));
    assert_eq!(syncing["change"], "updated");
    assert_eq!(syncing["status"]["state"], "syncing");
    let (to, done) = desk.wait_for("connector.changed");
    assert_eq!(to, Some(vec!["desk".to_owned()]));
    assert_eq!(done["change"], "updated");
    assert_eq!(
        done["status"],
        json!({ "state": "connected", "lastSyncAt": desk.clock.text() })
    );
    assert_eq!(
        sync("example.nothing", "default").unwrap_err().code,
        ErrorCode::NotFound
    );
    assert_eq!(
        sync("desk.reminders", "default").unwrap_err().code,
        ErrorCode::NotFound
    );
}
