//! catalog.get, filtered by the caller's grants, and the integration layer as a whole: no data,
//! connector, view or catalog method answers `unsupported` any more, and every success has the
//! shape of its method's `*Result` in the embedded schemas.

mod layer;

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use desk_bridge::{ErrorCode, SCHEMAS};
use layer::fixtures::{mac, mac_desk};
use layer::{Desk, connector_manage, view_manage};
use serde_json::{Value, json};

const VIEW: &str = "example.view";

const COMPONENTS: [&str; 10] = [
    "list", "table", "card", "detail", "calendar", "agenda", "kanban", "chart", "markdown", "stat",
];

fn catalog(desk: &Desk, caller: &str) -> Value {
    desk.ok(caller, "catalog.get", json!({}))
}

#[test]
fn catalog_get_lists_every_component() {
    let desk = Desk::new("catalog-components", None);
    let answer = catalog(&desk, VIEW);
    assert_eq!(answer["components"], json!(COMPONENTS));
    assert_eq!(answer["connectors"], json!([]));
    assert_eq!(answer["commands"], json!([]));
}

/// The fields a view can name in `items`: their top-level keys and `raw.<key>`, sorted.
fn fields_of(items: &[Value]) -> Vec<String> {
    let mut fields = BTreeSet::new();
    for item in items {
        for (key, value) in item.as_object().unwrap() {
            if key == "raw" {
                fields.extend(
                    value
                        .as_object()
                        .unwrap()
                        .keys()
                        .map(|k| format!("raw.{k}")),
                );
            } else {
                fields.insert(key.clone());
            }
        }
    }
    fields.into_iter().collect()
}

#[test]
fn catalog_get_shows_the_connectors_and_kinds_the_callers_data_read_grants_cover() {
    let (desk, _calendar) = mac_desk("catalog-connectors", mac());
    desk.connect(json!({ "connector": "desk.calendar" }))
        .unwrap();
    desk.connect(json!({ "connector": "desk.reminders" }))
        .unwrap();
    desk.tick();
    desk.grant(
        VIEW,
        json!({ "permission": "data:read", "kinds": ["event"] }),
    );

    let events = desk.items(json!({ "kinds": ["event"] }));
    let fields = fields_of(&events);
    for field in ["start", "end", "calendar", "raw.calendarId"] {
        assert!(fields.contains(&field.to_owned()), "{field} in {fields:?}");
    }
    let expected = json!([{
        "id": "desk.calendar",
        "instances": ["default"],
        "kinds": [{ "kind": "event", "fields": fields }],
    }]);
    assert_eq!(catalog(&desk, VIEW)["connectors"], expected);
    assert_eq!(catalog(&desk, "example.nobody")["connectors"], json!([]));

    // A connector without instances is left out, whatever the grant covers.
    let disconnect = json!({
        "connector": "desk.reminders", "instance": "default", "scope": connector_manage(),
    });
    desk.ok("desk", "connector.disconnect", disconnect);
    desk.grant("example.all", json!({ "permission": "data:read" }));
    let all = catalog(&desk, "example.all")["connectors"].clone();
    let ids: Vec<&str> = all
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["desk.calendar"]);
}

#[test]
fn catalog_get_lists_the_commands_the_callers_cmd_invoke_grants_cover() {
    let desk = Desk::saying_yes("catalog-commands");
    for (provider, id) in [
        ("example.a", "example.a.two"),
        ("example.b", "example.b.one"),
        ("example.a", "example.a.one"),
    ] {
        desk.ok(provider, "cmd.register", json!({ "id": id, "title": id }));
    }
    let once = json!({
        "permission": { "permission": "cmd:invoke", "ids": ["example.a.*"] },
        "reason": "to show its commands", "duration": "once",
    });
    let granted = desk.ok(VIEW, "perm.request", once);
    assert_eq!(granted["grant"]["duration"], "once", "{granted}");
    let commands = catalog(&desk, VIEW)["commands"].clone();
    let listed: Vec<(&str, &str)> = commands
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["id"].as_str().unwrap(), c["provider"].as_str().unwrap()))
        .collect();
    assert_eq!(
        listed,
        [
            ("example.a.two", "example.a"),
            ("example.a.one", "example.a")
        ]
    );
    assert_eq!(catalog(&desk, "example.nobody")["commands"], json!([]));
    let grants = desk.ok(VIEW, "perm.query", json!({}));
    assert_eq!(
        grants["grants"].as_array().unwrap().len(),
        1,
        "the once grant is not spent"
    );
}

/// The `*Result` definition of each integration method.
fn result_of(method: &str) -> &'static str {
    match method {
        "data.query" => "DataQueryResult",
        "data.get" => "DataGetResult",
        "data.subscribe" => "DataSubscribeResult",
        "data.unsubscribe" => "DataUnsubscribeResult",
        "connector.list" => "ConnectorListResult",
        "connector.connect" => "ConnectorConnectResult",
        "connector.disconnect" => "ConnectorDisconnectResult",
        "connector.sync" => "ConnectorSyncNowResult",
        "view.list" => "ViewListResult",
        "view.get" => "ViewGetResult",
        "view.save" => "ViewSaveResult",
        "view.remove" => "ViewRemoveResult",
        "catalog.get" => "CatalogGetResult",
        other => panic!("{other} is not an integration method"),
    }
}

/// A validator for `definition` in the embedded schemas.
fn validator(definition: &str) -> jsonschema::Validator {
    let resources = SCHEMAS.iter().map(|(id, text)| {
        let value: Value = serde_json::from_str(text).unwrap();
        ((*id).to_owned(), value)
    });
    let registry = jsonschema::Registry::new()
        .extend(resources)
        .unwrap()
        .prepare()
        .unwrap();
    let (id, _) = SCHEMAS
        .iter()
        .find(|(_, text)| text.contains(&format!("\"{definition}\"")))
        .unwrap_or_else(|| panic!("no schema defines {definition}"));
    jsonschema::options()
        .with_registry(&registry)
        .should_validate_formats(false)
        .build(&json!({ "$ref": format!("{id}#/$defs/{definition}") }))
        .unwrap()
}

/// Call `method` as `caller` with its scope granted; it must not answer `unsupported`, and a
/// success must validate against its result definition.
fn served(desk: &Desk, caller: &str, method: &str, params: Value) {
    if let Some(scope) = params.get("scope") {
        desk.grant(caller, scope.clone());
    }
    match desk.call(caller, method, params) {
        Ok(result) => {
            let problems: Vec<String> = validator(result_of(method))
                .iter_errors(&result)
                .map(|e| format!("{}: {e}", e.instance_path()))
                .collect();
            assert!(
                problems.is_empty(),
                "{method} answered {result}: {problems:?}"
            );
        }
        Err(error) => assert_ne!(
            error.code,
            ErrorCode::Unsupported,
            "{method}: {}",
            error.message
        ),
    }
}

#[test]
fn no_integration_method_answers_unsupported() {
    let (desk, _calendar) = mac_desk("catalog-served", mac());
    let read = json!({ "permission": "data:read", "kinds": ["task"] });
    let source = json!({ "connector": "desk.calendar", "instance": "default" });
    let instance =
        json!({ "connector": "desk.calendar", "instance": "default", "scope": connector_manage() });
    let view = json!({
        "id": "example.today", "version": "0.1.0", "title": "Today",
        "layout": { "type": "list", "binding": { "kinds": ["task"] } },
    });
    let calls = [
        (
            "data.query",
            json!({ "query": { "kinds": ["task"] }, "scope": read }),
        ),
        (
            "data.get",
            json!({ "source": source, "id": "e-standup", "scope": read }),
        ),
        ("data.subscribe", json!({ "query": {}, "scope": read })),
        ("data.unsubscribe", json!({ "subscriptionId": "d-1" })),
        ("connector.list", json!({ "scope": connector_manage() })),
        (
            "connector.connect",
            json!({ "connector": "desk.calendar", "scope": connector_manage() }),
        ),
        ("connector.sync", instance.clone()),
        ("connector.disconnect", instance),
        ("view.list", json!({ "scope": view_manage() })),
        ("view.save", json!({ "view": view, "scope": view_manage() })),
        (
            "view.get",
            json!({ "id": "example.today", "scope": view_manage() }),
        ),
        (
            "view.remove",
            json!({ "id": "example.today", "scope": view_manage() }),
        ),
        ("catalog.get", json!({})),
    ];
    for (method, params) in calls {
        served(&desk, VIEW, method, params);
    }

    let vectors = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../specs/bridge/v0/vectors/valid");
    let mut names: Vec<String> = fs::read_dir(&vectors)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| {
            let ours = ["data-", "connector-", "view-", "catalog-"];
            ours.iter().any(|p| name.starts_with(p)) && name.ends_with("-request.json")
        })
        .collect();
    names.sort();
    assert!(names.len() >= 8, "{names:?}");
    for name in names {
        let text = fs::read_to_string(vectors.join(&name)).unwrap();
        let vector: Value = serde_json::from_str(&text).unwrap();
        let request = &vector["instance"];
        let method = request["method"].as_str().unwrap();
        served(&desk, "example.vectors", method, request["params"].clone());
    }
}
