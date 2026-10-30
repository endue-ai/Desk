//! The integration layer's bridge methods (ADR 0032): until the core serves them, each answers
//! `unsupported` with its name, and the permission engine already judges their three permissions.

use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode, Permission};
use desk_core::{Core, PermissionEngine, Roots, Target};
use serde_json::{Value, json};

fn request(method: &str, params: Value) -> BridgeRequest {
    serde_json::from_value(json!({ "id": 7, "method": method, "params": params }))
        .unwrap_or_else(|e| panic!("{method} is not a bridge request: {e}"))
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
fn every_data_connector_view_and_catalog_method_answers_unsupported() {
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    });
    let read = json!({ "permission": "data:read", "kinds": ["task"] });
    let connectors = json!({ "permission": "connector:manage" });
    let views = json!({ "permission": "view:manage" });
    let source = json!({ "connector": "desk.fixtures", "instance": "default" });
    let instance =
        json!({ "connector": "desk.fixtures", "instance": "default", "scope": connectors });
    let view = json!({
        "id": "example.today", "version": "0.1.0", "title": "Today",
        "layout": { "type": "list", "binding": { "kinds": ["task"] } }
    });
    let calls = [
        (
            "data.query",
            json!({ "query": { "kinds": ["task"] }, "scope": read }),
        ),
        (
            "data.get",
            json!({ "source": source, "id": "task-report", "scope": read }),
        ),
        ("data.subscribe", json!({ "query": {}, "scope": read })),
        ("data.unsubscribe", json!({ "subscriptionId": "dsub-1" })),
        ("connector.list", json!({ "scope": connectors })),
        (
            "connector.connect",
            json!({ "connector": "desk.fixtures", "scope": connectors }),
        ),
        ("connector.disconnect", instance.clone()),
        ("connector.sync", instance),
        ("view.list", json!({ "scope": views })),
        ("view.get", json!({ "id": "example.today", "scope": views })),
        ("view.save", json!({ "view": view, "scope": views })),
        (
            "view.remove",
            json!({ "id": "example.today", "scope": views }),
        ),
        ("catalog.get", json!({})),
    ];
    for (method, params) in calls {
        match core.handle("example.view", request(method, params)) {
            BridgeResponse::BridgeFailure(failure) => {
                assert_eq!(failure.id, 7, "{method}");
                assert_eq!(failure.error.code, ErrorCode::Unsupported, "{method}");
                assert!(
                    failure.error.message.contains(method),
                    "{method}: {}",
                    failure.error.message
                );
            }
            BridgeResponse::BridgeSuccess(success) => {
                panic!("{method} answered {}", success.result)
            }
        }
    }
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
