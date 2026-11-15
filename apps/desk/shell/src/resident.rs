//! endue stays when its windows go (#237, ADR 0225). Closing the desk's window hides it and the
//! process runs on: the core, the runtime's page, the island and the shortcuts. Three things keep
//! the hidden page working. Chromium throttles a hidden page's timers (to one a second, and to one
//! a minute after five minutes) and lowers its renderer's priority; `SWITCHES` turn both off, for
//! the desk's page and for every plugin's, whose work an agent may be waiting for. The shell says
//! itself that the window went or came (`main_seen`), without waiting for the OS, which says
//! nothing of a window that never showed or of a locked screen. And a start by the login item
//! (`--background`, `desk_sys::login`) opens the window hidden: nothing comes in front at login.

use std::sync::OnceLock;

use desk_web::sender::Role;
use serde_json::Value;

use crate::pane::Pane;
use crate::window::Shell;

/// Chromium's switches for pages nobody sees: timers at their own pace, renderers at their own
/// priority.
pub const SWITCHES: [&str; 2] = [
    "disable-background-timer-throttling",
    "disable-renderer-backgrounding",
];

/// Whether this desk was started by its login item: it opens no window.
pub fn background() -> bool {
    static BACKGROUND: OnceLock<bool> = OnceLock::new();
    *BACKGROUND.get_or_init(|| desk_sys::login::launched_at_login(std::env::args_os()))
}

/// Whether a second start that handed over `args` was the login item's: the desk stays as it is.
pub fn handed_in_background(args: &[String]) -> bool {
    desk_sys::login::launched_at_login(args)
}

impl Shell {
    /// The desk showed or hid its main window: the scene and its pages follow now.
    pub(crate) fn main_seen(&mut self, seen: bool) {
        if let Some(compositor) = self.compositor.as_mut() {
            compositor.occluded(!seen);
        }
        crate::eris_window::main_changed(self);
    }

    /// Hide the main window: its red button, which leaves the desk running.
    pub(crate) fn hide_main(&mut self) {
        if let Some(main) = self.pane(Role::Main) {
            main.hide();
        }
        self.main_seen(false);
    }

    /// Bring the main window forward, from hidden or minimized too.
    pub(crate) fn focus_main(&mut self) {
        let Some(main) = self.pane(Role::Main) else {
            return;
        };
        let hidden = !main.visible();
        main.window.set_minimized(false);
        main.show_and_focus();
        self.main_back(hidden);
    }

    /// Show the main window without giving it the keys (the palette keeps them).
    pub(crate) fn show_main(&mut self) {
        let Some(main) = self.pane(Role::Main) else {
            return;
        };
        let hidden = !main.visible();
        main.window.set_minimized(false);
        main.window.set_visible(true);
        self.main_back(hidden);
    }

    /// The main window is back. From `hidden`, which the shell said itself, the shell says it
    /// shows; from minimized or behind other windows the OS says when it does, as before.
    fn main_back(&mut self, hidden: bool) {
        if hidden {
            self.main_seen(true);
        } else {
            crate::eris_window::main_changed(self);
        }
    }

    /// Files dropped on a window out of the desk: the desk's page opens them, and a hidden desk
    /// comes forward, since their windows open there.
    pub(crate) fn open_dropped(&mut self, paths: Vec<String>) {
        if !self.desk.opened.push(paths) {
            return;
        }
        let event = crate::open_files::EVENT;
        self.desk.pages.emit(Role::Main, event, Value::Null);
        if !self.pane(Role::Main).is_some_and(Pane::visible) {
            self.focus_main();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SWITCHES, handed_in_background};

    #[test]
    fn hidden_pages_keep_their_timers_and_their_renderers_priority() {
        assert!(SWITCHES.contains(&"disable-background-timer-throttling"));
        assert!(SWITCHES.contains(&"disable-renderer-backgrounding"));
    }

    #[test]
    fn only_the_login_items_start_is_in_the_background() {
        let args = |list: &[&str]| list.iter().map(|a| (*a).to_owned()).collect::<Vec<_>>();
        assert!(handed_in_background(&args(&["endue-desk", "--background"])));
        assert!(!handed_in_background(&args(&["endue-desk"])));
        assert!(!handed_in_background(&args(&["endue-desk", "/tmp/a.md"])));
        // The program's own name is no argument.
        assert!(!handed_in_background(&args(&["--background"])));
    }
}
