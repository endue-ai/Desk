//! web.* through `Core::handle` (#273, ADR 0216): web views the shell shows, which the core owns
//! per caller under `web:browse`. A call without a grant, or to an address outside its hosts, is
//! `permission_denied`; another caller's view is `not_found`; a desk without a compositor answers
//! `unsupported`; what the shell reports comes back as `web.changed` for the view's caller alone;
//! a view ends when it is closed, when its window opens another, when a grant that covered it
//! goes and when the shell says so.

mod support;

use std::sync::{Arc, Mutex};

use desk_bridge::{BridgeError, ErrorCode, WebStep};
use desk_core::{Core, WebError, WebPlace, WebState, WebViews};
use serde_json::{Value, json};
use support::{call, grant, home, named, roots};

const BROWSER: &str = "endue.browser";
const OTHER: &str = "example.other";
const SURFACE: &str = "main.endue-browser";

/// A shell that records what it was asked; a surface named `out` is out of the canvas.
#[derive(Default)]
struct Shown {
    asked: Mutex<Vec<String>>,
}

impl Shown {
    fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }

    fn note(&self, what: String) {
        self.asked.lock().unwrap().push(what);
    }
}

impl WebViews for Shown {
    fn open(&self, surface: &str, view: &str, url: Option<&str>) -> Result<(), WebError> {
        if surface == "out" {
            return Err(WebError::Unsupported("out of the canvas".to_owned()));
        }
        self.note(format!("open {surface} {view} {}", url.unwrap_or("-")));
        Ok(())
    }

    fn place(&self, view: &str, place: WebPlace) -> Result<(), WebError> {
        self.note(format!("place {view} {place:?}"));
        Ok(())
    }

    fn load(&self, view: &str, url: &str) -> Result<(), WebError> {
        self.note(format!("load {view} {url}"));
        Ok(())
    }

    fn go(&self, view: &str, step: WebStep) -> Result<(), WebError> {
        self.note(format!("go {view} {step:?}"));
        Ok(())
    }

    fn focus(&self, view: &str) -> Result<(), WebError> {
        self.note(format!("focus {view}"));
        Ok(())
    }

    fn close(&self, view: &str) {
        self.note(format!("close {view}"));
    }
}

fn any() -> Value {
    json!({ "permission": "web:browse" })
}

fn only(host: &str) -> Value {
    json!({ "permission": "web:browse", "hosts": [host] })
}

fn core_with(shown: &Arc<Shown>) -> Core {
    let core = Core::new(roots(&home("web-views")));
    core.set_web_views(Some(shown.clone()));
    core
}

fn open(core: &Core, caller: &str, url: &str, scope: Value) -> Result<String, BridgeError> {
    let params = json!({ "url": url, "surface": SURFACE, "scope": scope });
    call(core, caller, "web.open", params).map(|r| r["viewId"].as_str().unwrap().to_owned())
}

#[test]
fn a_view_opens_in_the_callers_window_and_takes_its_calls() {
    let shown = Arc::new(Shown::default());
    let core = core_with(&shown);
    grant(&core, BROWSER, any());
    let view = open(&core, BROWSER, "https://example.com/", any()).unwrap();
    let place = json!({ "viewId": view, "x": 0, "y": 40, "width": 800, "height": 560 });
    call(&core, BROWSER, "web.place", place).unwrap();
    let load = json!({ "viewId": view, "url": "https://endue.ai/blog", "scope": any() });
    call(&core, BROWSER, "web.load", load).unwrap();
    call(&core, BROWSER, "web.go", json!({ "viewId": view, "to": "back" })).unwrap();
    call(&core, BROWSER, "web.focus", json!({ "viewId": view })).unwrap();
    call(&core, BROWSER, "web.close", json!({ "viewId": view })).unwrap();
    assert_eq!(
        shown.asked(),
        [
            format!("open {SURFACE} {view} https://example.com/"),
            format!(
                "place {view} WebPlace {{ x: 0.0, y: 40.0, width: 800.0, height: 560.0, shown: true }}"
            ),
            format!("load {view} https://endue.ai/blog"),
            format!("go {view} Back"),
            format!("focus {view}"),
            format!("close {view}"),
        ]
    );
    assert_eq!(core.web_view_count(), 0);
    // Closing one that already ended is no error, and asks the shell nothing.
    call(&core, BROWSER, "web.close", json!({ "viewId": view })).unwrap();
    assert_eq!(shown.asked().len(), 6);
}

#[test]
fn it_needs_web_browse_and_an_address_its_hosts_cover() {
    let shown = Arc::new(Shown::default());
    let core = core_with(&shown);
    let refused = open(&core, BROWSER, "https://example.com/", any()).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(serde_json::to_value(refused.permission).unwrap(), any());
    // A grant for one host: a scope for every host is not covered, nor an address elsewhere.
    grant(&core, BROWSER, only("*.example.com"));
    let wide = open(&core, BROWSER, "https://docs.example.com/", any()).unwrap_err();
    assert_eq!(wide.code, ErrorCode::PermissionDenied, "{wide:?}");
    let scope = only("*.example.com");
    let outside = open(&core, BROWSER, "https://elsewhere.test/", scope.clone()).unwrap_err();
    assert_eq!(outside.code, ErrorCode::PermissionDenied, "{outside:?}");
    assert!(shown.asked().is_empty(), "nothing opened");
    let view = open(&core, BROWSER, "https://docs.example.com/a", scope.clone()).unwrap();
    let load = json!({ "viewId": view, "url": "https://elsewhere.test/", "scope": scope });
    let away = call(&core, BROWSER, "web.load", load).unwrap_err();
    assert_eq!(away.code, ErrorCode::PermissionDenied, "{away:?}");
    // The shell asks before the page goes somewhere by itself.
    assert!(core.web_allows(&view, "https://api.example.com/x"));
    assert!(!core.web_allows(&view, "https://elsewhere.test/"));
    assert!(!core.web_allows(&view, "file:///etc/passwd"));
    assert!(!core.web_allows(&view, "desk-plugin://main.endue-notes/x"));
    assert!(!core.web_allows("w-999", "https://docs.example.com/"));
}

#[test]
fn a_view_is_its_callers_alone() {
    let shown = Arc::new(Shown::default());
    let core = core_with(&shown);
    grant(&core, BROWSER, any());
    grant(&core, OTHER, any());
    let view = open(&core, BROWSER, "https://example.com/", any()).unwrap();
    for (method, params) in [
        ("web.place", json!({ "viewId": view, "x": 0, "y": 0, "width": 9, "height": 9 })),
        ("web.load", json!({ "viewId": view, "url": "https://example.com/", "scope": any() })),
        ("web.go", json!({ "viewId": view, "to": "reload" })),
        ("web.focus", json!({ "viewId": view })),
    ] {
        let theirs = call(&core, OTHER, method, params).unwrap_err();
        assert_eq!(theirs.code, ErrorCode::NotFound, "{method}: {theirs:?}");
    }
    call(&core, OTHER, "web.close", json!({ "viewId": view })).unwrap();
    assert_eq!(core.web_view_count(), 1, "another caller's close leaves it");
    assert_eq!(shown.asked().len(), 1, "the shell heard only the open");
}

#[test]
fn what_the_shell_reports_reaches_the_views_caller_as_web_changed() {
    let shown = Arc::new(Shown::default());
    let core = core_with(&shown);
    grant(&core, BROWSER, any());
    let events = core.events().subscribe_addressed();
    let view = open(&core, BROWSER, "https://example.com/", any()).unwrap();
    core.web_changed(
        &view,
        WebState {
            url: "https://example.com/docs".to_owned(),
            title: "Docs".to_owned(),
            loading: true,
            can_go_back: true,
            refused: Some("https://elsewhere.test/".to_owned()),
            ..WebState::default()
        },
    );
    let heard = named(&events, "web.changed");
    assert_eq!(heard.len(), 1);
    assert!(heard[0].is_for(BROWSER) && !heard[0].is_for(OTHER));
    assert_eq!(
        heard[0].data(),
        &json!({ "viewId": view, "url": "https://example.com/docs", "title": "Docs",
            "loading": true, "canGoBack": true, "canGoForward": false,
            "refused": "https://elsewhere.test/" })
    );
    // The shell ends the view (its window's surface slept): its last event, and it is forgotten.
    core.web_changed(
        &view,
        WebState {
            closed: true,
            ..WebState::default()
        },
    );
    let last = named(&events, "web.changed");
    assert_eq!(last[0].data()["closed"], true);
    assert_eq!(core.web_view_count(), 0);
    core.web_changed(&view, WebState::default());
    assert!(named(&events, "web.changed").is_empty(), "a view that ended says nothing");
}

#[test]
fn a_window_has_one_view_and_a_lost_grant_closes_it() {
    let shown = Arc::new(Shown::default());
    let core = core_with(&shown);
    let grant_id = grant(&core, BROWSER, any());
    let events = core.events().subscribe_addressed();
    let first = open(&core, BROWSER, "https://example.com/", any()).unwrap();
    let second = open(&core, BROWSER, "https://endue.ai/", any()).unwrap();
    assert_ne!(first, second);
    assert_eq!(core.web_view_count(), 1, "opening another closes the first");
    assert!(shown.asked().contains(&format!("close {first}")));
    let ended = named(&events, "web.changed");
    assert_eq!(ended[0].data()["viewId"], first.as_str());
    assert_eq!(ended[0].data()["closed"], true);
    call(&core, BROWSER, "perm.revoke", json!({ "grantId": grant_id })).unwrap();
    assert_eq!(core.web_view_count(), 0, "a revoked grant closes its views");
    assert!(shown.asked().contains(&format!("close {second}")));
    assert_eq!(named(&events, "web.changed")[0].data()["viewId"], second.as_str());
}

#[test]
fn a_desk_without_a_compositor_or_a_window_out_of_the_canvas_answers_unsupported() {
    let core = Core::new(roots(&home("web-views-none")));
    grant(&core, BROWSER, any());
    let none = open(&core, BROWSER, "https://example.com/", any()).unwrap_err();
    assert_eq!(none.code, ErrorCode::Unsupported, "{none:?}");
    let shown = Arc::new(Shown::default());
    core.set_web_views(Some(shown.clone()));
    let params = json!({ "url": "https://example.com/", "surface": "out", "scope": any() });
    let out = call(&core, BROWSER, "web.open", params).unwrap_err();
    assert_eq!(out.code, ErrorCode::Unsupported, "{out:?}");
    assert_eq!(core.web_view_count(), 0, "a view that did not open is not kept");
    // The runtime names the window: a call without one is refused.
    let bare = json!({ "url": "https://example.com/", "scope": any() });
    let unnamed = call(&core, BROWSER, "web.open", bare).unwrap_err();
    assert_eq!(unnamed.code, ErrorCode::InvalidParams, "{unnamed:?}");
    // The shell lets go of its compositor: the views it showed are forgotten.
    open(&core, BROWSER, "https://example.com/", any()).unwrap();
    core.set_web_views(None);
    assert_eq!(core.web_view_count(), 0);
}
