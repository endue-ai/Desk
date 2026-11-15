//! The key that opens Search Desk from any app (#304, ADR 0238): `DESK_PALETTE_SHORTCUT`, else the
//! person's `desk.palette.shortcut` (in the core the runtime's own setting `palette.shortcut`, which
//! Settings › Keyboard writes), else ⌘⇧Space. The shell follows the setting while it runs, so a
//! change applies without a restart (`palette.rs`), says so when another app holds the key, and
//! tells Settings what it holds (`HELD_KEY`).

use serde_json::{Value, json};

use crate::eris_window::shortcut::label;
use crate::hotkeys::PALETTE_DEFAULT;

/// Whose setting it is: the runtime's (`desk_web::sender::RUNTIME`).
pub const OWNER: &str = "desk";
/// The setting's key under its owner.
pub const KEY: &str = "palette.shortcut";
/// What the shell holds, for Settings › Keyboard: `{ shortcut, refused: { shortcut, why } | null }`.
pub const HELD_KEY: &str = "palette.shortcut.held";

/// What the shell tells Settings: the key it holds (none when it holds none), and the one it could
/// not have with why.
pub fn held_report(held: Option<&str>, refused: Option<(&str, &str)>) -> Value {
    json!({
        "shortcut": held,
        "refused": refused.map(|(shortcut, why)| json!({ "shortcut": shortcut, "why": why })),
    })
}

/// The shortcut in force: the environment's, else the setting's, else ⌘⇧Space. Blank ones do not
/// count.
pub fn chosen(env: Option<&str>, setting: Option<&str>) -> String {
    [env, setting]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or(PALETTE_DEFAULT)
        .to_owned()
}

/// The notice when the key cannot be held: which key, why, and the two ways to search still.
pub fn taken(shortcut: &str, mac: bool, why: &str) -> (String, String) {
    let key = label(shortcut, mac);
    (
        format!("Search Desk can't use {key}"),
        format!(
            "{why}. Choose another key in Settings › Keyboard, or use Search Desk in the tray."
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::{chosen, held_report, taken};
    use crate::hotkeys::{Action, PALETTE_DEFAULT, Table, parse};
    use serde_json::json;

    #[test]
    fn the_environment_wins_then_the_setting_then_the_default() {
        assert_eq!(chosen(Some("Alt+Space"), Some("Control+KeyK")), "Alt+Space");
        assert_eq!(chosen(None, Some(" Control+KeyK ")), "Control+KeyK");
        assert_eq!(chosen(Some("  "), Some("Control+KeyK")), "Control+KeyK");
        assert_eq!(chosen(None, None), PALETTE_DEFAULT);
        assert_eq!(chosen(None, Some("")), PALETTE_DEFAULT);
    }

    #[test]
    fn a_changed_setting_takes_the_new_key_without_a_restart() {
        let mut table = Table::default();
        let first = parse(&chosen(None, None)).unwrap();
        assert_eq!(table.hold(Action::Palette, first), None);
        // Settings › Keyboard wrote another key: the palette holds it, and the old one is let go.
        let next = parse(&chosen(None, Some("CommandOrControl+Alt+KeyK"))).unwrap();
        assert_eq!(table.taken(Action::Palette, next), None);
        assert_eq!(
            table.hold(Action::Palette, next).map(|k| k.id()),
            Some(first.id())
        );
        assert_eq!(table.action(next.id()), Some(Action::Palette));
        assert_eq!(table.action(first.id()), None);
        // Eris's key is hers: the palette cannot take it.
        let eris = parse("Alt+Enter").unwrap();
        table.hold(Action::Eris, eris);
        assert_eq!(table.taken(Action::Palette, eris), Some(Action::Eris));
    }

    #[test]
    fn settings_hears_the_key_held_and_the_one_refused() {
        assert_eq!(
            held_report(Some("CommandOrControl+Shift+Space"), None),
            json!({ "shortcut": "CommandOrControl+Shift+Space", "refused": null })
        );
        assert_eq!(
            held_report(
                Some("CommandOrControl+Shift+Space"),
                Some(("Alt+KeyK", "another app holds it"))
            ),
            json!({ "shortcut": "CommandOrControl+Shift+Space",
                    "refused": { "shortcut": "Alt+KeyK", "why": "another app holds it" } })
        );
        assert_eq!(held_report(None, None)["shortcut"], json!(null));
    }

    #[test]
    fn a_key_another_app_holds_is_said_in_words() {
        let (title, body) = taken("CommandOrControl+Shift+Space", true, "another app holds it");
        assert_eq!(title, "Search Desk can't use ⌘⇧Space");
        assert!(body.starts_with("another app holds it."), "{body}");
        assert!(body.contains("Settings › Keyboard"), "{body}");
    }
}
