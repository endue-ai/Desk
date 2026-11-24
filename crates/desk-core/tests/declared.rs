//! A plugin is asked for, granted and allowed only what its manifest declares (ADR 0260): a scope no
//! declaration covers is refused without asking anyone, whatever the plugin holds; one it declares is
//! asked as before; a declared `*` lets any host or program be asked, never `*` itself; and callers
//! that are not installed plugins keep their own rules (agents: their allowlist, ADR 0072 and 0268).

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_bridge::{BridgeError, ErrorCode, Permission, PluginStatus};
use desk_core::{Core, Prompter};
use desk_sys::shell::Opener;
use serde_json::{Value, json};
use support::*;

const VIEWER: &str = "example.viewer";
const REMOTE: &str = "example.remote";

/// Says yes to everything, and counts how often it was asked.
#[derive(Clone, Default)]
struct Counting(Arc<AtomicUsize>);

impl Counting {
    fn asked(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

impl Prompter for Counting {
    fn ask(&self, _caller: &str, _permission: &Permission, _reason: &str) -> bool {
        self.0.fetch_add(1, Ordering::SeqCst);
        true
    }
}

/// Records what shell.open would have handed to the system.
#[derive(Clone, Default)]
struct Fake(Arc<Mutex<Vec<String>>>);

impl Opener for Fake {
    fn open_url(&self, url: &str) -> Result<(), desk_sys::Error> {
        self.0.lock().unwrap().push(url.to_owned());
        Ok(())
    }

    fn reveal(&self, path: &Path) -> Result<(), desk_sys::Error> {
        self.0.lock().unwrap().push(path.display().to_string());
        Ok(())
    }
}

/// Install `id`, a UI plugin declaring `permissions`, from a folder under `home`.
fn install(core: &Core, home: &Path, id: &str, permissions: Value, built_in: bool) -> PathBuf {
    let dir = home.join("plugins").join(id);
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    let manifest = json!({ "id": id, "version": "0.1.0", "kind": "ui",
        "entry": "ui/index.html", "permissions": permissions });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    let info = core.install_plugin(&dir, built_in);
    assert_eq!(info.status, PluginStatus::Ready, "{:?}", info.error);
    dir
}

fn request(core: &Core, caller: &str, permission: Value) -> Value {
    call(
        core,
        caller,
        "perm.request",
        json!({ "permission": permission }),
    )
    .unwrap()
}

/// perm.request on a thread of its own: its answer, or `None` when it still waits after 5 s.
fn request_in_time(core: &Arc<Core>, caller: &str, permission: Value) -> Option<Value> {
    let (sent, answer) = mpsc::channel();
    let (core, caller) = (Arc::clone(core), caller.to_owned());
    std::thread::spawn(move || {
        let _ = sent.send(request(&core, &caller, permission));
    });
    answer.recv_timeout(Duration::from_secs(5)).ok()
}

fn undeclared() -> Value {
    json!({ "granted": false, "reason": "undeclared" })
}

fn read_today(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    let params = json!({ "path": "~/Calendar/today.ics", "scope": calendar_read() });
    call(core, caller, "fs.read", params)
}

fn links() -> Value {
    json!({ "permission": "shell:open", "schemes": ["https"] })
}

fn open_link(core: &Core, caller: &str) -> Result<Value, BridgeError> {
    let params = json!({ "target": "https://example.com/", "scope": links() });
    call(core, caller, "shell.open", params)
}

#[test]
fn an_undeclared_scope_is_refused_without_asking() {
    let home = home("declared-refused");
    // NeverAsk: a request that reached the Prompter would fail the test.
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    install(&core, &home, VIEWER, json!([notes_read()]), false);
    assert_eq!(request(&core, VIEWER, calendar_read()), undeclared());
    assert!(query(&core, VIEWER).is_empty(), "nothing was granted");

    // With a prompter listening, no perm.prompt goes out either.
    let core = Arc::new(core);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let fetch = json!({ "permission": "net:fetch", "hosts": ["example.com"] });
    let answer = request_in_time(&core, VIEWER, fetch);
    let prompts = named(&deliveries, "perm.prompt");
    assert!(prompts.is_empty(), "nobody is asked: {prompts:?}");
    assert_eq!(answer, Some(undeclared()));
}

#[test]
fn a_declared_scope_without_a_grant_is_asked() {
    let home = home("declared-asked");
    let person = Counting::default();
    let core = Core::new(roots(&home)).with_prompter(person.clone());
    let every_path = json!({ "permission": "fs:read", "paths": ["/**"] });
    install(&core, &home, VIEWER, json!([every_path]), true);
    assert!(
        query(&core, VIEWER).is_empty(),
        "an install grants no declaration that holds /**: it says what may be asked"
    );

    // One folder under the declared /**, in the home folder: asked, granted, then read.
    assert_eq!(request(&core, VIEWER, notes_read())["granted"], true);
    assert_eq!(person.asked(), 1);
    read_hello(&core, VIEWER).unwrap();
    // Another disk and a Windows drive are under it too.
    for folder in ["/Volumes/USB/Photos/**", "C:/Users/me/Pictures/**"] {
        let scope = json!({ "permission": "fs:read", "paths": [folder] });
        assert_eq!(request(&core, VIEWER, scope)["granted"], true, "{folder}");
    }
    assert_eq!(person.asked(), 3);

    // A plugin that declares the scope itself is asked for it as today.
    install(&core, &home, REMOTE, json!([calendar_read()]), false);
    assert_eq!(request(&core, REMOTE, calendar_read())["granted"], true);
    assert_eq!(person.asked(), 4);
    read_today(&core, REMOTE).unwrap();
}

#[test]
fn an_undeclared_scope_is_permission_denied_whatever_is_held() {
    let home = home("declared-held");
    let person = Counting::default();
    let opener = Fake::default();
    let core = Core::new(roots(&home))
        .with_prompter(person.clone())
        .with_opener(opener.clone());
    let dir = install(
        &core,
        &home,
        VIEWER,
        json!([notes_read(), calendar_read()]),
        false,
    );
    // While its manifest declares the calendar, the person grants it for good.
    let always = json!({ "permission": calendar_read(), "duration": "always" });
    let kept = call(&core, VIEWER, "perm.request", always).unwrap();
    assert_eq!(kept["grant"]["duration"], "always");
    // The host grants it links for the session, which it never declared.
    grant(&core, VIEWER, links());
    let asked = person.asked();

    // Its next version declares only the notes.
    let manifest = json!({ "id": VIEWER, "version": "0.2.0", "kind": "ui",
        "entry": "ui/index.html", "permissions": [notes_read()] });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);

    let read = read_today(&core, VIEWER).unwrap_err();
    assert_eq!(read.code, ErrorCode::PermissionDenied);
    assert_eq!(
        serde_json::to_value(&read.permission).unwrap(),
        calendar_read()
    );
    assert!(read.message.contains("declare"), "{}", read.message);
    // shell.open checks first and asks without a grant: neither happens for an undeclared scope.
    let open = open_link(&core, VIEWER).unwrap_err();
    assert_eq!(open.code, ErrorCode::PermissionDenied);
    let mail = json!({ "target": "mailto:me@example.com",
        "scope": { "permission": "shell:open", "schemes": ["mailto"] } });
    let mail = call(&core, VIEWER, "shell.open", mail).unwrap_err();
    assert_eq!(mail.code, ErrorCode::PermissionDenied);
    assert!(opener.0.lock().unwrap().is_empty(), "nothing was opened");
    // A lasting grant answers no request its manifest does not declare.
    assert_eq!(request(&core, VIEWER, calendar_read()), undeclared());
    assert_eq!(person.asked(), asked, "nobody was asked");

    // perm.grant (ADR 0131's opener grant) of an undeclared scope is refused.
    grant(&core, "desk", manage());
    let give = json!({ "caller": VIEWER, "permission": json!({ "permission": "fs:read",
        "paths": ["~/Pictures/**"] }), "scope": manage() });
    let given = call(&core, "desk", "perm.grant", give).unwrap_err();
    assert_eq!(given.code, ErrorCode::PermissionDenied);
    // A declared one is still granted.
    let give = json!({ "caller": VIEWER, "permission": notes_read(), "scope": manage() });
    call(&core, "desk", "perm.grant", give).unwrap();
    read_hello(&core, VIEWER).unwrap();
}

#[test]
fn a_star_declaration_lets_any_host_or_program_be_asked_but_never_a_star() {
    let home = home("declared-star");
    let person = Counting::default();
    let core = Core::new(roots(&home)).with_prompter(person.clone());
    let declared = json!([
        { "permission": "net:connect", "hosts": ["*"] },
        { "permission": "proc:spawn", "commands": ["*"] },
    ]);
    install(&core, &home, REMOTE, declared, true);
    assert!(query(&core, REMOTE).is_empty(), "an install grants no `*`");

    let printer = json!({ "permission": "net:connect", "hosts": ["printer.local:631"] });
    assert_eq!(request(&core, REMOTE, printer)["granted"], true);
    let psql = json!({ "permission": "proc:spawn", "commands": ["/opt/bin/psql"] });
    assert_eq!(request(&core, REMOTE, psql)["granted"], true);
    assert_eq!(person.asked(), 2);

    for star in [
        json!({ "permission": "net:connect", "hosts": ["*"] }),
        json!({ "permission": "net:connect", "hosts": ["printer.local", "*"] }),
        json!({ "permission": "proc:spawn", "commands": ["*"] }),
        // Declared without a PTY, and net:fetch not at all.
        json!({ "permission": "proc:spawn", "commands": ["sh"], "pty": true }),
        json!({ "permission": "net:fetch", "hosts": ["example.com"] }),
    ] {
        assert_eq!(request(&core, REMOTE, star.clone()), undeclared(), "{star}");
    }
    assert_eq!(person.asked(), 2, "nobody was asked");
    let held: Vec<String> = query(&core, REMOTE)
        .iter()
        .map(|grant| grant["permission"].to_string())
        .collect();
    assert!(!held.iter().any(|p| p.contains("\"*\"")), "{held:?}");
}

#[test]
fn callers_that_are_not_plugins_keep_their_rules() {
    let home = home("declared-others");
    let file = home.join("init.yaml");
    let init =
        "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n";
    fs::write(&file, init).unwrap();
    let person = Counting::default();
    let core = Core::new(roots(&home))
        .with_prompter(person.clone())
        .with_init_file(file);
    install(&core, &home, VIEWER, json!([notes_read()]), false);

    // The desk and a caller the core never installed are judged by their grants alone.
    grant(&core, "desk", calendar_read());
    read_today(&core, "desk").unwrap();
    assert_eq!(request(&core, NOTES, calendar_read())["granted"], true);
    read_today(&core, NOTES).unwrap();
    let any = json!({ "permission": "net:connect", "hosts": ["*"] });
    assert_eq!(request(&core, "desk", any)["granted"], true);
    assert_eq!(person.asked(), 2);

    // An agent: refused outside its allowlist, asked inside it.
    let desktop = json!({ "permission": "fs:write", "paths": ["~/Desktop/**"] });
    assert_eq!(
        request(&core, "agent:mira", desktop),
        json!({ "granted": false, "reason": "outside-allowlist" })
    );
    let notes = json!({ "permission": "fs:write", "paths": ["~/Notes/**"] });
    assert_eq!(request(&core, "agent:mira", notes)["granted"], true);
    assert_eq!(person.asked(), 3);

    // An agent without an allowlist runs a command an installed plugin offers agents without a
    // question (ADR 0268, ADR 0367).
    let command = json!({ "id": "example.viewer.show", "title": "Show",
        "description": "Show the note.", "agent": true });
    call(&core, VIEWER, "cmd.register", command).unwrap();
    let invoke = json!({ "id": "example.viewer.show",
        "scope": { "permission": "cmd:invoke", "ids": ["example.viewer.show"] } });
    call(&core, "agent:theo", "cmd.invoke", invoke).unwrap();
    assert_eq!(person.asked(), 3);
    // One the plugin keeps for the person asks first, once for the session.
    let kept = json!({ "id": "example.viewer.clear", "title": "Clear" });
    call(&core, VIEWER, "cmd.register", kept).unwrap();
    let invoke = json!({ "id": "example.viewer.clear",
        "scope": { "permission": "cmd:invoke", "ids": ["example.viewer.clear"] } });
    call(&core, "agent:theo", "cmd.invoke", invoke.clone()).unwrap();
    assert_eq!(person.asked(), 4);
    call(&core, "agent:theo", "cmd.invoke", invoke).unwrap();
    assert_eq!(person.asked(), 4);
}
