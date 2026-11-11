//! Chromium features the desk turns off in its browser process, added to `--disable-features` before
//! Chromium reads its command line (`app.rs`); Chromium passes the feature state on to every
//! subprocess itself.
//!
//! macOS: Chromium's code-sign clone (`MacAppCodeSignClone`, `chrome/browser/mac/
//! code_sign_clone_manager.mm`) hard-links the desk's executable into a copy of its bundle under the
//! per-user temporary folder (`X/ai.endue.desk.code_sign_clone`) at every start and removes it once
//! the desk has quit. Making and removing that link changes the executable's inode, so at the next
//! start macOS's exec policy (`syspolicyd`) treats it as a binary it has not seen: an XProtect scan
//! of the whole executable and a notarization ticket lookup before `main` runs, 1.4 s for a
//! development build, in two starts in five (#112). The copy keeps a running browser's code
//! signature valid while an update replaces its bundle underneath it, which the desk never runs
//! through: it quits as soon as it has applied an update and starts the new one (ADR 0147). A desk
//! that was killed left its copy behind for good, holding the replaced build's files on disk.
//!
//! Everywhere: Chromium's `LimitPopupWidgetHostPosition` keeps the top of a page's popup widget (a
//! select's list, a date, time or colour picker) at or below the top of the page's view, the line
//! of death under a browser's address bar (crbug.com/424995036). On the desk a view is a window's
//! pane, so a picker in a window low in the app could not open above its field: it covered the
//! field and ran on past the app's bottom (#156, B6b). Here a popup lies past its pane as it would
//! on a desktop, above the windows, and the desk's own bars, notices, dialogs and prompts are drawn
//! above every popup (`compositor_window/draw_popup.rs`), so no page's popup covers what the desk
//! says.

use cef::{CefString, ImplCommandLine};

/// The switch Chromium reads the features to turn off from.
pub const SWITCH: &str = "disable-features";

/// Chromium's limit on where a page's popup widget may go.
const POPUP_LIMIT: &str = "LimitPopupWidgetHostPosition";

/// The features the desk turns off on this OS, by Chromium's names.
pub const DISABLED: &[&str] = if cfg!(target_os = "macos") {
    &["MacAppCodeSignClone", POPUP_LIMIT]
} else {
    &[POPUP_LIMIT]
};

/// `--disable-features` holding what it held (`given`, comma-separated as Chromium writes it) and
/// `add`, each once and in that order; `None` when both are empty.
pub fn merged(given: Option<&str>, add: &[&str]) -> Option<String> {
    let mut all: Vec<&str> = given
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect();
    for name in add {
        if !all.contains(name) {
            all.push(name);
        }
    }
    (!all.is_empty()).then(|| all.join(","))
}

/// Add [`DISABLED`] to the browser process's `--disable-features`, keeping what it already names.
pub fn disable(command_line: &mut cef::CommandLine) {
    if DISABLED.is_empty() {
        return;
    }
    let switch = CefString::from(SWITCH);
    let given = (command_line.has_switch(Some(&switch)) == 1)
        .then(|| CefString::from(&command_line.switch_value(Some(&switch))).to_string());
    if let Some(value) = merged(given.as_deref(), DISABLED) {
        command_line.remove_switch(Some(&switch));
        command_line.append_switch_with_value(Some(&switch), Some(&value.as_str().into()));
    }
}

#[cfg(test)]
mod tests {
    use super::{DISABLED, merged};

    #[test]
    fn on_macos_the_desk_turns_off_chromiums_code_sign_clone() {
        assert_eq!(
            DISABLED.contains(&"MacAppCodeSignClone"),
            cfg!(target_os = "macos")
        );
    }

    #[test]
    fn everywhere_a_pages_popup_may_open_above_the_top_of_its_view() {
        assert!(DISABLED.contains(&"LimitPopupWidgetHostPosition"));
    }

    #[test]
    fn the_features_join_what_the_switch_already_names() {
        let add = ["MacAppCodeSignClone"];
        assert_eq!(merged(None, &add).as_deref(), Some("MacAppCodeSignClone"));
        assert_eq!(
            merged(Some("Translate,BackForwardCache"), &add).as_deref(),
            Some("Translate,BackForwardCache,MacAppCodeSignClone")
        );
        // Named already, or given with spaces and empty entries: each once, nothing empty.
        assert_eq!(
            merged(Some(" MacAppCodeSignClone ,,Translate"), &add).as_deref(),
            Some("MacAppCodeSignClone,Translate")
        );
        assert_eq!(merged(Some(""), &[]), None);
        assert_eq!(merged(Some("Translate"), &[]).as_deref(), Some("Translate"));
    }
}
