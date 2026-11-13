//! Eris's shortcut (ADR 0121): the key in force and how it reads, and where it talks to her when the
//! island does not (ADR 0204).

use super::shortcut::{self, chosen, label, taken};
use super::{Talk, where_to};

#[test]
fn without_the_island_the_shortcut_talks_in_the_desk_bringing_it_forward_when_needed() {
    assert_eq!(where_to(true), Talk::InDesk);
    assert_eq!(where_to(false), Talk::DeskForward);
}

#[test]
fn the_shortcut_is_the_environments_then_the_settings_then_alt_enter() {
    assert_eq!(chosen(None, None), shortcut::DEFAULT);
    assert_eq!(chosen(None, Some("Alt+Space")), "Alt+Space");
    assert_eq!(
        chosen(Some("Control+Shift+E"), Some("Alt+Space")),
        "Control+Shift+E"
    );
    assert_eq!(chosen(Some(" "), Some("")), "Alt+Enter");
}

#[test]
fn the_shortcut_reads_as_symbols_on_macos() {
    assert_eq!(label("Alt+Enter", true), "⌥↩");
    assert_eq!(label("CommandOrControl+Shift+KeyE", true), "⌘⇧E");
    assert_eq!(label("Alt+Enter", false), "Alt+Enter");
    assert_eq!(label("CmdOrCtrl+Shift+Digit1", false), "Ctrl+Shift+1");
    let (title, body) = taken("Alt+Enter", true, "already registered");
    assert_eq!(title, "⌥↩ cannot summon Eris");
    assert!(body.contains("Talk to Eris"), "{body}");
    assert!(body.contains("endue.eris.shortcut"), "{body}");
    assert!(body.contains("already registered"), "{body}");
}
