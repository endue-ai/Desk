//! The key that summons Eris anywhere (ADR 0121): `Alt+Enter` (⌥↩ on macOS) unless
//! `DESK_ERIS_SHORTCUT` or the setting `endue.eris.shortcut` names another, how people read it,
//! and what the desk says when another app holds it.

/// The default, which the person asked for. Slack and Excel use ⌥↩ for a new line; ADR 0121.
pub const DEFAULT: &str = "Alt+Enter";

/// The shortcut in force: the environment's, else the setting's, else `Alt+Enter`. Blank ones do
/// not count.
pub fn chosen(env: Option<&str>, setting: Option<&str>) -> String {
    [env, setting]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or(DEFAULT)
        .to_owned()
}

/// How people read a shortcut: macOS's symbols (`⌥↩`), elsewhere the keys joined by `+`
/// (`Alt+Enter`).
pub fn label(shortcut: &str, mac: bool) -> String {
    let keys = shortcut.split('+').map(str::trim).filter(|k| !k.is_empty());
    if mac {
        keys.map(|key| mac_key(key).unwrap_or_else(|| plain(key)))
            .collect()
    } else {
        keys.map(|key| other_key(key).unwrap_or_else(|| plain(key)))
            .collect::<Vec<_>>()
            .join("+")
    }
}

fn mac_key(key: &str) -> Option<String> {
    let symbol = match key.to_ascii_lowercase().as_str() {
        "alt" | "option" => "⌥",
        "shift" => "⇧",
        "control" | "ctrl" => "⌃",
        "command" | "cmd" | "super" | "meta" | "commandorcontrol" | "cmdorctrl"
        | "commandorctrl" | "cmdorcontrol" => "⌘",
        "enter" | "return" => "↩",
        "escape" | "esc" => "⎋",
        "tab" => "⇥",
        "backspace" => "⌫",
        "space" => "Space",
        _ => return None,
    };
    Some(symbol.to_owned())
}

fn other_key(key: &str) -> Option<String> {
    let name = match key.to_ascii_lowercase().as_str() {
        "alt" | "option" => "Alt",
        "control" | "ctrl" | "commandorcontrol" | "cmdorctrl" | "commandorctrl"
        | "cmdorcontrol" => "Ctrl",
        "super" | "meta" | "command" | "cmd" => "Super",
        "enter" | "return" => "Enter",
        "escape" | "esc" => "Esc",
        _ => return None,
    };
    Some(name.to_owned())
}

/// A key without a symbol: `KeyE` and `Digit1` as the letter and the digit, the rest as written.
fn plain(key: &str) -> String {
    let short = key
        .strip_prefix("Key")
        .or_else(|| key.strip_prefix("Digit"))
        .filter(|rest| rest.len() == 1)
        .unwrap_or(key);
    if short.len() == 1 {
        short.to_ascii_uppercase()
    } else {
        short.to_owned()
    }
}

/// The notice when the shortcut cannot be registered: which key, why, and the two ways to reach
/// her still (the tray, another key).
pub fn taken(shortcut: &str, mac: bool, why: &str) -> (String, String) {
    let key = label(shortcut, mac);
    let title = format!("{key} cannot summon Eris");
    let body = format!(
        "The desk could not take {key} for Eris ({why}); another app may use it. Talk to Eris \
         from the tray, or choose another key with endue.eris.shortcut in init.yaml or \
         DESK_ERIS_SHORTCUT."
    );
    (title, body)
}
