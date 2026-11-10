//! The keyboard focus (`input.md` § Keyboard and focus): one surface at most has it; it hears
//! `focus.out` when the focus moves to another surface, or when the window loses the OS focus, and
//! `focus.in` when it comes back. A composition the focus leaves behind is committed as it stands, a
//! pending prefix is cancelled, and the OS input method drops what it held.

use super::messages as msg;
use super::router::{InputRouter, Out, dnd_outs};

impl InputRouter {
    /// The window manager (or the page that still is one) moved the keyboard focus to `surface`.
    pub fn focus(&mut self, surface: Option<&str>) -> Vec<Out> {
        if self.focus.as_deref() == surface {
            return Vec::new();
        }
        let mut out: Vec<Out> = self.ime.finish().into_iter().map(Out::Send).collect();
        if self.ime_allowed {
            out.push(Out::ImeReset);
        }
        if let Some(old) = self.focus.take()
            && self.window_focused
        {
            out.push(Out::Send(msg::focus(&old, false)));
        }
        self.focus = surface.map(str::to_owned);
        if let Some(new) = surface
            && self.window_focused
        {
            out.push(Out::Send(msg::focus(new, true)));
        }
        out
    }

    pub(super) fn window_focus(&mut self, focused: bool) -> Vec<Out> {
        if self.window_focused == focused {
            return Vec::new();
        }
        let mut out = Vec::new();
        if !focused {
            out.extend(self.ime.finish().into_iter().map(Out::Send));
            out.extend(dnd_outs(self.broker.cancel()));
            self.keymap.cancel();
        }
        self.window_focused = focused;
        if let Some(surface) = self.focus.clone() {
            out.push(Out::Send(msg::focus(&surface, focused)));
        }
        out
    }
}
