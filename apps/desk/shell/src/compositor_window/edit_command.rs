//! The desk's `desk.edit.*` commands (ADR 0296): Copy, Cut, Paste, Paste and Match Style, Select
//! All, Undo and Redo, run on whatever has the keys, wherever the key a person bound to one is. The
//! runtime sends `compositor_edit_command { command }`; the surface with the router's focus (a
//! plugin's page, a window's own page) runs it in its focused frame, else the desk's own page does.

use cef::{Browser, ImplBrowser};

use super::{CompositorWindow, PAGE};
use crate::web_host::input::edit_keys::{EDIT_MENU, run_in};

/// Blink's name of a `desk.edit.*` command's last part (`copy`, `select-all`, `paste-and-match-style`).
pub fn blink_command(name: &str) -> Option<&'static str> {
    let wanted: String = name
        .split('-')
        .map(|part| {
            let mut chars = part.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect();
    EDIT_MENU.iter().copied().find(|command| *command == wanted)
}

impl CompositorWindow {
    /// Run `command` (Blink's name) where the keys are: whether something ran it.
    pub fn page_edit_command(&mut self, command: &str) -> bool {
        let surface = self.router.focused().filter(|s| *s != PAGE).map(str::to_owned);
        let browser: Option<Browser> = surface
            .and_then(|surface| self.host.browser(&surface))
            .or_else(|| self.browser.clone());
        let Some(frame) = browser
            .as_ref()
            .and_then(|b| b.focused_frame().or_else(|| b.main_frame()))
        else {
            return false;
        };
        run_in(&frame, command)
    }
}

#[cfg(test)]
mod tests {
    use super::blink_command;

    #[test]
    fn a_commands_last_part_names_blinks_edit_command() {
        assert_eq!(blink_command("copy"), Some("Copy"));
        assert_eq!(blink_command("select-all"), Some("SelectAll"));
        assert_eq!(
            blink_command("paste-and-match-style"),
            Some("PasteAndMatchStyle")
        );
        assert_eq!(blink_command("delete-everything"), None);
    }
}
