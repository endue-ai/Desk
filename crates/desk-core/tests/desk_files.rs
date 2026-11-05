//! The desk's files (#288, ADR 0079): each file of `~/.desk` is judged by its spec (init.yaml,
//! profiles, keys.yaml by specs/init/v0, views as the core reads them, in either language), problems
//! naming the line; plugins.lock waits for its schema (#287); the data folder's JSON parses.

use std::fs;
use std::path::PathBuf;

use desk_core::{FileState, Owner, desk_files};

fn folder(tag: &str) -> (PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("desk-files-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let (home, data) = (root.join("home"), root.join("data"));
    fs::create_dir_all(home.join(".desk/profiles")).unwrap();
    fs::create_dir_all(home.join(".desk/views")).unwrap();
    fs::create_dir_all(&data).unwrap();
    (home, data)
}

fn state_of(files: &[desk_core::DeskFile], end: &str) -> FileState {
    files
        .iter()
        .find(|f| f.path.to_string_lossy().replace('\\', "/").ends_with(end))
        .unwrap_or_else(|| panic!("no {end} in {files:?}"))
        .state
        .clone()
}

#[test]
fn each_desk_file_is_checked_against_its_schema() {
    let (home, data) = folder("schemas");
    let desk = home.join(".desk");
    fs::write(desk.join("init.yaml"), "profile: morning\n").unwrap();
    fs::write(
        desk.join("keys.yaml"),
        "bindings:\n  - key: Mod+K\n    command: desk.palette.open\n",
    )
    .unwrap();
    fs::write(
        desk.join("profiles/quiet.yaml"),
        "name: Quiet\nplugins:\n  enabled: [endue.notes]\n",
    )
    .unwrap();
    fs::write(
        desk.join("profiles/odd.yaml"),
        "name: Odd\nsurprise: true\n",
    )
    .unwrap();
    let view = "id: my.today\nversion: 0.1.0\ntitle: Today\nlayout:\n  type: list\n  binding:\n    kinds: [event]\n";
    fs::write(desk.join("views/my.today.yaml"), view).unwrap();
    fs::write(desk.join("views/my.misnamed.yaml"), view).unwrap();
    let board = "id: my.launch\ntype: kanban\nsource:\n  file: ~/boards/launch.yaml\n";
    fs::write(desk.join("views/my.launch.yaml"), board).unwrap();
    fs::write(desk.join("plugins.lock"), "plugins: []\n").unwrap();
    fs::write(data.join("store.json"), "{}").unwrap();
    fs::write(data.join("grants.json"), "{\n  \"grants\": [\n").unwrap();
    fs::create_dir_all(data.join("history")).unwrap();
    fs::write(data.join("history/a"), "12345").unwrap();

    let files = desk_files(&home, &data);
    assert_eq!(state_of(&files, ".desk/init.yaml"), FileState::Valid);
    assert_eq!(state_of(&files, ".desk/keys.yaml"), FileState::Valid);
    assert_eq!(state_of(&files, "profiles/quiet.yaml"), FileState::Valid);
    assert_eq!(state_of(&files, "views/my.today.yaml"), FileState::Valid);
    assert_eq!(
        state_of(&files, "views/my.launch.yaml"),
        FileState::Valid,
        "a universal view"
    );
    let FileState::Invalid(misnamed) = state_of(&files, "views/my.misnamed.yaml") else {
        panic!("my.misnamed.yaml is not invalid");
    };
    assert!(
        misnamed.contains("name the file my.today.yaml"),
        "{misnamed}"
    );
    let FileState::Invalid(odd) = state_of(&files, "profiles/odd.yaml") else {
        panic!("odd.yaml is not invalid");
    };
    assert!(odd.starts_with("line "), "{odd}");
    assert_eq!(state_of(&files, ".desk/plugins.lock"), FileState::Unchecked);
    assert_eq!(state_of(&files, "data/store.json"), FileState::Valid);
    let FileState::Invalid(grants) = state_of(&files, "data/grants.json") else {
        panic!("grants.json is not invalid");
    };
    assert!(grants.starts_with("line 3"), "{grants}");
    let history = files.iter().find(|f| f.path.ends_with("history")).unwrap();
    assert_eq!(
        (history.state.clone(), history.size, history.owner),
        (FileState::Unchecked, 5, Owner::Desk)
    );
    let lock = files
        .iter()
        .find(|f| f.path.ends_with("plugins.lock"))
        .unwrap();
    assert_eq!(lock.owner, Owner::Desk);
    let init = files
        .iter()
        .find(|f| f.path.ends_with("init.yaml"))
        .unwrap();
    assert_eq!((init.owner, init.size), (Owner::Person, 17));
}

#[test]
fn a_keys_file_problem_names_its_line() {
    let (home, data) = folder("keys-line");
    let keys = "bindings:\n  - key: Mod+K\n    command: desk.palette.open\n  - key: 12\n    command: x.y\n";
    fs::write(home.join(".desk/keys.yaml"), keys).unwrap();
    let files = desk_files(&home, &data);
    let FileState::Invalid(why) = state_of(&files, "keys.yaml") else {
        panic!("keys.yaml is not invalid");
    };
    assert!(why.starts_with("line 4: /bindings/1/key"), "{why}");
}
