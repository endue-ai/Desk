//! dialog.* through `Core::handle` (#308): the shell shows the OS's own open and save dialogs, and
//! what the person chose is granted to the caller for the matching fs access and nothing else, as
//! a session grant like any other. Cancelling grants nothing; a desk without dialogs answers
//! `unsupported`; an agent cannot open one.

mod support;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use desk_bridge::{DialogOpenParams, DialogSaveParams, ErrorCode};
use desk_core::{Core, DialogError, Dialogs};
use serde_json::{Value, json};
use support::{NOTES, call, grant, home, manage, roots};

/// A shell whose person answers with `chosen` (none: cancels) and that records what it was asked.
#[derive(Default)]
struct Person {
    chosen: Mutex<Option<Vec<PathBuf>>>,
    asked: Mutex<Vec<String>>,
}

impl Person {
    fn choose(&self, paths: &[PathBuf]) {
        *self.chosen.lock().unwrap() = Some(paths.to_vec());
    }

    fn cancel(&self) {
        *self.chosen.lock().unwrap() = None;
    }

    fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }
}

impl Dialogs for Person {
    fn open(&self, params: &DialogOpenParams) -> Result<Option<Vec<PathBuf>>, DialogError> {
        self.asked.lock().unwrap().push(format!("open {params:?}"));
        Ok(self.chosen.lock().unwrap().clone())
    }

    fn save(&self, params: &DialogSaveParams) -> Result<Option<PathBuf>, DialogError> {
        self.asked.lock().unwrap().push(format!("save {params:?}"));
        Ok(self.chosen.lock().unwrap().clone().and_then(|p| p.into_iter().next()))
    }
}

fn desk(tag: &str) -> (Core, Arc<Person>, PathBuf) {
    let home = home(tag);
    let core = Core::new(roots(&home));
    let person = Arc::new(Person::default());
    core.set_dialogs(Some(person.clone()));
    (core, person, home)
}

fn slashed(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn read(core: &Core, caller: &str, path: &Path) -> Result<Value, desk_bridge::BridgeError> {
    let path = slashed(path);
    let scope = json!({ "permission": "fs:read", "paths": [path] });
    call(core, caller, "fs.read", json!({ "path": path, "scope": scope }))
}

fn write(core: &Core, caller: &str, path: &Path) -> Result<Value, desk_bridge::BridgeError> {
    let path = slashed(path);
    let scope = json!({ "permission": "fs:write", "paths": [path] });
    let params = json!({ "path": path, "content": "# Saved", "scope": scope });
    call(core, caller, "fs.write", params)
}

fn denied(result: Result<Value, desk_bridge::BridgeError>) {
    let error = result.unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied, "{error:?}");
}

#[test]
fn open_grants_the_chosen_files_to_read_and_nothing_else() {
    let (core, person, home) = desk("dialog-open");
    let (hello, today) = (home.join("Documents/hello.md"), home.join("Calendar/today.ics"));
    std::fs::write(home.join("Documents/sibling.md"), "# Not chosen").unwrap();
    denied(read(&core, NOTES, &hello));
    person.choose(&[hello.clone(), today.clone()]);
    let params = json!({ "multiple": true, "filters": [{ "name": "Notes", "extensions": ["md", "ics"] }] });
    let answer = call(&core, NOTES, "dialog.open", params).unwrap();
    assert_eq!(answer, json!({ "cancelled": false, "paths": [slashed(&hello), slashed(&today)] }));
    assert_eq!(person.asked().len(), 1);
    assert_eq!(read(&core, NOTES, &hello).unwrap()["content"], "# Hello");
    assert!(read(&core, NOTES, &today).is_ok());
    denied(read(&core, NOTES, &home.join("Documents/sibling.md")));
    denied(write(&core, NOTES, &hello));
    denied(write(&core, NOTES, &today));
}

#[test]
fn open_of_a_folder_grants_what_lies_inside() {
    let (core, person, home) = desk("dialog-folder");
    let folder = home.join("Documents");
    person.choose(std::slice::from_ref(&folder));
    let answer = call(&core, NOTES, "dialog.open", json!({ "kind": "folders" })).unwrap();
    assert_eq!(answer["paths"], json!([slashed(&folder)]));
    assert!(read(&core, NOTES, &folder.join("hello.md")).is_ok());
    let inside = slashed(&folder.join("**"));
    let list = json!({ "path": slashed(&folder), "scope": { "permission": "fs:read", "paths": [slashed(&folder)] } });
    assert!(call(&core, NOTES, "fs.list", list).is_ok(), "the folder itself");
    let deep = json!({ "permission": "fs:read", "paths": [inside] });
    let path = slashed(&folder.join("hello.md"));
    assert!(call(&core, NOTES, "fs.read", json!({ "path": path, "scope": deep })).is_ok());
    denied(read(&core, NOTES, &home.join("Calendar/today.ics")));
    denied(write(&core, NOTES, &folder.join("new.md")));
}

#[test]
fn save_grants_the_chosen_path_to_write() {
    let (core, person, home) = desk("dialog-save");
    let place = home.join("Documents/saved.md");
    person.choose(std::slice::from_ref(&place));
    let params = json!({ "suggestedName": "saved.md", "startIn": slashed(&home.join("Documents")) });
    let answer = call(&core, NOTES, "dialog.save", params).unwrap();
    assert_eq!(answer, json!({ "cancelled": false, "path": slashed(&place) }));
    write(&core, NOTES, &place).unwrap();
    assert_eq!(std::fs::read_to_string(&place).unwrap(), "# Saved");
    assert_eq!(read(&core, NOTES, &place).unwrap()["content"], "# Saved");
    denied(write(&core, NOTES, &home.join("Documents/other.md")));
    denied(read(&core, NOTES, &home.join("Documents/hello.md")));
}

#[test]
fn a_cancelled_dialog_grants_nothing() {
    let (core, person, home) = desk("dialog-cancel");
    let manager = "desk";
    grant(&core, manager, manage());
    person.cancel();
    let opened = call(&core, NOTES, "dialog.open", json!({})).unwrap();
    assert_eq!(opened, json!({ "cancelled": true, "paths": [] }));
    let saved = call(&core, NOTES, "dialog.save", json!({})).unwrap();
    assert_eq!(saved, json!({ "cancelled": true }));
    let list = json!({ "caller": NOTES, "scope": manage() });
    let grants = call(&core, manager, "perm.list", list).unwrap();
    assert_eq!(grants["grants"], json!([]), "{grants}");
    denied(read(&core, NOTES, &home.join("Documents/hello.md")));
}

#[test]
fn a_dialog_grant_is_the_callers_and_for_the_session() {
    let (core, person, home) = desk("dialog-session");
    let manager = "desk";
    grant(&core, manager, manage());
    let hello = home.join("Documents/hello.md");
    person.choose(std::slice::from_ref(&hello));
    call(&core, NOTES, "dialog.open", json!({})).unwrap();
    let list = json!({ "caller": NOTES, "scope": manage() });
    let grants = call(&core, manager, "perm.list", list).unwrap()["grants"].clone();
    let grants = grants.as_array().unwrap();
    assert_eq!(grants.len(), 1, "{grants:?}");
    let held = &grants[0];
    let grant = held.get("grant").unwrap_or(held);
    assert_eq!(grant["duration"], "session");
    assert_eq!(
        grant["permission"],
        json!({ "permission": "fs:read", "paths": [slashed(&hello)] })
    );
    denied(read(&core, "example.calendar", &hello));
    let id = grant["grantId"].clone();
    call(&core, NOTES, "perm.revoke", json!({ "grantId": id })).unwrap();
    denied(read(&core, NOTES, &hello));
}

#[test]
fn without_a_shell_dialogs_are_unsupported() {
    let core = Core::new(roots(&home("dialog-none")));
    for method in ["dialog.open", "dialog.save"] {
        let error = call(&core, NOTES, method, json!({})).unwrap_err();
        assert_eq!(error.code, ErrorCode::Unsupported, "{method}: {error:?}");
    }
}

#[test]
fn an_agent_cannot_open_a_dialog() {
    let (core, person, home) = desk("dialog-agent");
    person.choose(&[home.join("Documents/hello.md")]);
    for method in ["dialog.open", "dialog.save"] {
        let error = call(&core, "agent:mira", method, json!({})).unwrap_err();
        assert_eq!(error.code, ErrorCode::PermissionDenied, "{method}: {error:?}");
    }
    assert!(person.asked().is_empty());
}
