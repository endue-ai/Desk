//! What is asked of a web view's page (ADR 0272): `web.read` and `web.act` go through the
//! browser's own DevTools agent, as the accessibility actions of a surface do
//! (`a11y_devtools.rs`). The page script (`web_page.js`, `web_page_text.js`) runs in a world of
//! the desk's own in the view's main document (`Page.createIsolatedWorld`): the page's scripts
//! neither see it nor change what it reads with, and it still gets nothing of the desk. Typed
//! text and keys are DevTools input (`Input.insertText`, `Input.dispatchKeyEvent`) and a press
//! is the pointer's own (`input::deliver`), so a page takes them as a person's; the view never
//! takes the desk's keys for it (`Emulation.setFocusEmulationEnabled` lets its page have a
//! caret without them). Each call is sent on CEF's UI thread and answered there by the
//! observer; who asked waits on another thread (`compositor_window/web_control.rs`).

use std::collections::HashMap;
use std::sync::mpsc;

use cef::*;
use desk_bridge::WebKeyName;
use desk_compositor::glam::Vec2;
use desk_compositor::input::Button;
use desk_core::WebError;
use serde_json::{Value, json};

use super::view::a11y::actions::presses;
use super::web_rules::{host_of, surface_of};
use super::web_views::missing;
use super::{WebHost, frames, input};

/// DevTools message ids of a view's calls, clear of the accessibility agent's.
const FIRST_ID: i32 = 680_000;
/// The name of the desk's world in a view's page.
pub const WORLD: &str = "endue-desk";

const SCRIPT: &str = concat!(
    include_str!("web_page_text.js"),
    include_str!("web_page.js")
);

/// What a DevTools call answered: its result, or the words of its error.
pub type Answer = Result<Value, String>;

/// The DevTools calls in flight on a view's browser, and the observer that hears their answers.
#[derive(Default)]
pub(super) struct Calls {
    watch: Option<(i32, Registration)>,
    waiting: HashMap<i32, mpsc::Sender<Answer>>,
    next: i32,
}

/// The expression that asks the page script `request` in the desk's world.
pub fn asks(request: &Value) -> String {
    format!("{SCRIPT}\n__deskPage({request})")
}

/// What the page script answered an evaluation with: its `ok`, or why not.
pub fn answered(evaluated: &Value) -> Result<Value, WebError> {
    if let Some(thrown) = evaluated.get("exceptionDetails") {
        let why = thrown
            .pointer("/exception/description")
            .or_else(|| thrown.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("it threw");
        return Err(WebError::Failed(format!("the page script failed: {why}")));
    }
    let said = evaluated.pointer("/result/value");
    if let Some(ok) = said.and_then(|v| v.get("ok")) {
        return Ok(ok.clone());
    }
    let error = said.and_then(|v| v.get("error"));
    let words = |key| error.and_then(|e| e.get(key)).and_then(Value::as_str);
    let message = words("message")
        .unwrap_or("the page did not answer")
        .to_owned();
    Err(match words("code") {
        Some("not_found" | "moved") => WebError::NotFound(message),
        Some("invalid") => WebError::Invalid(message),
        _ => WebError::Failed(message),
    })
}

/// The two DevTools key events (down, up) that press `key`: one that types (Enter, Space) says
/// its text, as a keyboard's does.
pub fn key_events(key: WebKeyName) -> [Value; 2] {
    use WebKeyName as K;
    let (name, code, vk, text) = match key {
        K::Enter => ("Enter", "Enter", 13, Some("\r")),
        K::Tab => ("Tab", "Tab", 9, None),
        K::Escape => ("Escape", "Escape", 27, None),
        K::Backspace => ("Backspace", "Backspace", 8, None),
        K::Delete => ("Delete", "Delete", 46, None),
        K::Space => (" ", "Space", 32, Some(" ")),
        K::ArrowUp => ("ArrowUp", "ArrowUp", 38, None),
        K::ArrowDown => ("ArrowDown", "ArrowDown", 40, None),
        K::ArrowLeft => ("ArrowLeft", "ArrowLeft", 37, None),
        K::ArrowRight => ("ArrowRight", "ArrowRight", 39, None),
        K::PageUp => ("PageUp", "PageUp", 33, None),
        K::PageDown => ("PageDown", "PageDown", 34, None),
        K::Home => ("Home", "Home", 36, None),
        K::End => ("End", "End", 35, None),
    };
    let event = |kind: &str| {
        json!({ "type": kind, "key": name, "code": code, "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk })
    };
    let mut down = event(if text.is_some() {
        "keyDown"
    } else {
        "rawKeyDown"
    });
    if let Some(text) = text {
        down["text"] = json!(text);
    }
    [down, event("keyUp")]
}

wrap_dev_tools_message_observer! {
    pub struct PageWatch {
        host: WebHost,
        surface: String,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(
            &self,
            _browser: Option<&mut Browser>,
            message_id: ::std::os::raw::c_int,
            success: ::std::os::raw::c_int,
            result: Option<&[u8]>,
        ) {
            let said = result.and_then(|r| serde_json::from_slice::<Value>(r).ok());
            let answer = if success == 1 {
                Ok(said.unwrap_or(Value::Null))
            } else {
                let why = said.as_ref().and_then(|e| e.get("message")).and_then(Value::as_str);
                Err(why.unwrap_or("the page's browser refused it").to_owned())
            };
            self.host.web_answered(&self.surface, message_id, answer);
        }
    }
}

impl WebHost {
    /// Send DevTools `method` to the browser of view `view`: its answer comes on what this
    /// returns, or never when the view ends first (the sender goes with it).
    pub fn web_call(
        &self,
        view: &str,
        method: &str,
        params: Value,
    ) -> Result<mpsc::Receiver<Answer>, WebError> {
        let browser = self.web_browser(view)?;
        let host = browser.host().ok_or_else(|| missing(view))?;
        let window = (self.inner().web.host_of(view)).ok_or_else(|| missing(view))?;
        let watching = (self.inner().web.by_host.get(&window))
            .and_then(|v| v.calls.watch.as_ref())
            .is_some_and(|(of, _)| *of == browser.identifier());
        if !watching {
            let mut watch = PageWatch::new(self.clone(), surface_of(&window));
            let registration = host.add_dev_tools_message_observer(Some(&mut watch));
            if let Some(web) = self.inner().web.by_host.get_mut(&window) {
                web.calls.watch = registration.map(|r| (browser.identifier(), r));
            }
        }
        let (sent, answered) = mpsc::channel();
        let id = {
            let mut inner = self.inner();
            let web = (inner.web.by_host.get_mut(&window)).ok_or_else(|| missing(view))?;
            let id = FIRST_ID + web.calls.next;
            web.calls.next = (web.calls.next + 1) % 100_000;
            web.calls.waiting.insert(id, sent);
            id
        };
        // What the page does with it is painted on the desk's next frames, as after input.
        frames::heard(browser.identifier(), false);
        let message = json!({ "id": id, "method": method, "params": params }).to_string();
        if host.send_dev_tools_message(Some(message.as_bytes())) != 1 {
            if let Some(web) = self.inner().web.by_host.get_mut(&window) {
                web.calls.waiting.remove(&id);
            }
            return Err(WebError::Failed(format!(
                "the page's browser did not take {method}"
            )));
        }
        Ok(answered)
    }

    /// DevTools call `id` of view surface `surface` was answered: who waits for it hears.
    fn web_answered(&self, surface: &str, id: i32, answer: Answer) {
        let waiting = host_of(surface).and_then(|host| {
            let mut inner = self.inner();
            let web = inner.web.by_host.get_mut(host)?;
            web.calls.waiting.remove(&id)
        });
        if let Some(waiting) = waiting {
            let _ = waiting.send(answer);
        }
    }

    /// Press the page of view `view` once with the pointer at `(x, y)`, CSS pixels from its top
    /// left. The view does not take the desk's keys for it, as it would for the person's press.
    pub fn web_press(&self, view: &str, x: f64, y: f64) -> Result<(), WebError> {
        let browser = self.web_browser(view)?;
        let host = browser.host().ok_or_else(|| missing(view))?;
        let window = (self.inner().web.host_of(view)).ok_or_else(|| missing(view))?;
        let at = Vec2::new(x as f32, y as f32);
        for press in presses(&surface_of(&window), at, Button::Left) {
            input::deliver(&host, &press, &mut None, 0.0);
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "web_page_tests.rs"]
mod tests;
