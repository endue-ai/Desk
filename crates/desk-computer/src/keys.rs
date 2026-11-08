//! Keys and chords. A chord names its modifiers and one key, `cmd+shift+t`; letters, digits and
//! punctuation are the keys of the US (ANSI) layout, as shortcuts are, whatever layout is active.
//! A shifted symbol is its key with Shift: `cmd+?` is `cmd+shift+/`. Text is typed with
//! `Action::Text`, not as keys, so every script and layout (Korean included) types as written.

use std::fmt;

use crate::{Error, invalid};

/// One key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Key {
    /// A letter, digit or punctuation key of the US layout, in its unshifted form (`a`, `1`, `/`).
    Char(char),
    Return,
    Tab,
    Space,
    /// Backspace.
    Delete,
    ForwardDelete,
    Escape,
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
    PageUp,
    PageDown,
    /// F1 to F20.
    F(u8),
    Command,
    Shift,
    Option,
    Control,
    Function,
}

/// Which modifiers are held.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct Modifiers {
    pub command: bool,
    pub shift: bool,
    pub option: bool,
    pub control: bool,
    pub function: bool,
}

impl Modifiers {
    pub fn is_empty(self) -> bool {
        self == Self::default()
    }

    /// The modifier keys held, in the order a chord presses them.
    pub fn keys(self) -> Vec<Key> {
        [
            (self.control, Key::Control),
            (self.option, Key::Option),
            (self.shift, Key::Shift),
            (self.command, Key::Command),
            (self.function, Key::Function),
        ]
        .into_iter()
        .filter_map(|(held, key)| held.then_some(key))
        .collect()
    }

    /// These modifiers with `key` held too, or released.
    pub fn with(mut self, key: Key, held: bool) -> Self {
        match key {
            Key::Command => self.command = held,
            Key::Shift => self.shift = held,
            Key::Option => self.option = held,
            Key::Control => self.control = held,
            Key::Function => self.function = held,
            _ => {}
        }
        self
    }
}

/// Modifiers and one key, pressed together.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Chord {
    pub modifiers: Modifiers,
    pub key: Key,
}

impl Chord {
    pub fn new(key: Key) -> Self {
        Self {
            modifiers: Modifiers::default(),
            key,
        }
    }

    /// `cmd+shift+t`, `ctrl+a`, `return`, `f5`, `cmd+?`. Names are case-insensitive and joined with
    /// `+` (`cmd++` and `cmd+plus` are Command and `+`). Modifiers: `cmd` `command` `meta` `super`
    /// `⌘`, `shift` `⇧`, `alt` `option` `opt` `⌥`, `ctrl` `control` `⌃`, `fn`. A lone modifier
    /// presses that modifier.
    pub fn parse(text: &str) -> Result<Self, Error> {
        let text = text.trim();
        let bad = || invalid(format!("{text:?} is not a key chord such as cmd+shift+t"));
        let mut parts: Vec<&str> = text.split('+').map(str::trim).collect();
        if text.ends_with("++") || text == "+" {
            parts.retain(|part| !part.is_empty());
            parts.push("+");
        }
        let mut modifiers = Modifiers::default();
        let mut key = None;
        let last = parts.len().saturating_sub(1);
        for (index, part) in parts.iter().enumerate() {
            if part.is_empty() {
                return Err(bad());
            }
            if index < last {
                modifiers = modifiers.with(modifier(part).ok_or_else(bad)?, true);
            } else if let Some(modifier) = modifier(part) {
                key = Some(modifier);
            } else {
                let (base, shifted) = named(part).ok_or_else(bad)?;
                modifiers.shift |= shifted;
                key = Some(base);
            }
        }
        Ok(Self {
            modifiers,
            key: key.ok_or_else(bad)?,
        })
    }
}

impl fmt::Display for Chord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for key in self.modifiers.keys() {
            write!(f, "{}+", name(key))?;
        }
        f.write_str(&name(self.key))
    }
}

fn modifier(part: &str) -> Option<Key> {
    Some(match part.to_lowercase().as_str() {
        "cmd" | "command" | "meta" | "super" | "⌘" => Key::Command,
        "shift" | "⇧" => Key::Shift,
        "alt" | "option" | "opt" | "⌥" => Key::Option,
        "ctrl" | "control" | "⌃" => Key::Control,
        "fn" => Key::Function,
        _ => return None,
    })
}

/// A key by name, and whether it needs Shift.
fn named(part: &str) -> Option<(Key, bool)> {
    let lower = part.to_lowercase();
    let key = match lower.as_str() {
        "return" | "enter" => Key::Return,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "delete" | "backspace" => Key::Delete,
        "forwarddelete" | "del" => Key::ForwardDelete,
        "escape" | "esc" => Key::Escape,
        "left" | "arrowleft" => Key::Left,
        "right" | "arrowright" => Key::Right,
        "up" | "arrowup" => Key::Up,
        "down" | "arrowdown" => Key::Down,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "plus" => return Some((Key::Char('='), true)),
        "minus" => Key::Char('-'),
        _ => {
            if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()) {
                return (1..=20).contains(&n).then_some((Key::F(n), false));
            }
            let mut chars = lower.chars();
            let (Some(c), None) = (chars.next(), chars.next()) else {
                return None;
            };
            return match unshift(c) {
                Some(base) => Some((Key::Char(base), true)),
                None => mac_code(Key::Char(c)).map(|_| (Key::Char(c), false)),
            };
        }
    };
    Some((key, false))
}

/// The unshifted key of a shifted US-layout symbol.
fn unshift(c: char) -> Option<char> {
    const SHIFTED: &str = "~!@#$%^&*()_+{}|:\"<>?";
    const BASE: &str = "`1234567890-=[]\\;',./";
    SHIFTED
        .chars()
        .position(|s| s == c)
        .and_then(|i| BASE.chars().nth(i))
}

fn name(key: Key) -> String {
    match key {
        Key::Char(c) => c.to_string(),
        Key::F(n) => format!("f{n}"),
        Key::Command => "cmd".into(),
        Key::Option => "option".into(),
        Key::Control => "ctrl".into(),
        Key::Function => "fn".into(),
        Key::ForwardDelete => "forwarddelete".into(),
        Key::PageUp => "pageup".into(),
        Key::PageDown => "pagedown".into(),
        other => format!("{other:?}").to_lowercase(),
    }
}

/// The macOS virtual key code (`kVK_*`) of a key; `None` for a character the US layout lacks.
pub fn mac_code(key: Key) -> Option<u16> {
    // Indexed by key code: kVK_ANSI_A is 0x00, kVK_ANSI_Grave 0x32; `\0` marks codes of other keys.
    const ANSI: &str = "asdfhgzxcv\0bqweryt123465=97-80]ou[ip\0lj'k;\\,/nm.\0\0`";
    Some(match key {
        Key::Char(c) => {
            if c == '\0' {
                return None;
            }
            return ANSI.chars().position(|a| a == c).map(|i| i as u16);
        }
        Key::Return => 0x24,
        Key::Tab => 0x30,
        Key::Space => 0x31,
        Key::Delete => 0x33,
        Key::Escape => 0x35,
        Key::Command => 0x37,
        Key::Shift => 0x38,
        Key::Option => 0x3A,
        Key::Control => 0x3B,
        Key::Function => 0x3F,
        Key::Home => 0x73,
        Key::PageUp => 0x74,
        Key::ForwardDelete => 0x75,
        Key::End => 0x77,
        Key::PageDown => 0x79,
        Key::Left => 0x7B,
        Key::Right => 0x7C,
        Key::Down => 0x7D,
        Key::Up => 0x7E,
        Key::F(n) => {
            const F: [u16; 20] = [
                0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F, 0x69, 0x6B,
                0x71, 0x6A, 0x40, 0x4F, 0x50, 0x5A,
            ];
            return F.get(usize::from(n).checked_sub(1)?).copied();
        }
    })
}
