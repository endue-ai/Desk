//! web.read and web.act through `Core::handle` (ADR 0270): what a view's page says and what is
//! done in it, for the view's caller under `web:control`. `web:browse` alone is
//! `permission_denied`; a grant with hosts covers only a page on them, at the address the shell
//! last reported; another caller's view is `not_found`; the shell is told the address the call
//! was allowed at, and what it cannot do comes back as `not_found` or `invalid_value`.

mod support;

use std::sync::{Arc, Mutex};

use desk_bridge::{
    BridgeError, ErrorCode, WebActResult, WebAction, WebReadResult, WebScrolled, WebStep,
};
use desk_core::{Core, WebError, WebPlace, WebState, WebViews};
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const BROWSER: &str = "endue.browser";
const OTHER: &str = "example.other";

/// A shell that records what it was asked of a page and answers a page of its own.
#[derive(Default)]
struct Pages {
    asked: Mutex<Vec<String>>,
}

impl Pages {
    fn asked(&self) -> Vec<String> {
        self.asked.lock().unwrap().clone()
    }

    fn note(&self, what: String) {
        self.asked.lock().unwrap().push(what);
    }
}

impl WebViews for Pages {
    fn open(&self, _surface: &str, _view: &str, _url: Option<&str>) -> Result<(), WebError> {
        Ok(())
    }

    fn place(&self, _view: &str, _place: WebPlace) -> Result<(), WebError> {
        Ok(())
    }

    fn load(&self, _view: &str, _url: &str) -> Result<(), WebError> {
        Ok(())
    }

    fn go(&self, _view: &str, _step: WebStep) -> Result<(), WebError> {
        Ok(())
    }

    fn focus(&self, _view: &str) -> Result<(), WebError> {
        Ok(())
    }

    fn close(&self, _view: &str) {}

    fn read(&self, view: &str, at: &str, from: u64, max: u64) -> Result<WebReadResult, WebError> {
        self.note(format!("read {view} at {at} from {from} max {max}"));
        Ok(WebReadResult {
            url: at.to_owned(),
            title: "Example".to_owned(),
            text: "# Example\n[e1 link \"More\"]".to_owned(),
            from,
            length: 26,
            scroll: WebScrolled {
                x: 0,
                y: 120,
                width: 800,
                height: 600,
                page_width: 800,
                page_height: 2400,
            },
        })
    }

    fn act(&self, view: &str, at: &str, action: &WebAction) -> Result<WebActResult, WebError> {
        let said = serde_json::to_string(action).unwrap();
        self.note(format!("act {view} at {at} {said}"));
        match action {
            WebAction::WebPress(press) if press.r#ref == "e99" => {
                Err(WebError::NotFound("the page has no element e99".into()))
            }
            WebAction::WebType(typed) if typed.r#ref.as_deref() == Some("e1") => {
                Err(WebError::Invalid("e1 is a link, not a field".into()))
            }
            WebAction::WebScroll(_) => Ok(WebActResult { moved: Some(false) }),
            _ => Ok(WebActResult { moved: None }),
        }
    }
}

fn browse() -> Value {
    json!({ "permission": "web:browse" })
}

fn control() -> Value {
    json!({ "permission": "web:control" })
}

fn control_on(host: &str) -> Value {
    json!({ "permission": "web:control", "hosts": [host] })
}

fn core_with(pages: &Arc<Pages>) -> Core {
    let core = Core::new(roots(&home("web-control")));
    core.set_web_views(Some(pages.clone()));
    core
}

/// A view of `caller`'s whose page the shell reported at `url`.
fn view_at(core: &Core, caller: &str, url: &str) -> String {
    grant(core, caller, browse());
    let params = json!({ "url": url, "surface": "main.endue-browser", "scope": browse() });
    let opened = call(core, caller, "web.open", params).unwrap();
    let view = opened["viewId"].as_str().unwrap().to_owned();
    shows(core, &view, url);
    view
}

fn shows(core: &Core, view: &str, url: &str) {
    let state = WebState {
        url: url.to_owned(),
        ..WebState::default()
    };
    core.web_changed(view, state);
}

fn read(core: &Core, caller: &str, view: &str, scope: Value) -> Result<Value, BridgeError> {
    call(
        core,
        caller,
        "web.read",
        json!({ "viewId": view, "scope": scope }),
    )
}

fn act(core: &Core, view: &str, action: Value) -> Result<Value, BridgeError> {
    let params = json!({ "viewId": view, "action": action, "scope": control() });
    call(core, BROWSER, "web.act", params)
}

#[test]
fn showing_a_page_does_not_let_its_plugin_read_it_or_act_in_it() {
    let pages = Arc::new(Pages::default());
    let core = core_with(&pages);
    let view = view_at(&core, BROWSER, "https://example.com/");
    let refused = read(&core, BROWSER, &view, control()).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(serde_json::to_value(refused.permission).unwrap(), control());
    let press = json!({ "do": "press", "ref": "e1" });
    let refused = act(&core, &view, press).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert!(pages.asked().is_empty(), "the shell was asked nothing");
}

#[test]
fn web_control_reads_the_page_and_acts_in_it() {
    let pages = Arc::new(Pages::default());
    let core = core_with(&pages);
    let view = view_at(&core, BROWSER, "https://example.com/a");
    grant(&core, BROWSER, control());
    let page = read(&core, BROWSER, &view, control()).unwrap();
    assert_eq!(page["url"], "https://example.com/a");
    assert_eq!(page["text"], "# Example\n[e1 link \"More\"]");
    assert_eq!(page["scroll"]["pageHeight"], 2400);
    let part = json!({ "viewId": view, "from": 20000, "max": 4000, "scope": control() });
    call(&core, BROWSER, "web.read", part).unwrap();
    let down = json!({ "do": "scroll", "to": "down", "pages": 0.5 });
    let scrolled = act(&core, &view, down).unwrap();
    assert_eq!(scrolled, json!({ "moved": false }));
    let typed = json!({ "do": "type", "ref": "e2", "text": "서울 날씨", "submit": true });
    assert_eq!(act(&core, &view, typed).unwrap(), json!({}));
    assert_eq!(
        pages.asked(),
        [
            format!("read {view} at https://example.com/a from 0 max 20000"),
            format!("read {view} at https://example.com/a from 20000 max 4000"),
            format!(
                "act {view} at https://example.com/a {{\"do\":\"scroll\",\"to\":\"down\",\"pages\":0.5}}"
            ),
            format!(
                "act {view} at https://example.com/a {{\"do\":\"type\",\"text\":\"서울 날씨\",\"ref\":\"e2\",\"submit\":true}}"
            ),
        ]
    );
}

#[test]
fn a_grant_with_hosts_covers_only_a_page_on_them() {
    let pages = Arc::new(Pages::default());
    let core = core_with(&pages);
    let view = view_at(&core, BROWSER, "https://docs.example.com/");
    grant(&core, BROWSER, control_on("*.example.com"));
    // A scope for every page is wider than the grant.
    let wide = read(&core, BROWSER, &view, control()).unwrap_err();
    assert_eq!(wide.code, ErrorCode::PermissionDenied, "{wide:?}");
    read(&core, BROWSER, &view, control_on("*.example.com")).unwrap();
    // The page went elsewhere by itself: the grant does not follow it.
    shows(&core, &view, "https://mail.elsewhere.test/inbox");
    let away = read(&core, BROWSER, &view, control_on("*.example.com")).unwrap_err();
    assert_eq!(away.code, ErrorCode::PermissionDenied, "{away:?}");
    assert_eq!(pages.asked().len(), 1, "the page elsewhere was not read");
}

#[test]
fn a_view_is_read_and_acted_in_by_its_caller_alone() {
    let pages = Arc::new(Pages::default());
    let core = core_with(&pages);
    let view = view_at(&core, BROWSER, "https://example.com/");
    grant(&core, OTHER, control());
    let theirs = read(&core, OTHER, &view, control()).unwrap_err();
    assert_eq!(theirs.code, ErrorCode::NotFound, "{theirs:?}");
    let params =
        json!({ "viewId": view, "action": { "do": "key", "key": "Enter" }, "scope": control() });
    let theirs = call(&core, OTHER, "web.act", params).unwrap_err();
    assert_eq!(theirs.code, ErrorCode::NotFound, "{theirs:?}");
    assert!(pages.asked().is_empty());
}

#[test]
fn what_the_page_cannot_take_comes_back_as_an_error() {
    let pages = Arc::new(Pages::default());
    let core = core_with(&pages);
    let view = view_at(&core, BROWSER, "https://example.com/");
    grant(&core, BROWSER, control());
    let gone = act(&core, &view, json!({ "do": "press", "ref": "e99" })).unwrap_err();
    assert_eq!(gone.code, ErrorCode::NotFound, "{gone:?}");
    let link = json!({ "do": "type", "ref": "e1", "text": "x" });
    let wrong = act(&core, &view, link).unwrap_err();
    assert_eq!(wrong.code, ErrorCode::InvalidValue, "{wrong:?}");
    // A desk without a compositor has no view to read.
    core.set_web_views(None);
    let none = read(&core, BROWSER, &view, control()).unwrap_err();
    assert_eq!(none.code, ErrorCode::NotFound, "{none:?}");
}

#[test]
fn a_view_with_no_page_yet_has_no_host_to_check() {
    let pages = Arc::new(Pages::default());
    let core = core_with(&pages);
    grant(&core, BROWSER, browse());
    let params = json!({ "surface": "main.endue-browser", "scope": browse() });
    let opened = call(&core, BROWSER, "web.open", params).unwrap();
    let view = opened["viewId"].as_str().unwrap().to_owned();
    grant(&core, BROWSER, control_on("example.com"));
    read(&core, BROWSER, &view, control_on("example.com")).unwrap();
    assert_eq!(pages.asked(), [format!("read {view} at  from 0 max 20000")]);
}
