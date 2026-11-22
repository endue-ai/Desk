//! The clipboard of a plugin surface's page (#504, ADR 0318). Chromium lets a page write the
//! clipboard only while it has the focus and a transient activation (the five seconds after a key
//! or a press in it), and asks the embedder whenever a page wants more: a read, or a write without
//! the activation. CEF leaves that question unanswered when the embedder has no handler, so the
//! page's `navigator.clipboard` promise never settled. Here every such question from a plugin page
//! is refused: no plugin reads the clipboard but through a paste (whose event carries its own text),
//! and none writes it on its own.
//!
//! What a person does in the palette for a plugin counts as their act in its page: the palette
//! running one of its commands (`cmd.invoked` whose caller is a palette) and the palette answering
//! a question the plugin asked (`cmd.answered` of `desk.palette.pick`). As the relay carries either
//! down, the surface's browser gets one transient activation (DevTools' `Runtime.evaluate` with a
//! user gesture), as a press on the plugin's own button would give it. Only the runtime's page
//! posts down the relay and the core names the caller from the page that called, so a plugin
//! cannot make one up; a command an agent, another plugin or the CLI runs gives none.
//!
//! The focus stays where the compositor put it (the keys follow the window in use, ADR 0192): a
//! surface it does not give the keys to has its page's focus lent for as long as the activation
//! lasts, and taken back after unless the compositor gave it the keys meanwhile. A lent focus gets
//! no keys; it is only what Chromium asks of a page that writes the clipboard.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

use cef::*;
use serde_json::{Value, json};

/// The pages that run a command only when the person picks it: the desk's palette surface and the
/// shell's own palette window.
const PALETTES: [&str; 2] = ["desk.palette", "palette"];

/// The palette's question a plugin asks (`ask.js` in the database plugin, for one).
const PICK: &str = "desk.palette.pick";

/// The DevTools message id of an activation, clear of the accessibility agent's (570 000 on).
const ACTIVATION_ID: i32 = 590_000;

/// Whether `text`, a message the runtime posts down to a surface, is the person's act in the
/// palette for that surface's plugin.
pub fn palette_act(text: &str) -> bool {
    if !text.contains("\"cmd.invoked\"") && !text.contains("\"cmd.answered\"") {
        return false;
    }
    let Ok(message) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    if message.get("type").and_then(Value::as_str) != Some("desk:event") {
        return false;
    }
    let event = message.get("event");
    let name = event.and_then(|e| e.get("event")).and_then(Value::as_str);
    let data = event.and_then(|e| e.get("data"));
    let field = |key: &str| data.and_then(|d| d.get(key));
    match name {
        Some("cmd.invoked") => field("caller")
            .and_then(Value::as_str)
            .is_some_and(|caller| PALETTES.contains(&caller)),
        Some("cmd.answered") => {
            field("id").and_then(Value::as_str) == Some(PICK)
                && field("ok").and_then(Value::as_bool) == Some(true)
        }
        _ => false,
    }
}

/// The DevTools message that gives a page one transient activation and does nothing else.
pub fn activation() -> String {
    json!({
        "id": ACTIVATION_ID,
        "method": "Runtime.evaluate",
        "params": { "expression": "0", "userGesture": true, "silent": true },
    })
    .to_string()
}

/// How long a lent focus lasts: Chromium's transient activation, five seconds.
const LEND_MS: i64 = 5_000;

/// By browser: whether the compositor gives its surface the keys, and its latest lend's number.
#[derive(Clone, Copy, Default)]
struct Focus {
    held: bool,
    lend: u64,
}

static FOCUS: Mutex<BTreeMap<i32, Focus>> = Mutex::new(BTreeMap::new());

fn focus() -> MutexGuard<'static, BTreeMap<i32, Focus>> {
    FOCUS.lock().unwrap_or_else(|e| e.into_inner())
}

/// The compositor gave browser `id`'s surface the keys (`held`), or took them (`input.rs`).
pub fn held(id: i32, held: bool) {
    let mut focus = focus();
    if held {
        focus.entry(id).or_default().held = true;
    } else if let Some(f) = focus.get_mut(&id) {
        f.held = false;
    }
}

/// A lend of the focus to browser `id`, unless its surface has the keys: its number.
fn lend(id: i32) -> Option<u64> {
    let mut focus = focus();
    let f = focus.entry(id).or_default();
    if f.held {
        return None;
    }
    f.lend += 1;
    Some(f.lend)
}

/// Whether lend `lend` of browser `id` is the latest and its surface still has no keys.
fn lend_ends(id: i32, lend: u64) -> bool {
    focus().get(&id).is_some_and(|f| !f.held && f.lend == lend)
}

/// Give `browser`'s page the activation a press in it would give, and the focus with it.
pub fn activate(browser: &Browser) {
    let Some(host) = browser.host() else { return };
    host.send_dev_tools_message(Some(activation().as_bytes()));
    if let Some(lend) = lend(browser.identifier()) {
        host.set_focus(1);
        let mut ends = LendEnds::new(browser.clone(), lend);
        post_delayed_task(ThreadId::UI, Some(&mut ends), LEND_MS);
    }
}

// The lent focus goes back, unless the compositor gave the surface the keys or lent it again.
wrap_task! {
    struct LendEnds {
        browser: Browser,
        lend: u64,
    }

    impl Task {
        fn execute(&self) {
            if lend_ends(self.browser.identifier(), self.lend)
                && let Some(host) = self.browser.host()
            {
                host.set_focus(0);
            }
        }
    }
}

wrap_permission_handler! {
    pub struct SurfacePermissions;

    impl PermissionHandler {
        // A read of the clipboard, or a write without an activation: refused, never left open.
        fn on_show_permission_prompt(
            &self,
            _browser: Option<&mut Browser>,
            _prompt_id: u64,
            _requesting_origin: Option<&CefString>,
            requested_permissions: u32,
            callback: Option<&mut PermissionPromptCallback>,
        ) -> ::std::os::raw::c_int {
            if !asks_clipboard(requested_permissions) {
                return 0;
            }
            if let Some(callback) = callback {
                let deny = sys::cef_permission_request_result_t::CEF_PERMISSION_RESULT_DENY;
                callback.cont(PermissionRequestResult::from(deny));
            }
            1
        }
    }
}

/// Whether a prompt's permissions hold the clipboard's.
pub fn asks_clipboard(requested: u32) -> bool {
    let clipboard = sys::cef_permission_request_types_t::CEF_PERMISSION_TYPE_CLIPBOARD as u32;
    requested & clipboard != 0
}

#[cfg(test)]
mod tests {
    use super::{activation, asks_clipboard, held, lend, lend_ends, palette_act};

    fn event(name: &str, data: &str) -> String {
        format!(r#"{{"type":"desk:event","event":{{"event":"{name}","data":{data}}}}}"#)
    }

    #[test]
    fn a_command_the_palette_runs_is_the_persons_act() {
        let invoked = |caller: &str| {
            event(
                "cmd.invoked",
                &format!(
                    r#"{{"invocationId":"i-1","id":"endue.database.copy","caller":"{caller}"}}"#
                ),
            )
        };
        assert!(palette_act(&invoked("desk.palette")));
        assert!(palette_act(&invoked("palette")));
        for caller in ["endue.eris", "cli", "endue.database", "desk.shell", "mcp"] {
            assert!(!palette_act(&invoked(caller)), "{caller}");
        }
    }

    #[test]
    fn the_palettes_answer_to_a_pick_is_the_persons_act_and_a_cancel_is_not() {
        let answered = |id: &str, ok: bool| {
            event(
                "cmd.answered",
                &format!(
                    r#"{{"invocationId":"i-2","id":"{id}","caller":"endue.database","ok":{ok},"result":"tsv"}}"#
                ),
            )
        };
        assert!(palette_act(&answered("desk.palette.pick", true)));
        assert!(!palette_act(&answered("desk.palette.pick", false)));
        assert!(!palette_act(&answered("endue.database.copy", true)));
    }

    #[test]
    fn other_messages_and_names_inside_them_are_not() {
        assert!(!palette_act(
            r#"{"type":"desk:state","note":"cmd.invoked desk.palette"}"#
        ));
        assert!(!palette_act(r#"{"type":"desk:hello"}"#));
        assert!(!palette_act("cmd.invoked"));
        assert!(!palette_act(&event(
            "perm.changed",
            r#"{"caller":"desk.palette","note":"cmd.invoked"}"#
        )));
    }

    #[test]
    fn the_activation_is_a_gesture_that_runs_nothing() {
        let message: serde_json::Value = serde_json::from_str(&activation()).unwrap();
        assert_eq!(message["method"], "Runtime.evaluate");
        assert_eq!(message["params"]["userGesture"], true);
        assert_eq!(message["params"]["expression"], "0");
    }

    #[test]
    fn the_focus_is_lent_only_to_a_surface_without_the_keys_and_its_latest_lend_ends_it() {
        held(9_001, true);
        assert_eq!(lend(9_001), None, "the compositor gave it the keys");
        held(9_001, false);
        let first = lend(9_001).expect("lent");
        let second = lend(9_001).expect("lent again");
        assert!(!lend_ends(9_001, first), "a later lend keeps it");
        assert!(lend_ends(9_001, second));
        held(9_001, true);
        assert!(!lend_ends(9_001, second), "the keys came meanwhile");
        assert!(!lend_ends(9_002, 1), "never lent");
    }

    #[test]
    fn only_a_clipboard_prompt_is_answered_here() {
        assert!(asks_clipboard(16));
        assert!(asks_clipboard(16 | 1024));
        assert!(!asks_clipboard(0));
        assert!(!asks_clipboard(1024));
    }
}
