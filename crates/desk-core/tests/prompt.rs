//! perm.request: who may ask, what the prompt shows, and when the person is not asked at all.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::{Core, Prompt, Prompter, RUNTIME_CALLER, Roots};
use serde_json::{Value, json};

/// Answers every prompt with `answer` and remembers what it was shown.
#[derive(Clone)]
struct Person {
    answer: bool,
    seen: Arc<Mutex<Vec<Prompt>>>,
}

impl Person {
    fn answering(answer: bool) -> Self {
        Self {
            answer,
            seen: Arc::default(),
        }
    }

    fn seen(&self) -> Vec<Prompt> {
        self.seen.lock().unwrap().clone()
    }
}

impl Prompter for Person {
    fn ask(&self, prompt: &Prompt) -> bool {
        self.seen.lock().unwrap().push(prompt.clone());
        self.answer
    }
}

fn temp_home() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-prompt-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// A plugin that declares fs:read on ~/Documents/** and nothing else.
fn install_notes(core: &Core, home: &Path) {
    let dir = home.join("plugins/notes");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>notes</p>").unwrap();
    fs::write(
        dir.join("plugin.json"),
        json!({
            "id": "example.notes", "name": "Notes", "version": "0.1.0", "kind": "ui",
            "entry": "ui/index.html",
            "permissions": [{ "permission": "fs:read", "paths": ["~/Documents/**"] }]
        })
        .to_string(),
    )
    .unwrap();
    core.install_plugin(&dir, false);
}

fn ask(core: &Core, caller: &str, permission: Value, reason: &str) -> Value {
    let request: BridgeRequest = serde_json::from_value(json!({
        "id": 1, "method": "perm.request",
        "params": { "permission": permission, "reason": reason }
    }))
    .unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(err) => panic!("perm.request failed: {:?}", err.error),
    }
}

fn notes_scope() -> Value {
    json!({ "permission": "fs:read", "paths": ["~/Documents/notes/**"] })
}

#[test]
fn a_plugin_asks_within_its_manifest_and_the_prompt_names_it() {
    let home = temp_home();
    let person = Person::answering(true);
    let core = Core::new(Roots { home: home.clone() }).with_prompter(person.clone());
    install_notes(&core, &home);

    let answer = ask(&core, "example.notes", notes_scope(), "To show\nyour notes");
    assert_eq!(answer["granted"], true);
    assert_eq!(answer["grant"]["permission"], notes_scope());

    let seen = person.seen();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].caller, "example.notes");
    assert_eq!(seen[0].name, "Notes");
    assert_eq!(seen[0].summary, "read files in ~/Documents/notes/**");
    assert_eq!(
        seen[0].reason, "To show your notes",
        "control characters are gone"
    );
}

#[test]
fn a_refusal_is_a_result_and_grants_nothing() {
    let home = temp_home();
    let core = Core::new(Roots { home: home.clone() }).with_prompter(Person::answering(false));
    install_notes(&core, &home);
    let answer = ask(&core, "example.notes", notes_scope(), "notes");
    assert_eq!(answer, json!({ "granted": false }));
    assert!(core.grants_of("example.notes").is_empty());
}

#[test]
fn asking_beyond_the_manifest_is_refused_without_a_prompt() {
    let home = temp_home();
    let person = Person::answering(true);
    let core = Core::new(Roots { home: home.clone() }).with_prompter(person.clone());
    install_notes(&core, &home);

    let wider = json!({ "permission": "fs:read", "paths": ["~/**"] });
    assert_eq!(
        ask(&core, "example.notes", wider, "everything")["granted"],
        false
    );
    let other = json!({ "permission": "net:fetch", "hosts": ["example.com"] });
    assert_eq!(
        ask(&core, "example.notes", other, "network")["granted"],
        false
    );
    assert!(person.seen().is_empty(), "the person was never asked");
}

#[test]
fn unknown_and_disabled_plugins_cannot_ask() {
    let home = temp_home();
    let person = Person::answering(true);
    let core = Core::new(Roots { home: home.clone() }).with_prompter(person.clone());
    assert_eq!(
        ask(&core, "example.notes", notes_scope(), "x")["granted"],
        false
    );

    install_notes(&core, &home);
    core.grant(
        RUNTIME_CALLER,
        serde_json::from_value(json!({ "permission": "plugin:manage" })).unwrap(),
    );
    let off: BridgeRequest = serde_json::from_value(json!({
        "id": 2, "method": "plugin.setEnabled",
        "params": { "plugin": "example.notes", "enabled": false,
                    "scope": { "permission": "plugin:manage" } }
    }))
    .unwrap();
    core.handle(RUNTIME_CALLER, off);
    assert_eq!(
        ask(&core, "example.notes", notes_scope(), "x")["granted"],
        false
    );
    assert!(person.seen().is_empty());
}

#[test]
fn a_covering_grant_answers_without_a_prompt() {
    let home = temp_home();
    let person = Person::answering(true);
    let core = Core::new(Roots { home: home.clone() }).with_prompter(person.clone());
    install_notes(&core, &home);

    let wide = json!({ "permission": "fs:read", "paths": ["~/Documents/**"] });
    let first = ask(&core, "example.notes", wide, "all documents");
    let again = ask(&core, "example.notes", notes_scope(), "only notes");
    assert_eq!(again["granted"], true);
    assert_eq!(again["grant"]["grantId"], first["grant"]["grantId"]);
    assert_eq!(person.seen().len(), 1, "only the first request was shown");
}

#[test]
fn the_runtime_may_ask_for_anything() {
    let person = Person::answering(true);
    let core = Core::new(Roots { home: temp_home() }).with_prompter(person.clone());
    let net = json!({ "permission": "net:fetch", "hosts": ["example.com"] });
    assert_eq!(ask(&core, RUNTIME_CALLER, net, "updates")["granted"], true);
    assert_eq!(person.seen()[0].name, "endue Desk");
    assert_eq!(person.seen()[0].summary, "connect to example.com");
}

#[test]
fn after_a_refusal_the_same_or_wider_request_is_not_shown_again() {
    let home = temp_home();
    let person = Person::answering(false);
    let core = Core::new(Roots { home: home.clone() }).with_prompter(person.clone());
    install_notes(&core, &home);

    let wide = json!({ "permission": "fs:read", "paths": ["~/Documents/**"] });
    ask(&core, "example.notes", wide.clone(), "all documents");
    assert_eq!(
        ask(&core, "example.notes", wide, "please")["granted"],
        false
    );
    assert_eq!(
        person.seen().len(),
        1,
        "asking again does not reopen the prompt"
    );

    ask(&core, "example.notes", notes_scope(), "only notes, then");
    assert_eq!(person.seen().len(), 2, "a narrower request is still shown");
}
