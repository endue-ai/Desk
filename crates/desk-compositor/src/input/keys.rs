//! Keys (`input.md` § Keyboard and focus): every key goes to the focused surface, after the desk's
//! keymap had its say. While a prefix is pending every key is the desk's (ADR 0118: the plain keys
//! after `Ctrl+C` reach the desk even while a plugin has the focus). Otherwise only chords with Meta,
//! Control or Alt are asked, the keys a plugin frame forwarded in Stage 1: one the keymap binds is
//! the desk's and never reaches the surface; every other key does, Escape included (the SDK still
//! hands on what the plugin leaves). A key's release goes where its press went. The shell page that
//! still holds the windows (the underlay, until #53) runs the keymap itself, so its keys reach it.

use std::time::Instant;

use super::events::{KeyInput, key_like};
use super::keymap::{KeyDecision, combo_of, is_chorded, is_modifier_key};
use super::messages as msg;
use super::router::{InputRouter, Out, dnd_outs};

/// Whether `text` is text a press types (not the control character a key like Backspace makes,
/// nor macOS's private function-key characters), with no Control or Meta held.
fn typed(text: &str, ctrl_or_meta: bool) -> bool {
    !ctrl_or_meta
        && !text.is_empty()
        && text.chars().all(|c| {
            let control = c.is_control() && c != '\r' && c != '\t';
            let function = ('\u{f700}'..='\u{f8ff}').contains(&c);
            !control && !function
        })
}

impl InputRouter {
    pub(super) fn key(&mut self, key: &KeyInput, now: Instant) -> Vec<Out> {
        // Before anything had the focus, the keys are the underlay's: the page that holds the rest.
        let Some(focus) = self
            .focus
            .clone()
            .or_else(|| self.settings.underlay.clone())
        else {
            return Vec::new();
        };
        let mods = self.mods;
        if !key.pressed {
            return match self.keys_down.remove(&key.code) {
                Some(None) => Vec::new(),
                Some(Some(surface)) => {
                    vec![Out::Send(msg::key_up(&surface, &key.key, &key.code, mods))]
                }
                None => vec![Out::Send(msg::key_up(&focus, &key.key, &key.code, mods))],
            };
        }
        // Escape ends a drag from a surface: nothing is dropped.
        if key.key == "Escape" && self.broker.active() && !self.broker.from_os() {
            self.keys_down.insert(key.code.clone(), None);
            return dnd_outs(self.broker.cancel());
        }
        let like = key_like(key, mods);
        let waiting = !self.keymap.pending().is_empty();
        let ask = waiting || (!is_modifier_key(&key.key) && is_chorded(&combo_of(&like)));
        let decision = if ask {
            let ms = self.millis(now);
            self.keymap.press(&like, Some(&focus), ms)
        } else {
            KeyDecision::PassOn
        };
        // The desk runs a command for it (⌘K opens the palette): what is typed next waits for the
        // page to say where that left the keys (`hold.rs`).
        if matches!(decision, KeyDecision::Run { .. }) {
            self.hold_keys(now);
        }
        // The page runs its keymap itself, on its own pages as well (ADR 0201), so its keys reach it.
        let underlay = self.settings.page_owned(&focus);
        if decision.is_desks() && !underlay {
            self.keys_down.insert(key.code.clone(), None);
            return vec![Out::DeskKey {
                surface: focus,
                key: like,
                decision,
            }];
        }
        self.keys_down.insert(key.code.clone(), Some(focus.clone()));
        let mut out = vec![Out::Send(msg::key_down(
            &focus, &key.key, &key.code, mods, key.repeat,
        ))];
        if let Some(text) = key
            .text
            .as_deref()
            .filter(|t| typed(t, mods.ctrl || mods.meta))
        {
            out.push(Out::Send(msg::key_char(&focus, text, mods)));
        }
        out
    }
}
