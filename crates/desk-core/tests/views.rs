//! view.* over the person's view files, `~/.desk/views/<id>.yaml` (specs/view/v0): saved after the
//! schema and the names check, read back from disk, removed, and watched both ways, so a file edited
//! by hand is a view.changed too. Invalid files are reported and left out.

mod layer;

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use desk_bridge::ErrorCode;
use layer::{Desk, view_manage};
use serde_json::{Value, json};

const OTHER: &str = "example.other";

fn today() -> Value {
    json!({
        "id": "example.today", "version": "0.1.0", "title": "Today",
        "description": "What is on today.",
        "requires": { "calendar": { "kinds": ["event"] } },
        "layout": {
            "type": "agenda", "range": "day",
            "binding": { "kinds": ["event"], "sources": ["$calendar"] },
            "fields": [{ "value": "{start|time} {title}" }],
        },
    })
}

fn folder(desk: &Desk) -> PathBuf {
    desk.home.join(".desk/views")
}

/// A desk whose `desk` holds view:manage.
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

fn changed(desk: &Desk) -> Vec<(Option<Vec<String>>, Value)> {
    desk.named("view.changed", Duration::from_millis(100))
}

#[test]
fn view_methods_need_view_manage() {
    let desk = Desk::new("views-denied", None);
    let scope = view_manage();
    for (method, params) in [
        ("view.list", json!({ "scope": scope })),
        ("view.get", json!({ "id": "example.today", "scope": scope })),
        ("view.save", json!({ "view": today(), "scope": scope })),
        (
            "view.remove",
            json!({ "id": "example.today", "scope": scope }),
        ),
    ] {
        desk.fails(OTHER, method, params, ErrorCode::PermissionDenied);
    }
}

#[test]
fn view_save_writes_yaml_that_list_and_get_read_back() {
    let desk = manager("views-save");
    assert_eq!(save(&desk, today()).unwrap(), json!({}));
    let file = folder(&desk).join("example.today.yaml");
    let text = fs::read_to_string(&file).unwrap();
    let parsed: Value = yaml_serde::from_str(&text).unwrap();
    assert_eq!(parsed, today());

    let listed = desk.ok("desk", "view.list", json!({ "scope": view_manage() }));
    let summary = json!({
        "id": "example.today", "version": "0.1.0", "title": "Today",
        "description": "What is on today.",
    });
    assert_eq!(listed, json!({ "views": [summary] }));
    let got = desk.ok(
        "desk",
        "view.get",
        json!({ "id": "example.today", "scope": view_manage() }),
    );
    assert_eq!(got, json!({ "view": today() }));
    let events = changed(&desk);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].0, Some(vec!["desk".to_owned()]));
    assert_eq!(
        events[0].1["data"],
        json!({ "id": "example.today", "change": "saved" })
    );
}

#[test]
fn view_save_refuses_what_the_schema_or_its_names_refuse() {
    let desk = manager("views-refused");
    let mut unnamed = today();
    unnamed["layout"]["binding"]["sources"] = json!(["$mail"]);
    let mut undeclared = today();
    undeclared["title"] = json!("Last {params.days} days");
    let mut misnamed = today();
    misnamed["id"] = json!("Today");
    for view in [unnamed, undeclared, misnamed] {
        let error = save(&desk, view.clone()).unwrap_err();
        assert_eq!(
            error.code,
            ErrorCode::InvalidParams,
            "{view}: {}",
            error.message
        );
    }
    let written = fs::read_dir(folder(&desk)).map(|d| d.count()).unwrap_or(0);
    assert_eq!(written, 0, "nothing is written");
    assert!(changed(&desk).is_empty());
}

#[test]
fn view_remove_deletes_the_file() {
    let desk = manager("views-remove");
    save(&desk, today()).unwrap();
    changed(&desk);
    let remove = |id: &str| {
        desk.call(
            "desk",
            "view.remove",
            json!({ "id": id, "scope": view_manage() }),
        )
    };
    assert_eq!(remove("example.today").unwrap(), json!({}));
    assert!(!folder(&desk).join("example.today.yaml").exists());
    let events = changed(&desk);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(
        events[0].1["data"],
        json!({ "id": "example.today", "change": "removed" })
    );
    assert_eq!(
        remove("example.today").unwrap_err().code,
        ErrorCode::NotFound
    );
    let get = json!({ "id": "example.today", "scope": view_manage() });
    desk.fails("desk", "view.get", get, ErrorCode::NotFound);
}

/// `view` as YAML, the way a person would write it.
fn yaml(view: &Value) -> String {
    yaml_serde::to_string(view).unwrap()
}

#[test]
fn a_view_file_changed_on_disk_is_a_view_changed() {
    let desk = manager("views-watched");
    let _watcher = desk.core.watch_views().expect("the views watcher starts");
    std::thread::sleep(Duration::from_millis(200));
    let file = folder(&desk).join("example.today.yaml");

    fs::write(&file, yaml(&today())).unwrap();
    let (to, data) = desk.wait_for("view.changed");
    assert_eq!(to, Some(vec!["desk".to_owned()]));
    assert_eq!(data, json!({ "id": "example.today", "change": "saved" }));

    let mut renamed = today();
    renamed["title"] = json!("Today, by hand");
    fs::write(&file, yaml(&renamed)).unwrap();
    let (_, data) = desk.wait_for("view.changed");
    assert_eq!(data, json!({ "id": "example.today", "change": "saved" }));
    let got = desk.ok(
        "desk",
        "view.get",
        json!({ "id": "example.today", "scope": view_manage() }),
    );
    assert_eq!(got["view"]["title"], "Today, by hand");

    fs::remove_file(&file).unwrap();
    let (_, data) = desk.wait_for("view.changed");
    assert_eq!(data, json!({ "id": "example.today", "change": "removed" }));
}

#[test]
fn an_invalid_view_file_is_reported_and_left_out() {
    let desk = manager("views-invalid");
    let dir = folder(&desk);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("example.today.yaml"), yaml(&today())).unwrap();
    fs::write(dir.join("example.broken.yaml"), "title: [unclosed\n  : :").unwrap();
    let mut shapeless = today();
    shapeless["id"] = json!("example.shapeless");
    shapeless.as_object_mut().unwrap().remove("layout");
    fs::write(dir.join("example.shapeless.yaml"), yaml(&shapeless)).unwrap();

    let listed = desk.ok("desk", "view.list", json!({ "scope": view_manage() }));
    let listed: Vec<&str> = listed["views"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["id"].as_str().unwrap())
        .collect();
    assert_eq!(listed, ["example.today"]);
    for id in ["example.broken", "example.shapeless"] {
        let get = json!({ "id": id, "scope": view_manage() });
        let error = desk.fails("desk", "view.get", get, ErrorCode::InvalidParams);
        assert!(
            error.message.contains(&format!("{id}.yaml")),
            "{}",
            error.message
        );
    }
    let problems = desk.core.view_problems();
    assert_eq!(problems.len(), 2, "{problems:?}");
    assert!(problems[0].contains("example.broken.yaml"), "{problems:?}");
    assert!(
        problems[1].contains("example.shapeless.yaml"),
        "{problems:?}"
    );

    let _watcher = desk.core.watch_views().expect("the views watcher starts");
    std::thread::sleep(Duration::from_millis(200));
    fs::write(dir.join("example.broken.yaml"), "still: [broken").unwrap();
    let mut later = today();
    later["id"] = json!("example.later");
    std::thread::sleep(Duration::from_millis(300));
    fs::write(dir.join("example.later.yaml"), yaml(&later)).unwrap();
    let (_, data) = desk.wait_for("view.changed");
    assert_eq!(
        data,
        json!({ "id": "example.later", "change": "saved" }),
        "the first view.changed"
    );
}
