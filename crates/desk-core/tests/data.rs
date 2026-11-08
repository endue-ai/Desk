//! data.* over desk-index (ADR 0033): pages under the caller's data:read scope, one item by source
//! and id, and data.changed for a subscription, addressed to its caller alone and ended by
//! data.unsubscribe, a revoke or the plugin turning off.

mod layer;

use std::time::Duration;

use desk_bridge::{ErrorCode, Permission};
use desk_core::{PermissionEngine, Target};
use layer::{Desk, NOW, ids, source, time};
use serde_json::{Value, json};

const VIEW: &str = "example.view";
const OTHER: &str = "example.other";

fn task(id: &str, instance: &str, title: &str, status: &str, priority: u64, at: u64) -> Value {
    json!({
        "id": id, "source": source("desk.reminders", instance), "kind": "task", "title": title,
        "status": status, "priority": priority, "updatedAt": time(at),
    })
}

fn event(id: &str, title: &str) -> Value {
    json!({
        "id": id, "source": source("desk.calendar", "default"), "kind": "event", "title": title,
        "start": time(NOW), "end": time(NOW + 3_600), "updatedAt": time(NOW),
    })
}

/// Tasks, an event and a note from three connectors.
fn seeded(tag: &str) -> Desk {
    let desk = Desk::new(tag, None);
    desk.upsert(&[
        task("t1", "default", "Write the report", "open", 1, NOW - 10),
        task("t2", "default", "Report the bug", "open", 2, NOW - 20),
        task("t3", "default", "Report expenses", "open", 3, NOW - 30),
        task("t4", "default", "Report sent", "done", 1, NOW - 40),
        task("t5", "work", "Report to the board", "open", 1, NOW - 50),
        event("e1", "Report review"),
        json!({
            "id": "n1", "source": source("example.mail", "default"), "kind": "note",
            "title": "Report draft", "updatedAt": time(NOW),
        }),
        json!({
            "id": "t6", "source": source("example.mail", "default"), "kind": "task",
            "title": "Report from mail", "status": "open", "updatedAt": time(NOW),
        }),
    ]);
    desk
}

fn read(kinds: &[&str], sources: Option<&[&str]>) -> Value {
    let mut scope = json!({ "permission": "data:read", "kinds": kinds });
    if let Some(sources) = sources {
        scope["sources"] = json!(sources);
    }
    scope
}

#[test]
fn data_query_pages_the_index_under_the_callers_data_read_scope() {
    let desk = seeded("data-query");
    let scope = read(&["event", "task"], Some(&["desk.*"]));
    desk.grant(VIEW, scope.clone());
    let query = json!({
        "kinds": ["task", "note"],
        "sources": ["desk.reminders/default", "example.mail"],
        "text": "report",
        "where": [{ "field": "status", "op": "eq", "value": "open" }],
        "sort": [{ "field": "priority", "dir": "asc" }],
        "limit": 2,
    });
    let first = desk.ok(
        VIEW,
        "data.query",
        json!({ "query": query, "scope": scope }),
    );
    assert_eq!(ids(first["items"].as_array().unwrap()), ["t1", "t2"]);
    let cursor = first["cursor"].as_str().expect("a cursor to the rest");

    let mut rest = query.clone();
    rest["cursor"] = json!(cursor);
    let second = desk.ok(VIEW, "data.query", json!({ "query": rest, "scope": scope }));
    assert_eq!(ids(second["items"].as_array().unwrap()), ["t3"]);
    assert!(second.get("cursor").is_none(), "{second}");

    let mut forged = query.clone();
    forged["cursor"] = json!("bm90IGEgY3Vyc29y");
    let params = json!({ "query": forged, "scope": scope });
    desk.fails(VIEW, "data.query", params, ErrorCode::InvalidParams);
    let named = json!({ "query": { "sources": ["$calendar"] }, "scope": scope });
    desk.fails(VIEW, "data.query", named, ErrorCode::InvalidParams);
}

#[test]
fn data_query_with_a_scope_wider_than_the_grant_is_permission_denied() {
    let desk = seeded("data-wider");
    desk.grant(VIEW, read(&["task"], None));
    let wider = read(&["task", "event"], None);
    let params = json!({ "query": {}, "scope": wider });
    let error = desk.fails(VIEW, "data.query", params, ErrorCode::PermissionDenied);
    assert_eq!(serde_json::to_value(error.permission).unwrap(), wider);
}

#[test]
fn data_get_returns_the_item_or_none() {
    let desk = seeded("data-get");
    let scope = read(&["task"], None);
    desk.grant(VIEW, scope.clone());
    let get = |connector: &str, id: &str| {
        let params = json!({ "source": source(connector, "default"), "id": id, "scope": scope });
        desk.ok(VIEW, "data.get", params)
    };
    let found = get("desk.reminders", "t1");
    assert_eq!(found["item"]["title"], "Write the report");
    assert_eq!(found["item"]["source"], source("desk.reminders", "default"));
    assert_eq!(get("desk.reminders", "t404"), json!({}));
    assert_eq!(
        get("desk.calendar", "e1"),
        json!({}),
        "an event is not a task"
    );
}

/// data.subscribe as `caller` for every item that is not done, of the kinds the scope covers.
fn subscribe(desk: &Desk, caller: &str, scope: &Value) -> String {
    let query = json!({ "where": [{ "field": "status", "op": "ne", "value": "done" }] });
    let answer = desk.ok(
        caller,
        "data.subscribe",
        json!({ "query": query, "scope": scope }),
    );
    answer["subscriptionId"].as_str().unwrap().to_owned()
}

/// The data.changed deliveries for `id` among everything delivered so far.
fn changed_for(seen: &[(Option<Vec<String>>, Value)], id: &str) -> usize {
    let changed = seen.iter().filter(|(_, e)| e["event"] == "data.changed");
    changed
        .filter(|(_, e)| e["data"]["subscriptionId"] == id)
        .count()
}

#[test]
fn data_subscribe_delivers_data_changed_to_the_subscriber_only() {
    let desk = Desk::new("data-subscribe", None);
    let scope = read(&["task"], None);
    desk.grant(VIEW, scope.clone());
    desk.grant(OTHER, scope.clone());
    let id = subscribe(&desk, VIEW, &scope);
    assert!(id.starts_with("d-"), "{id}");

    // The event matches the query (it has no status) but not the scope.
    desk.upsert(&[event("e9", "Rent day")]);
    desk.upsert(&[task("t9", "default", "Pay rent", "open", 1, NOW)]);
    desk.upsert(&[task("t9", "default", "Pay rent", "done", 1, NOW + 1)]);

    let (to, data) = desk.wait_for("data.changed");
    assert_eq!(to, Some(vec![VIEW.to_owned()]));
    assert_eq!(data["subscriptionId"], id.as_str());
    let changes = data["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 1, "{data}");
    assert_eq!(changes[0]["change"], "upserted");
    assert_eq!(changes[0]["item"]["id"], "t9");

    let (to, data) = desk.wait_for("data.changed");
    assert_eq!(to, Some(vec![VIEW.to_owned()]));
    assert_eq!(
        data["changes"],
        json!([{ "change": "removed", "source": source("desk.reminders", "default"), "id": "t9" }])
    );
    let later = desk.named("data.changed", Duration::from_millis(200));
    assert!(later.is_empty(), "nothing else arrives: {later:?}");
}

#[test]
fn data_unsubscribe_ends_delivery_and_refuses_other_ids() {
    let desk = Desk::new("data-unsubscribe", None);
    let scope = read(&["task"], None);
    desk.grant(VIEW, scope.clone());
    desk.grant(OTHER, scope.clone());
    let ended = subscribe(&desk, VIEW, &scope);
    let witness = subscribe(&desk, OTHER, &scope);

    let unknown = json!({ "subscriptionId": "d-404" });
    desk.fails(VIEW, "data.unsubscribe", unknown, ErrorCode::NotFound);
    let theirs = json!({ "subscriptionId": witness });
    desk.fails(VIEW, "data.unsubscribe", theirs, ErrorCode::NotFound);
    let mine = json!({ "subscriptionId": ended });
    assert_eq!(desk.ok(VIEW, "data.unsubscribe", mine), json!({}));

    desk.upsert(&[task("t9", "default", "Pay rent", "open", 1, NOW)]);
    let (_, data) = desk.wait_for("data.changed");
    assert_eq!(data["subscriptionId"], witness.as_str());
    let seen = desk.drain();
    std::thread::sleep(Duration::from_millis(200));
    let seen = [seen, desk.drain()].concat();
    assert_eq!(changed_for(&seen, &ended), 0, "{seen:?}");
}

#[test]
fn a_revoke_or_a_plugin_turned_off_ends_its_data_subscriptions() {
    let desk = Desk::new("data-ended", None);
    let scope = read(&["task"], None);
    let grant = desk.grant(VIEW, scope.clone());
    desk.grant(OTHER, scope.clone());
    let revoked = subscribe(&desk, VIEW, &scope);

    let dir = desk.home.join("plugins/hello");
    std::fs::create_dir_all(dir.join("ui")).unwrap();
    std::fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    let manifest =
        r#"{ "id": "example.hello", "version": "0.1.0", "kind": "ui", "entry": "ui/index.html" }"#;
    std::fs::write(dir.join("plugin.json"), manifest).unwrap();
    desk.core.install_plugin(&dir, false);
    desk.grant("example.hello", scope.clone());
    let unloaded = subscribe(&desk, "example.hello", &scope);
    let witness = subscribe(&desk, OTHER, &scope);

    desk.ok(VIEW, "perm.revoke", json!({ "grantId": grant }));
    desk.grant("desk", json!({ "permission": "plugin:manage" }));
    let off = json!({
        "plugin": "example.hello", "enabled": false, "scope": { "permission": "plugin:manage" },
    });
    desk.ok("desk", "plugin.setEnabled", off);

    desk.upsert(&[task("t9", "default", "Pay rent", "open", 1, NOW)]);
    let (_, data) = desk.wait_for("data.changed");
    assert_eq!(data["subscriptionId"], witness.as_str());
    std::thread::sleep(Duration::from_millis(200));
    let seen = desk.drain();
    assert_eq!(
        changed_for(&seen, &revoked),
        0,
        "after the revoke: {seen:?}"
    );
    assert_eq!(
        changed_for(&seen, &unloaded),
        0,
        "after turning off: {seen:?}"
    );
}

fn permission(value: Value) -> Permission {
    serde_json::from_value(value).unwrap()
}

/// `data:read` with optional kinds and sources.
fn data_read(kinds: Option<&[&str]>, sources: Option<&[&str]>) -> Permission {
    let mut value = json!({ "permission": "data:read" });
    if let Some(kinds) = kinds {
        value["kinds"] = json!(kinds);
    }
    if let Some(sources) = sources {
        value["sources"] = json!(sources);
    }
    permission(value)
}

fn allows(engine: &PermissionEngine, caller: &str, scope: &Permission) -> bool {
    engine.authorize(caller, scope, &Target::None).is_ok()
}

#[test]
fn a_data_read_grant_covers_narrower_kinds_and_sources_and_nothing_wider() {
    let mut engine = PermissionEngine::new();
    let view = "example.view";
    engine.grant(view, data_read(Some(&["event", "task"]), Some(&["desk.*"])));

    for (kinds, sources) in [
        (&["event", "task"][..], &["desk.*"][..]),
        (&["event"], &["desk.fixtures"]),
        (&["task"], &["desk.fixtures", "desk.os-reminders"]),
        (&["task"], &["desk.fixtures.*"]),
    ] {
        let scope = data_read(Some(kinds), Some(sources));
        assert!(allows(&engine, view, &scope), "{kinds:?} from {sources:?}");
    }
    for (kinds, sources, why) in [
        (
            Some(&["note"][..]),
            Some(&["desk.fixtures"][..]),
            "a kind outside",
        ),
        (
            Some(&["event", "note"]),
            Some(&["desk.fixtures"]),
            "one kind outside",
        ),
        (Some(&["event"]), Some(&["endue.mail"]), "a source outside"),
        (Some(&["event"]), Some(&["*"]), "every source"),
        (None, Some(&["desk.fixtures"]), "every kind"),
        (Some(&["event"]), None, "every source, by leaving it out"),
        (None, None, "everything"),
    ] {
        let scope = data_read(kinds, sources);
        assert!(
            !allows(&engine, view, &scope),
            "{why} is wider than the grant"
        );
    }

    // Absent kinds or sources in a grant mean all of them.
    let all = "example.all";
    engine.grant(all, data_read(None, None));
    assert!(allows(&engine, all, &data_read(None, None)));
    assert!(allows(
        &engine,
        all,
        &data_read(Some(&["metric"]), Some(&["*"]))
    ));
    let kinds_only = "example.tasks";
    engine.grant(kinds_only, data_read(Some(&["task"]), None));
    assert!(allows(
        &engine,
        kinds_only,
        &data_read(Some(&["task"]), Some(&["endue.*"]))
    ));
    assert!(!allows(
        &engine,
        kinds_only,
        &data_read(Some(&["event"]), None)
    ));

    // The two scopeless permissions cover themselves, and data:read neither of them.
    let connectors = permission(json!({ "permission": "connector:manage" }));
    let views = permission(json!({ "permission": "view:manage" }));
    assert!(!allows(&engine, all, &connectors));
    assert!(!allows(&engine, all, &views));
    let admin = "example.admin";
    engine.grant(admin, connectors.clone());
    assert!(allows(&engine, admin, &connectors));
    assert!(!allows(&engine, admin, &views));
    assert!(!allows(&engine, admin, &data_read(None, None)));
    engine.grant(admin, views.clone());
    assert!(allows(&engine, admin, &views));
}
