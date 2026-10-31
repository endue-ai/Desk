//! view.list and view.get over the enabled view plugins' views next to the person's files: each
//! with its source and plugin, read-only, shadowed by the person's file of its id, announced as
//! view.changed when a view plugin is installed, turned on or off or reloaded, reported when invalid.

mod layer;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use desk_bridge::ErrorCode;
use layer::views::{
    call, changed, file, get, ids, list, next_changes, plugin, rewrite_manifest, set, set_enabled,
    to_desk, view, write_file, yaml,
};
use layer::{Desk, temp, view_manage};
use serde_json::{Value, json};

fn today() -> Value {
    let mut today = view("example.today", "Today");
    today["description"] = json!("What is on today.");
    today
}

fn notes() -> Value {
    let mut notes = view("example.notes", "Notes");
    notes["description"] = json!("The notes touched this week.");
    notes
}

/// `example.today`, whose inline view is `today()`.
fn today_plugin(parent: &Path) -> PathBuf {
    plugin(parent, "example.today", json!({ "view": today() }), &[])
}

/// `example.boards`, whose views are a YAML file (`example.board`) and a JSON one (`example.week`).
fn boards_plugin(parent: &Path) -> PathBuf {
    let views = json!({ "views": ["views/board.yaml", "views/week.json"] });
    let board = ("views/board.yaml", yaml(&view("example.board", "Board")));
    let week = ("views/week.json", view("example.week", "Week").to_string());
    plugin(parent, "example.boards", views, &[board, week])
}

/// A desk whose `desk` holds view:manage and plugin:manage, and a folder for the plugins.
fn desk(tag: &str) -> (Desk, PathBuf) {
    let desk = Desk::new(tag, None);
    desk.grant("desk", view_manage());
    desk.grant("desk", json!({ "permission": "plugin:manage" }));
    (desk, temp(&format!("{tag}-plugins")))
}

#[test]
fn view_list_names_each_views_source_plugin_views_next_to_files() {
    let (desk, plugins) = desk("plugin-views-list");
    desk.core.install_plugin(&today_plugin(&plugins), false);
    desk.core.install_plugin(&boards_plugin(&plugins), false);
    write_file(&desk, &notes());
    let summary = |id: &str, title: &str, plugin: &str| json!({ "id": id, "version": "0.1.0", "title": title, "source": "plugin", "plugin": plugin });
    let mut today = summary("example.today", "Today", "example.today");
    today["description"] = json!("What is on today.");
    let file = json!({
        "id": "example.notes", "version": "0.1.0", "title": "Notes",
        "description": "The notes touched this week.", "source": "file",
    });
    let expected = json!([
        summary("example.board", "Board", "example.boards"),
        file,
        today,
        summary("example.week", "Week", "example.boards"),
    ]);
    assert_eq!(list(&desk), expected);
}

#[test]
fn view_get_answers_a_plugin_view_whole_with_its_source() {
    let (desk, plugins) = desk("plugin-views-get");
    desk.core.install_plugin(&today_plugin(&plugins), false);
    desk.core.install_plugin(&boards_plugin(&plugins), false);
    write_file(&desk, &notes());
    let from =
        |view: Value, plugin: &str| json!({ "view": view, "source": "plugin", "plugin": plugin });
    assert_eq!(
        get(&desk, "example.today").unwrap(),
        from(today(), "example.today")
    );
    let board = from(view("example.board", "Board"), "example.boards");
    assert_eq!(get(&desk, "example.board").unwrap(), board);
    let week = from(view("example.week", "Week"), "example.boards");
    assert_eq!(get(&desk, "example.week").unwrap(), week);
    let notes = json!({ "view": notes(), "source": "file" });
    assert_eq!(get(&desk, "example.notes").unwrap(), notes);
    assert_eq!(
        get(&desk, "example.nobody").unwrap_err().code,
        ErrorCode::NotFound
    );
}

#[test]
fn a_persons_file_shadows_a_plugin_view_of_the_same_id() {
    let (desk, plugins) = desk("plugin-views-shadow");
    let mut mine = today();
    mine["title"] = json!("My today");
    write_file(&desk, &mine);
    desk.core.install_plugin(&today_plugin(&plugins), false);
    assert_eq!(changed(&desk), [], "a shadowed id is not announced");
    let summary = json!({
        "id": "example.today", "version": "0.1.0", "title": "My today",
        "description": "What is on today.", "source": "file",
    });
    assert_eq!(list(&desk), json!([summary]));
    let answer = json!({ "view": mine, "source": "file" });
    assert_eq!(get(&desk, "example.today").unwrap(), answer);

    mine["title"] = json!("My today, again");
    call(&desk, "view.save", json!({ "view": mine })).unwrap();
    let text = fs::read_to_string(file(&desk, "example.today")).unwrap();
    assert_eq!(yaml_serde::from_str::<Value>(&text).unwrap(), mine);
    changed(&desk);

    call(&desk, "view.remove", json!({ "id": "example.today" })).unwrap();
    assert!(!file(&desk, "example.today").exists());
    let plugin = json!({ "view": today(), "source": "plugin", "plugin": "example.today" });
    assert_eq!(get(&desk, "example.today").unwrap(), plugin);
    assert_eq!(changed(&desk), to_desk(&[("example.today", "saved")]));
}

#[test]
fn view_save_of_a_plugin_owned_id_without_a_file_is_invalid_params_naming_the_plugin() {
    let (desk, plugins) = desk("plugin-views-save");
    desk.core.install_plugin(&boards_plugin(&plugins), false);
    changed(&desk);
    let error = call(
        &desk,
        "view.save",
        json!({ "view": view("example.board", "Mine") }),
    );
    let error = error.unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidParams, "{}", error.message);
    assert!(
        error.message.contains("owned by plugin example.boards"),
        "{}",
        error.message
    );
    let folder = desk.home.join(".desk/views");
    assert_eq!(
        fs::read_dir(folder).map(|d| d.count()).unwrap_or(0),
        0,
        "nothing is written"
    );
    assert_eq!(changed(&desk), []);
    let got = get(&desk, "example.board").unwrap();
    assert_eq!(got["view"], view("example.board", "Board"));
    assert_eq!(got["source"], "plugin");
}

#[test]
fn view_remove_of_a_plugin_view_is_invalid_params() {
    let (desk, plugins) = desk("plugin-views-remove");
    desk.core.install_plugin(&today_plugin(&plugins), false);
    changed(&desk);
    let error = call(&desk, "view.remove", json!({ "id": "example.today" })).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidParams, "{}", error.message);
    assert!(
        error.message.contains("plugin example.today"),
        "{}",
        error.message
    );
    assert_eq!(ids(&desk), ["example.today"]);
    assert_eq!(changed(&desk), []);
    let nobody = call(&desk, "view.remove", json!({ "id": "example.nobody" }));
    assert_eq!(nobody.unwrap_err().code, ErrorCode::NotFound);
}

#[test]
fn disabling_a_view_plugin_removes_its_views_and_enabling_brings_them_back() {
    let (desk, plugins) = desk("plugin-views-toggle");
    desk.core.install_plugin(&boards_plugin(&plugins), false);
    changed(&desk);

    set_enabled(&desk, "example.boards", false);
    assert_eq!(ids(&desk), Vec::<String>::new());
    for id in ["example.board", "example.week"] {
        assert_eq!(
            get(&desk, id).unwrap_err().code,
            ErrorCode::NotFound,
            "{id}"
        );
    }
    let removed = [("example.board", "removed"), ("example.week", "removed")];
    assert_eq!(changed(&desk), to_desk(&removed));

    set_enabled(&desk, "example.boards", true);
    assert_eq!(ids(&desk), ["example.board", "example.week"]);
    let saved = [("example.board", "saved"), ("example.week", "saved")];
    assert_eq!(changed(&desk), to_desk(&saved));
}

#[test]
fn installing_or_reloading_a_view_plugin_announces_its_views() {
    let (desk, plugins) = desk("plugin-views-reload");
    let dir = boards_plugin(&plugins);
    fs::write(
        dir.join("views/month.yaml"),
        yaml(&view("example.month", "Month")),
    )
    .unwrap();
    desk.core.install_plugin(&dir, false);
    let saved = [("example.board", "saved"), ("example.week", "saved")];
    assert_eq!(changed(&desk), to_desk(&saved));

    let _watcher = desk
        .core
        .watch_plugins()
        .expect("the plugin watcher starts");
    std::thread::sleep(Duration::from_millis(200));
    let views = json!(["views/board.yaml", "views/month.yaml"]);
    let manifest =
        json!({ "id": "example.boards", "version": "0.1.0", "kind": "view", "views": views });
    rewrite_manifest(&dir, &manifest.to_string());
    let reloaded = [
        ("example.board", "saved"),
        ("example.month", "saved"),
        ("example.week", "removed"),
    ];
    assert_eq!(next_changes(&desk, 3), set(&reloaded));
    assert_eq!(ids(&desk), ["example.board", "example.month"]);

    rewrite_manifest(&dir, "{ \"id\": \"example.boards\", ");
    let failed = [("example.board", "removed"), ("example.month", "removed")];
    assert_eq!(next_changes(&desk, 2), set(&failed));
    assert_eq!(ids(&desk), Vec::<String>::new());
}

#[test]
fn an_invalid_plugin_view_is_reported_and_left_out_and_the_desk_keeps_going() {
    let (desk, plugins) = desk("plugin-views-invalid");
    let mut unresolved = view("example.unresolved", "Unresolved");
    unresolved["layout"]["binding"]["sources"] = json!(["$calendar", "$mail"]);
    let paths = [
        "views/board.yaml",
        "views/broken.yaml",
        "views/unresolved.json",
        "views/missing.yaml",
    ];
    let files = [
        ("views/board.yaml", yaml(&view("example.board", "Board"))),
        ("views/broken.yaml", "title: [unclosed\n  : :".to_owned()),
        ("views/unresolved.json", unresolved.to_string()),
    ];
    let boards = plugin(
        &plugins,
        "example.boards",
        json!({ "views": paths }),
        &files,
    );
    desk.core.install_plugin(&boards, false);
    let loose = view("example.loose", "Last {params.days} days");
    desk.core.install_plugin(
        &plugin(&plugins, "example.loose", json!({ "view": loose }), &[]),
        false,
    );

    assert_eq!(ids(&desk), ["example.board"]);
    let problems = desk.core.view_problems();
    assert_eq!(problems.len(), 4, "{problems:?}");
    let named = |plugin: &str, path: &str| {
        let found = problems
            .iter()
            .any(|p| p.contains(plugin) && p.contains(path));
        assert!(found, "no problem names {plugin} and {path}: {problems:?}");
    };
    for path in &paths[1..] {
        named("example.boards", path);
    }
    named("example.loose", "plugin.json");
    let scope = json!({ "permission": "plugin:manage" });
    let listed = desk.ok("desk", "plugin.list", json!({ "scope": scope }));
    let statuses: Vec<(&str, &str)> = listed["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["id"].as_str().unwrap(), p["status"].as_str().unwrap()))
        .collect();
    assert_eq!(
        statuses,
        [("example.boards", "ready"), ("example.loose", "ready")]
    );
    assert_eq!(
        get(&desk, "example.board").unwrap()["view"],
        view("example.board", "Board")
    );
}

#[test]
fn two_plugins_with_one_view_id_list_the_first_and_report_the_other() {
    let (desk, plugins) = desk("plugin-views-twice");
    for (id, title) in [
        ("example.board-a", "Board A"),
        ("example.board-b", "Board B"),
    ] {
        let fields = json!({ "view": view("example.board", title) });
        desk.core
            .install_plugin(&plugin(&plugins, id, fields, &[]), false);
    }
    let listed = list(&desk);
    assert_eq!(listed.as_array().unwrap().len(), 1, "{listed}");
    assert_eq!(listed[0]["plugin"], "example.board-a");
    let problems = desk.core.view_problems();
    assert_eq!(problems.len(), 1, "{problems:?}");
    for name in ["example.board-b", "example.board", "example.board-a"] {
        assert!(problems[0].contains(name), "{name}: {problems:?}");
    }
    changed(&desk);

    set_enabled(&desk, "example.board-a", false);
    let b = json!({ "view": view("example.board", "Board B"), "source": "plugin", "plugin": "example.board-b" });
    assert_eq!(get(&desk, "example.board").unwrap(), b);
    assert_eq!(changed(&desk), to_desk(&[("example.board", "saved")]));
}

#[test]
fn the_built_in_plugins_list_desk_today_and_desk_item() {
    let desk = Desk::new("plugin-views-built-in", None);
    desk.grant("desk", view_manage());
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    desk.core.install_plugins_in(&repo, true);
    let listed = list(&desk);
    let found: Vec<(&str, &str, &str)> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|v| {
            (
                v["id"].as_str().unwrap(),
                v["source"].as_str().unwrap(),
                v["plugin"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        found,
        [
            ("desk.item", "plugin", "desk.item"),
            ("desk.today", "plugin", "desk.today")
        ]
    );
    let text = fs::read_to_string(repo.join("today/plugin.json")).unwrap();
    let manifest: Value = serde_json::from_str(&text).unwrap();
    let answer = json!({ "view": manifest["view"], "source": "plugin", "plugin": "desk.today" });
    assert_eq!(get(&desk, "desk.today").unwrap(), answer);
    assert_eq!(desk.core.view_problems(), Vec::<String>::new());
}
