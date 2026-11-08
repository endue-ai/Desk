//! shell.open through `Core::handle`: links and reveals under `shell:open`, with a fake opener in
//! place of the system's, so no test ever launches a browser or a file manager.

mod support;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use desk_sys::shell::Opener;
use serde_json::{Value, json};
use support::*;

const LINKS: &str = "example.links";

/// What the fake opener was asked to do.
#[derive(Debug, Clone, PartialEq)]
enum Opened {
    Url(String),
    Reveal(PathBuf),
}

use Opened::{Reveal, Url};

/// Records every request instead of handing it to the system.
#[derive(Clone, Default)]
struct Fake(Arc<Mutex<Vec<Opened>>>);

impl Fake {
    fn seen(&self) -> Vec<Opened> {
        self.0.lock().unwrap().clone()
    }
}

impl Opener for Fake {
    fn open_url(&self, url: &str) -> Result<(), desk_sys::Error> {
        self.0.lock().unwrap().push(Url(url.to_owned()));
        Ok(())
    }

    fn reveal(&self, path: &Path) -> Result<(), desk_sys::Error> {
        self.0.lock().unwrap().push(Reveal(path.to_path_buf()));
        Ok(())
    }
}

fn links(schemes: &[&str]) -> Value {
    json!({ "permission": "shell:open", "schemes": schemes })
}

fn downloads() -> Value {
    json!({ "permission": "shell:open", "paths": ["~/Downloads/**"] })
}

/// A desk whose Prompter must never be asked, with `~/Downloads/report 2026.pdf`.
fn desk(tag: &str) -> (Core, Fake, PathBuf) {
    let home = home(tag);
    fs::create_dir_all(home.join("Downloads")).unwrap();
    fs::write(home.join("Downloads/report 2026.pdf"), "%PDF-1.7").unwrap();
    let fake = Fake::default();
    let core = Core::new(roots(&home))
        .with_prompter(NeverAsk)
        .with_opener(fake.clone());
    (core, fake, home)
}

fn open(core: &Core, caller: &str, target: &str, scope: Value) -> Result<Value, BridgeError> {
    let params = json!({ "target": target, "scope": scope });
    call(core, caller, "shell.open", params)
}

fn reveal(core: &Core, caller: &str, target: &str, scope: Value) -> Result<Value, BridgeError> {
    let params = json!({ "target": target, "reveal": true, "scope": scope });
    call(core, caller, "shell.open", params)
}

fn code(answer: Result<Value, BridgeError>) -> ErrorCode {
    answer.expect_err("the call should fail").code
}

#[test]
fn opens_an_https_url_with_the_grant() {
    let (core, fake, _) = desk("shell-https");
    grant(&core, LINKS, links(&["https", "mailto"]));
    let opened = open(&core, LINKS, "https://example.com", links(&["https"]));
    assert_eq!(opened.unwrap(), json!({ "opened": true }));
    let mail = "mailto:ada@example.com?subject=Hello";
    assert_eq!(
        open(&core, LINKS, mail, links(&["mailto"])).unwrap(),
        json!({ "opened": true })
    );
    // The system gets the URL as the core parsed it: lowercase scheme and host, escaped spaces.
    let odd = open(&core, LINKS, "HTTPS://Example.COM/a b", links(&["https"]));
    assert_eq!(odd.unwrap(), json!({ "opened": true }));
    assert_eq!(
        fake.seen(),
        [
            Url("https://example.com/".to_owned()),
            Url(mail.to_owned()),
            Url("https://example.com/a%20b".to_owned()),
        ]
    );
}

#[test]
fn refuses_file_javascript_data_and_custom_schemes() {
    let (core, fake, _) = desk("shell-schemes");
    let every = links(&["http", "https", "mailto"]);
    grant(&core, LINKS, every.clone());
    for target in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "slack://channel?team=T1",
        "x-desk-test://open",
        "https://example.com/\u{0}",
        "https://example.com/a\r\nb",
        "/etc/passwd",
        "example.com",
    ] {
        let err = open(&core, LINKS, target, every.clone()).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams, "{target:?}");
        assert_eq!(err.permission, None, "{target:?}");
    }
    // Refused before any grant is looked at: a caller without one is not asked (NeverAsk).
    let other = open(&core, "example.other", "javascript:alert(1)", every);
    assert_eq!(code(other), ErrorCode::InvalidParams);
    assert!(fake.seen().is_empty(), "{:?}", fake.seen());
}

#[test]
fn refuses_a_scheme_outside_the_scope() {
    let (core, fake, _) = desk("shell-scope");
    grant(&core, LINKS, links(&["http", "https", "mailto"]));
    let err = open(&core, LINKS, "mailto:ada@example.com", links(&["https"])).unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied);
    assert_eq!(
        serde_json::to_value(err.permission).unwrap(),
        links(&["https"])
    );
    let plain = open(&core, LINKS, "http://example.com", links(&["https"]));
    assert_eq!(code(plain), ErrorCode::PermissionDenied);
    // A scope of paths opens no link.
    let paths = open(&core, LINKS, "https://example.com", downloads());
    assert_eq!(code(paths), ErrorCode::PermissionDenied);
    assert!(fake.seen().is_empty(), "{:?}", fake.seen());
}

#[test]
fn reveal_needs_a_path_under_the_scope_and_never_opens_it() {
    let (core, fake, home) = desk("shell-reveal");
    let both = json!({ "permission": "shell:open", "paths": ["~/Downloads/**", "~/Documents/**"] });
    grant(&core, LINKS, both);
    let file = "~/Downloads/report 2026.pdf";
    assert_eq!(
        reveal(&core, LINKS, file, downloads()).unwrap(),
        json!({ "opened": true })
    );
    assert_eq!(
        fake.seen(),
        [Reveal(home.join("Downloads/report 2026.pdf"))]
    );

    for outside in ["~/Documents/hello.md", "~/Downloads/../Documents/hello.md"] {
        let err = reveal(&core, LINKS, outside, downloads()).unwrap_err();
        assert_eq!(err.code, ErrorCode::PermissionDenied, "{outside}");
    }
    let links_only = reveal(&core, LINKS, file, links(&["https"]));
    assert_eq!(code(links_only), ErrorCode::PermissionDenied);
    let missing = reveal(&core, LINKS, "~/Downloads/missing.pdf", downloads());
    assert_eq!(code(missing), ErrorCode::NotFound);
    // A reveal names a path, and a path is never opened as a link.
    let url = reveal(&core, LINKS, "https://example.com", downloads());
    assert_eq!(code(url), ErrorCode::InvalidParams);
    assert_eq!(
        code(open(&core, LINKS, file, downloads())),
        ErrorCode::InvalidParams
    );
    assert_eq!(
        code(open(&core, LINKS, "/etc/hosts", downloads())),
        ErrorCode::InvalidParams
    );
    assert_eq!(
        fake.seen(),
        [Reveal(home.join("Downloads/report 2026.pdf"))],
        "only the first reveal reached the system, and never as a URL"
    );
}

#[test]
fn asks_through_perm_prompt_without_a_grant() {
    let (core, fake, _) = desk("shell-ask");
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let scope = links(&["https"]);
    let (allowed, prompt) = std::thread::scope(|s| {
        let asking = s.spawn(|| open(&core, LINKS, "https://example.com/news", scope.clone()));
        let prompt = wait_for(&deliveries, "perm.prompt");
        assert!(fake.seen().is_empty(), "nothing opens before the answer");
        let id = prompt.data()["promptId"].clone();
        let yes = json!({ "promptId": id, "granted": true, "scope": manage() });
        call(&core, "desk", "perm.answer", yes).unwrap();
        (asking.join().unwrap(), prompt)
    });
    assert_eq!(allowed.unwrap(), json!({ "opened": true }));
    assert_eq!(prompt.to, strings(&["desk"]));
    let data = prompt.data();
    assert_eq!(
        (&data["caller"], &data["permission"], &data["duration"]),
        (&json!(LINKS), &scope, &json!("session"))
    );
    let reason = data["reason"].as_str().unwrap();
    assert!(reason.contains("https://example.com/news"), "{reason}");
    // The grant lasts the session: the next link opens without asking.
    open(&core, LINKS, "https://example.com/next", scope).unwrap();
    assert!(named(&deliveries, "perm.prompt").is_empty());

    // A refusal is permission_denied, and nothing is shown.
    let refused = std::thread::scope(|s| {
        let notes = json!({ "permission": "shell:open", "paths": ["~/Documents/**"] });
        let asking = s.spawn(|| reveal(&core, LINKS, "~/Documents/hello.md", notes));
        let id = wait_for(&deliveries, "perm.prompt").data()["promptId"].clone();
        let no = json!({ "promptId": id, "granted": false, "scope": manage() });
        call(&core, "desk", "perm.answer", no).unwrap();
        asking.join().unwrap()
    });
    assert_eq!(code(refused), ErrorCode::PermissionDenied);
    assert_eq!(fake.seen().len(), 2, "{:?}", fake.seen());

    // With nobody to prompt the Prompter decides: yes opens, the default refuses.
    let home = home("shell-ask-prompter");
    let fake = Fake::default();
    let yes = Core::new(roots(&home))
        .with_prompter(SayYes)
        .with_opener(fake.clone());
    open(&yes, LINKS, "https://example.com", links(&["https"])).unwrap();
    let no = Core::new(roots(&home)).with_opener(fake.clone());
    let refused = open(&no, LINKS, "https://example.com", links(&["https"]));
    assert_eq!(code(refused), ErrorCode::PermissionDenied);
    assert_eq!(fake.seen(), [Url("https://example.com/".to_owned())]);
}
