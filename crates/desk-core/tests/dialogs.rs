//! dialog.* through `Core::handle` (#308): the shell shows the OS's own open and save dialogs, and
//! what the person chose is granted to the caller for the matching fs access and nothing else, as
//! a session grant like any other, in the desk's spelling (`~/…` under home). Cancelling grants
//! nothing; a desk without dialogs answers `unsupported`; only the desk and installed plugins ask;
//! a path the OS named differently from how a grant would read it is never granted.

mod support;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use desk_bridge::{DialogOpenParams, DialogSaveParams, ErrorCode};
use desk_core::{Asker, Core, DialogError, Dialogs};
use serde_json::{Value, json};
use support::{call, grant, home, install_hello, install_hello_declaring, manage, roots};

/// The installed plugin that asks.
const NOTES: &str = "example.hello";

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
    fn open(
        &self,
        asker: &Asker,
        params: &DialogOpenParams,
    ) -> Result<Option<Vec<PathBuf>>, DialogError> {
        self.asked
            .lock()
            .unwrap()
            .push(format!("open {} {params:?}", asker.name));
        Ok(self.chosen.lock().unwrap().clone())
    }

    fn save(
        &self,
        asker: &Asker,
        params: &DialogSaveParams,
    ) -> Result<Option<PathBuf>, DialogError> {
        self.asked
            .lock()
            .unwrap()
            .push(format!("save {} {params:?}", asker.name));
        Ok(self
            .chosen
            .lock()
            .unwrap()
            .clone()
            .and_then(|p| p.into_iter().next()))
    }
}

fn desk(tag: &str) -> (Core, Arc<Person>, PathBuf) {
    let home = home(tag);
    let core = Core::new(roots(&home));
    // It may be granted whatever the person picks, anywhere (ADR 0260).
    let anywhere = json!([{ "permission": "fs:read", "paths": ["/**"] },
        { "permission": "fs:write", "paths": ["/**"] }]);
    install_hello_declaring(&core, &home, anywhere);
    let person = Arc::new(Person::default());
    core.set_dialogs(Some(person.clone()));
    (core, person, home)
}

fn read(core: &Core, caller: &str, path: &str) -> Result<Value, desk_bridge::BridgeError> {
    let scope = json!({ "permission": "fs:read", "paths": [path] });
    call(
        core,
        caller,
        "fs.read",
        json!({ "path": path, "scope": scope }),
    )
}

fn write(core: &Core, caller: &str, path: &str) -> Result<Value, desk_bridge::BridgeError> {
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
    std::fs::write(home.join("Documents/sibling.md"), "# Not chosen").unwrap();
    denied(read(&core, NOTES, "~/Documents/hello.md"));
    person.choose(&[
        home.join("Documents/hello.md"),
        home.join("Calendar/today.ics"),
    ]);
    let params =
        json!({ "multiple": true, "filters": [{ "name": "Notes", "extensions": ["md", "ics"] }] });
    let answer = call(&core, NOTES, "dialog.open", params).unwrap();
    let paths = ["~/Documents/hello.md", "~/Calendar/today.ics"];
    assert_eq!(answer, json!({ "cancelled": false, "paths": paths }));
    assert_eq!(person.asked().len(), 1);
    assert!(
        person.asked()[0].starts_with("open example.hello "),
        "{:?}",
        person.asked()
    );
    assert_eq!(read(&core, NOTES, paths[0]).unwrap()["content"], "# Hello");
    assert!(read(&core, NOTES, paths[1]).is_ok());
    denied(read(&core, NOTES, "~/Documents/sibling.md"));
    denied(write(&core, NOTES, paths[0]));
    denied(write(&core, NOTES, paths[1]));
}

#[test]
fn open_of_a_folder_grants_what_lies_inside() {
    let (core, person, home) = desk("dialog-folder");
    person.choose(&[home.join("Documents")]);
    let answer = call(&core, NOTES, "dialog.open", json!({ "kind": "folders" })).unwrap();
    assert_eq!(answer["paths"], json!(["~/Documents"]));
    assert!(read(&core, NOTES, "~/Documents/hello.md").is_ok());
    let folder = json!({ "permission": "fs:read", "paths": ["~/Documents"] });
    let list = json!({ "path": "~/Documents", "scope": folder });
    assert!(
        call(&core, NOTES, "fs.list", list).is_ok(),
        "the folder itself"
    );
    let deep = json!({ "permission": "fs:read", "paths": ["~/Documents/**"] });
    let inside = json!({ "path": "~/Documents/hello.md", "scope": deep });
    assert!(call(&core, NOTES, "fs.read", inside).is_ok());
    denied(read(&core, NOTES, "~/Calendar/today.ics"));
    denied(write(&core, NOTES, "~/Documents/new.md"));
}

#[test]
fn save_grants_the_chosen_path_to_write() {
    let (core, person, home) = desk("dialog-save");
    person.choose(&[home.join("Documents/saved.md")]);
    let params = json!({ "suggestedName": "saved.md", "startIn": "~/Documents" });
    let answer = call(&core, NOTES, "dialog.save", params).unwrap();
    assert_eq!(
        answer,
        json!({ "cancelled": false, "path": "~/Documents/saved.md" })
    );
    write(&core, NOTES, "~/Documents/saved.md").unwrap();
    assert_eq!(
        std::fs::read_to_string(home.join("Documents/saved.md")).unwrap(),
        "# Saved"
    );
    assert_eq!(
        read(&core, NOTES, "~/Documents/saved.md").unwrap()["content"],
        "# Saved"
    );
    denied(write(&core, NOTES, "~/Documents/other.md"));
    denied(read(&core, NOTES, "~/Documents/hello.md"));
}

#[test]
fn a_path_outside_home_is_answered_as_the_os_named_it() {
    let (core, person, _home) = desk("dialog-outside");
    let outside = std::env::temp_dir().join(format!("desk-dialog-out-{}.md", std::process::id()));
    std::fs::write(&outside, "# Out").unwrap();
    person.choose(std::slice::from_ref(&outside));
    let answer = call(&core, NOTES, "dialog.open", json!({})).unwrap();
    let path = outside.to_str().unwrap().replace('\\', "/");
    assert_eq!(answer["paths"], json!([path]));
    assert_eq!(read(&core, NOTES, &path).unwrap()["content"], "# Out");
}

/// Paths a grant would read otherwise than the OS named them are left out, so nothing is granted.
#[test]
fn a_path_a_grant_would_misread_is_never_granted() {
    let (core, person, home) = desk("dialog-misread");
    let mut odd = vec![
        home.join("x/../Documents/hello.md"),
        home.join("./Documents/hello.md"),
        home.join("Documents//hello.md"),
        home.join("Documents/*.md"),
        home.join("Documents/a?.md"),
        PathBuf::from("Documents/hello.md"),
    ];
    if !cfg!(windows) {
        // `\` is a name character here: `x\..\..\.ssh\id` is one file, not `~/.ssh/id`.
        odd.push(home.join("MyPlugin/x\\..\\..\\.ssh\\id_ed25519"));
        odd.push(home.join("a\\.."));
        odd.push(home.join("Q1\\Q2.md"));
        odd.push(PathBuf::from("//server/share/a.md"));
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let bytes = [home.as_os_str().as_bytes(), b"/Documents/\xff.md"].concat();
            odd.push(PathBuf::from(std::ffi::OsStr::from_bytes(&bytes)));
        }
    }
    for path in odd {
        person.choose(std::slice::from_ref(&path));
        let opened = call(&core, NOTES, "dialog.open", json!({ "kind": "folders" })).unwrap();
        assert_eq!(
            opened,
            json!({ "cancelled": true, "paths": [] }),
            "{}",
            path.display()
        );
        let saved = call(&core, NOTES, "dialog.save", json!({})).unwrap();
        assert_eq!(saved, json!({ "cancelled": true }), "{}", path.display());
    }
    let list = json!({ "caller": NOTES, "scope": manage() });
    grant(&core, "desk", manage());
    assert_eq!(
        call(&core, "desk", "perm.list", list).unwrap()["grants"],
        json!([])
    );
    denied(read(&core, NOTES, "~/Documents/hello.md"));
}

#[test]
fn a_cancelled_dialog_grants_nothing() {
    let (core, person, _home) = desk("dialog-cancel");
    grant(&core, "desk", manage());
    person.cancel();
    let opened = call(&core, NOTES, "dialog.open", json!({})).unwrap();
    assert_eq!(opened, json!({ "cancelled": true, "paths": [] }));
    let saved = call(&core, NOTES, "dialog.save", json!({})).unwrap();
    assert_eq!(saved, json!({ "cancelled": true }));
    let list = json!({ "caller": NOTES, "scope": manage() });
    let grants = call(&core, "desk", "perm.list", list).unwrap();
    assert_eq!(grants["grants"], json!([]), "{grants}");
    denied(read(&core, NOTES, "~/Documents/hello.md"));
}

#[test]
fn a_dialog_grant_is_the_callers_and_for_the_session() {
    let (core, person, home) = desk("dialog-session");
    grant(&core, "desk", manage());
    person.choose(&[home.join("Documents/hello.md")]);
    call(&core, NOTES, "dialog.open", json!({})).unwrap();
    let list = json!({ "caller": NOTES, "scope": manage() });
    let grants = call(&core, "desk", "perm.list", list).unwrap()["grants"].clone();
    let grants = grants.as_array().unwrap();
    assert_eq!(grants.len(), 1, "{grants:?}");
    let grant = &grants[0]["grant"];
    assert_eq!(grant["duration"], "session");
    assert_eq!(
        grant["permission"],
        json!({ "permission": "fs:read", "paths": ["~/Documents/hello.md"] })
    );
    denied(read(&core, "example.calendar", "~/Documents/hello.md"));
    let id = grant["grantId"].clone();
    call(&core, NOTES, "perm.revoke", json!({ "grantId": id })).unwrap();
    denied(read(&core, NOTES, "~/Documents/hello.md"));
}

#[test]
fn without_a_shell_dialogs_are_unsupported() {
    let home = home("dialog-none");
    let core = Core::new(roots(&home));
    install_hello(&core, &home);
    for method in ["dialog.open", "dialog.save"] {
        let error = call(&core, NOTES, method, json!({})).unwrap_err();
        assert_eq!(error.code, ErrorCode::Unsupported, "{method}: {error:?}");
    }
}

/// Only the desk's page and installed plugins ask the person: not an agent, an MCP server, the
/// CLI, the palette or a caller no plugin is.
#[test]
fn only_the_desk_and_plugins_can_open_a_dialog() {
    let (core, person, home) = desk("dialog-callers");
    person.choose(&[home.join("Documents/hello.md")]);
    for caller in [
        "agent:mira",
        "mcp:files",
        "cli",
        "palette",
        "example.notinstalled",
    ] {
        for method in ["dialog.open", "dialog.save"] {
            let error = call(&core, caller, method, json!({})).unwrap_err();
            assert_eq!(
                error.code,
                ErrorCode::PermissionDenied,
                "{caller} {method}: {error:?}"
            );
        }
    }
    assert!(person.asked().is_empty());
    let answer = call(&core, "desk", "dialog.open", json!({})).unwrap();
    assert_eq!(answer["paths"], json!(["~/Documents/hello.md"]));
    assert!(
        person.asked()[0].starts_with("open endue "),
        "{:?}",
        person.asked()
    );
}

#[test]
fn the_home_folder_itself_is_answered_as_tilde() {
    let (core, person, home) = desk("dialog-home");
    person.choose(std::slice::from_ref(&home));
    let answer = call(&core, NOTES, "dialog.open", json!({ "kind": "folders" })).unwrap();
    assert_eq!(answer["paths"], json!(["~"]));
    assert!(read(&core, NOTES, "~/Documents/hello.md").is_ok());
    let saved = call(&core, NOTES, "dialog.save", json!({})).unwrap();
    assert_eq!(saved, json!({ "cancelled": false, "path": "~" }));
}

/// A plugin that names itself as the desk still asks under its id.
#[test]
fn a_plugins_dialog_names_its_id_beside_its_name() {
    let (core, person, home) = desk("dialog-name");
    let dir = home.join("plugins/impostor");
    std::fs::create_dir_all(dir.join("ui")).unwrap();
    std::fs::write(dir.join("ui/index.html"), "<p>hi</p>").unwrap();
    let manifest = r#"{ "id": "example.impostor", "name": "endue", "version": "0.1.0",
        "kind": "ui", "entry": "ui/index.html" }"#;
    std::fs::write(dir.join("plugin.json"), manifest).unwrap();
    core.install_plugin(&dir, false);
    person.cancel();
    call(&core, "example.impostor", "dialog.open", json!({})).unwrap();
    call(&core, NOTES, "dialog.save", json!({})).unwrap();
    let asked = person.asked();
    assert!(
        asked[0].starts_with("open endue (example.impostor) "),
        "{asked:?}"
    );
    assert!(asked[1].starts_with("save example.hello "), "{asked:?}");
}
