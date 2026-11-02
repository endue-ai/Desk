//! One rule for every state file the desk owns (ADR 0061): a file that cannot be read as what it
//! should hold starts empty, is kept beside itself as `<name>.broken`, and is reported once, so the
//! runtime can name it. A missing file is not broken. The next write never touches the `.broken` copy.

mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;

use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, BrokenFile, Core, MockRemote};
use serde_json::json;
use support::{call, home, roots};

const GARBAGE: &str = "{";

/// A core with every state file of the data folder under `home/data`.
fn core_on(home: &Path) -> Core {
    let data = home.join("data");
    let brain = Arc::new(HttpBrain::new("http://127.0.0.1:9/v0").unwrap());
    let options = BrainOptions {
        state_file: Some(data.join("brain.json")),
        ..BrainOptions::default()
    };
    Core::new(roots(home))
        .with_store_file(data.join("store.json"))
        .with_settings_file(data.join("settings.json"))
        .with_grant_file(data.join("grants.json"))
        .with_plugin_store(data.join("plugins.json"))
        .with_secrets_file(data.join("secrets.json"))
        .with_sync(Arc::new(MockRemote::new()), Some(data.join("sync.json")))
        .with_brain(brain, options)
}

const FILES: [&str; 7] = [
    "store.json",
    "settings.json",
    "grants.json",
    "plugins.json",
    "secrets.json",
    "sync.json",
    "brain.json",
];

fn names(broken: &[BrokenFile]) -> Vec<String> {
    let mut names: Vec<String> = broken.iter().map(|file| file.name.clone()).collect();
    names.sort();
    names
}

#[test]
fn each_unreadable_state_file_starts_empty_and_is_kept_broken() {
    let home = home("state-broken");
    let data = home.join("data");
    fs::create_dir_all(&data).unwrap();
    for name in FILES {
        fs::write(data.join(name), GARBAGE).unwrap();
    }

    let core = core_on(&home);

    let broken = core.broken_files();
    let mut expected: Vec<String> = FILES.iter().map(|name| (*name).to_owned()).collect();
    expected.sort();
    assert_eq!(names(&broken), expected, "each file is named once");
    for file in &broken {
        let kept = data.join(format!("{}.broken", file.name));
        assert_eq!(file.kept, kept, "{} is kept beside itself", file.name);
        assert_eq!(fs::read_to_string(&kept).unwrap(), GARBAGE);
    }

    // Each starts empty: the store and the settings hold nothing, and the person's own state works.
    let got = call(&core, "example.notes", "store.get", json!({ "key": "draft" })).unwrap();
    assert_eq!(got, json!({}));
    call(
        &core,
        "example.notes",
        "store.set",
        json!({ "key": "draft", "value": 1 }),
    )
    .unwrap();
    let stored: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(data.join("store.json")).unwrap()).unwrap();
    assert_eq!(stored["example.notes"]["draft"], 1, "the next write starts afresh");
    assert_eq!(
        fs::read_to_string(data.join("store.json.broken")).unwrap(),
        GARBAGE,
        "the next write leaves the broken copy alone"
    );

    // Reported once: asking again names the same files, and a restart on good files names none.
    assert_eq!(names(&core.broken_files()), expected);
    drop(core);
    let again = core_on(&home);
    let left: Vec<String> = names(&again.broken_files());
    assert!(
        !left.contains(&"store.json".to_owned()),
        "a readable store is not broken: {left:?}"
    );
}

#[test]
fn a_missing_or_readable_state_file_is_not_broken() {
    let home = home("state-fine");
    let data = home.join("data");
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join("store.json"), r#"{ "example.notes": { "draft": 2 } }"#).unwrap();
    fs::write(data.join("plugins.json"), r#"{ "enabled": { "example.notes": false } }"#).unwrap();

    let core = core_on(&home);

    assert!(core.broken_files().is_empty(), "{:?}", core.broken_files());
    let got = call(&core, "example.notes", "store.get", json!({ "key": "draft" })).unwrap();
    assert_eq!(got, json!({ "value": 2 }));
    for name in FILES {
        assert!(!data.join(format!("{name}.broken")).exists(), "{name}");
    }
}

#[test]
fn an_unreadable_item_index_is_kept_broken_and_opened_fresh() {
    let home = home("state-index");
    let data = home.join("data");
    fs::create_dir_all(&data).unwrap();
    let garbage = "this is not a SQLite database at all, just text";
    fs::write(data.join("index.sqlite"), garbage).unwrap();

    let core = Core::new(roots(&home)).with_index_file(data.join("index.sqlite"));

    assert_eq!(names(&core.broken_files()), vec!["index.sqlite".to_owned()]);
    assert_eq!(
        fs::read_to_string(data.join("index.sqlite.broken")).unwrap(),
        garbage
    );
    assert!(core.index_problem().is_none(), "a fresh index opened");
    let scope = json!({ "permission": "data:read", "kinds": ["task"] });
    support::grant(&core, "example.notes", scope.clone());
    let query = json!({ "kinds": ["task"] });
    let page = call(
        &core,
        "example.notes",
        "data.query",
        json!({ "query": query, "scope": scope }),
    )
    .unwrap();
    assert_eq!(page["items"], json!([]), "data.* answers from the empty index");
}

#[test]
fn an_unparseable_view_file_is_kept_broken_at_start() {
    let home = home("state-views");
    let views = home.join(".desk/views");
    fs::create_dir_all(&views).unwrap();
    fs::write(views.join("torn.yaml"), "id: torn\nlayout: [unclosed\n").unwrap();
    // Parses, but is not a view: a view problem, and the person's file stays where it is.
    fs::write(views.join("odd.yaml"), "id: odd\nnot_a_view_field: true\n").unwrap();

    let core = Core::new(roots(&home));
    let kept = core.keep_broken_views();

    assert_eq!(names(&kept), vec!["torn.yaml".to_owned()]);
    assert_eq!(names(&core.broken_files()), vec!["torn.yaml".to_owned()]);
    assert!(views.join("torn.yaml.broken").exists());
    assert!(!views.join("torn.yaml").exists());
    assert!(views.join("odd.yaml").exists(), "a schema problem keeps its file");
    assert!(
        core.view_problems().iter().any(|p| p.contains("odd.yaml")),
        "{:?}",
        core.view_problems()
    );
}
