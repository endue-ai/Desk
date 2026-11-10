//! One chord: the modifiers held and one key, the unit a key sequence is made of (ADR 0118), named
//! as `packages/runtime/src/sequences/chord.ts` names it: "Meta+Shift+K", "Escape". `Mod` is Meta on
//! macOS and Control elsewhere.

/// A key press as the keymap reads it: the DOM's `KeyboardEvent.key` and `.code`, and the modifiers.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KeyLike {
    pub key: String,
    /// The physical key (`KeyD`, `Digit1`), when known.
    pub code: Option<String>,
    pub meta: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// A held key repeating.
    pub repeat: bool,
}

/// Where the keys are read: macOS names `Mod` Meta, every other platform Control.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Platform {
    Mac,
    Other,
}

impl Platform {
    /// The platform this build runs on.
    pub fn current() -> Platform {
        if cfg!(target_os = "macos") {
            Platform::Mac
        } else {
            Platform::Other
        }
    }
}

const MODIFIERS: [&str; 4] = ["Meta", "Control", "Alt", "Shift"];

/// Keys that are only modifiers: pressing one alone is not a chord.
pub fn is_modifier_key(key: &str) -> bool {
    MODIFIERS.contains(&key) || key == "OS"
}

/// What Shift makes of a key on a US keyboard, back to the key: ⇧/ arrives as "?", ⇧1 as "!".
const UNSHIFTED: [(&str, &str); 21] = [
    ("?", "/"),
    (">", "."),
    ("<", ","),
    (":", ";"),
    ("\"", "'"),
    ("{", "["),
    ("}", "]"),
    ("|", "\\"),
    ("_", "-"),
    ("+", "="),
    ("~", "`"),
    ("!", "1"),
    ("@", "2"),
    ("#", "3"),
    ("$", "4"),
    ("%", "5"),
    ("^", "6"),
    ("&", "7"),
    ("*", "8"),
    ("(", "9"),
    (")", "0"),
];

/// The canonical name of a key press, modifiers in a fixed order: "Meta+Shift+K", "Escape".
pub fn combo_of(event: &KeyLike) -> String {
    let held = [event.meta, event.ctrl, event.alt, event.shift];
    let mut parts: Vec<String> = MODIFIERS
        .iter()
        .zip(held)
        .filter(|(_, on)| *on)
        .map(|(m, _)| (*m).to_owned())
        .collect();
    parts.push(key_name(event));
    parts.join("+")
}

fn key_name(event: &KeyLike) -> String {
    // The persisted grammar separates chords with a space: the space bar is named.
    if event.key == " " {
        return "Space".to_owned();
    }
    let code = event.code.as_deref().unwrap_or("");
    // With Shift a digit is named by its key, so Mod+Shift+1 matches ⇧⌘1 whatever the layout puts
    // on it; with Shift a punctuation key is named by the key (⌘⇧/ arrives as "?").
    if event.shift {
        if let Some(digit) = code
            .strip_prefix("Digit")
            .filter(|d| is_one_of(d, '0'..='9'))
        {
            return digit.to_owned();
        }
        if let Some((_, key)) = UNSHIFTED.iter().find(|(shifted, _)| *shifted == event.key) {
            return (*key).to_owned();
        }
    }
    // macOS composes Option+letter into another character (⌥D is ∂): with Alt, a letter or digit
    // key is named by the key itself.
    if event.alt {
        let letter = code.strip_prefix("Key").filter(|l| is_one_of(l, 'A'..='Z'));
        let digit = code
            .strip_prefix("Digit")
            .filter(|d| is_one_of(d, '0'..='9'));
        if let Some(physical) = letter.or(digit) {
            return physical.to_owned();
        }
    }
    if event.key.chars().count() == 1 {
        event.key.to_uppercase()
    } else {
        event.key.clone()
    }
}

fn is_one_of(text: &str, range: std::ops::RangeInclusive<char>) -> bool {
    let mut chars = text.chars();
    matches!((chars.next(), chars.next()), (Some(c), None) if range.contains(&c))
}

const NAMES: [&str; 8] = [
    "Mod", "Meta", "Control", "Ctrl", "Cmd", "Alt", "Option", "Shift",
];

/// A chord's modifiers as written and its key (which may itself be `+`).
pub fn split_chord(chord: &str) -> (Vec<String>, String) {
    let mut rest = chord.trim();
    let mut mods = Vec::new();
    while let Some(name) = NAMES.iter().find(|name| {
        rest.strip_prefix(**name)
            .is_some_and(|after| after.starts_with('+') && after.len() > 1)
    }) {
        mods.push((*name).to_owned());
        rest = &rest[name.len() + 1..];
    }
    (mods, rest.to_owned())
}

/// "Mod+Shift+k" → "Meta+Shift+K" on macOS, "Control+Shift+K" elsewhere.
pub fn canonical_chord(chord: &str, platform: Platform) -> String {
    let (names, key) = split_chord(chord);
    let mods: Vec<&str> = names
        .iter()
        .map(|name| match name.as_str() {
            "Mod" if platform == Platform::Mac => "Meta",
            "Mod" | "Ctrl" => "Control",
            "Cmd" => "Meta",
            "Option" => "Alt",
            other => other,
        })
        .collect();
    combo_of(&KeyLike {
        key,
        meta: mods.contains(&"Meta"),
        ctrl: mods.contains(&"Control"),
        alt: mods.contains(&"Alt"),
        shift: mods.contains(&"Shift"),
        ..KeyLike::default()
    })
}

fn mac_symbol(name: &str) -> Option<&'static str> {
    Some(match name {
        "Meta" => "⌘",
        "Control" => "⌃",
        "Alt" => "⌥",
        "Shift" => "⇧",
        "Escape" => "Esc",
        "ArrowUp" => "↑",
        "ArrowDown" => "↓",
        "ArrowLeft" => "←",
        "ArrowRight" => "→",
        "Enter" => "↩",
        _ => return None,
    })
}

/// How a canonical chord reads: "⇧⌘K" on macOS, "Ctrl+Shift+K" elsewhere.
pub fn format_chord(chord: &str, platform: Platform) -> String {
    let (mods, key) = split_chord(chord);
    if platform == Platform::Other {
        let mut parts: Vec<String> = mods
            .iter()
            .map(|m| {
                if m == "Control" {
                    "Ctrl".into()
                } else {
                    m.clone()
                }
            })
            .collect();
        parts.push(key);
        return parts.join("+");
    }
    let mut out: String = ["Control", "Alt", "Shift", "Meta"]
        .iter()
        .filter(|m| mods.iter().any(|held| held == *m))
        .filter_map(|m| mac_symbol(m))
        .collect();
    out.push_str(mac_symbol(&key).unwrap_or(&key));
    out
}

/// Whether a canonical chord holds Meta, Control or Alt (what a plugin frame forwards).
pub fn is_chorded(chord: &str) -> bool {
    let (mods, _) = split_chord(chord);
    mods.iter()
        .any(|m| m == "Meta" || m == "Control" || m == "Alt")
}
