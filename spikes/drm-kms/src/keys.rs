//! Key names without a windowing system. libinput reports evdev key codes
//! (`linux/input-event-codes.h`); xkbcommon turns them into keysyms and text through the layout;
//! the surface protocol wants the DOM's `code` and `key`, and CEF a Windows virtual-key code.
//! A spike-sized table: the main block, F-keys, navigation, modifiers and the Korean keys.

/// (evdev code, DOM `code`, Windows virtual key).
const KEYS: &[(u32, &str, i32)] = &[
    (1, "Escape", 0x1B),
    (12, "Minus", 0xBD),
    (13, "Equal", 0xBB),
    (14, "Backspace", 0x08),
    (15, "Tab", 0x09),
    (26, "BracketLeft", 0xDB),
    (27, "BracketRight", 0xDD),
    (28, "Enter", 0x0D),
    (29, "ControlLeft", 0x11),
    (39, "Semicolon", 0xBA),
    (40, "Quote", 0xDE),
    (41, "Backquote", 0xC0),
    (42, "ShiftLeft", 0x10),
    (43, "Backslash", 0xDC),
    (51, "Comma", 0xBC),
    (52, "Period", 0xBE),
    (53, "Slash", 0xBF),
    (54, "ShiftRight", 0x10),
    (56, "AltLeft", 0x12),
    (57, "Space", 0x20),
    (58, "CapsLock", 0x14),
    (87, "F11", 0x7A),
    (88, "F12", 0x7B),
    (96, "NumpadEnter", 0x0D),
    (97, "ControlRight", 0x11),
    (100, "AltRight", 0x12),
    (102, "Home", 0x24),
    (103, "ArrowUp", 0x26),
    (104, "PageUp", 0x21),
    (105, "ArrowLeft", 0x25),
    (106, "ArrowRight", 0x27),
    (107, "End", 0x23),
    (108, "ArrowDown", 0x28),
    (109, "PageDown", 0x22),
    (110, "Insert", 0x2D),
    (111, "Delete", 0x2E),
    // KEY_HANGEUL and KEY_HANJA: the keys a Korean IME listens to.
    (122, "Lang1", 0x15),
    (123, "Lang2", 0x19),
    (125, "MetaLeft", 0x5B),
    (126, "MetaRight", 0x5C),
];

/// Letters by evdev row: Q..P from 16, A..L from 30, Z..M from 44.
const ROWS: &[(u32, &str)] = &[(16, "QWERTYUIOP"), (30, "ASDFGHJKL"), (44, "ZXCVBNM")];

/// The DOM `code` of evdev key `code`.
pub fn dom_code(code: u32) -> String {
    if let Some((_, name, _)) = KEYS.iter().find(|k| k.0 == code) {
        return (*name).into();
    }
    if (2..=11).contains(&code) {
        return format!("Digit{}", (code - 1) % 10);
    }
    if (59..=68).contains(&code) {
        return format!("F{}", code - 58);
    }
    for (start, letters) in ROWS {
        if let Some(c) = letters.chars().nth(code.wrapping_sub(*start) as usize)
            && code >= *start
        {
            return format!("Key{c}");
        }
    }
    "Unidentified".into()
}

/// The evdev code of DOM `code` (the reverse of [`dom_code`]), for CEF's native key code.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn evdev_code(dom: &str) -> Option<u32> {
    (1..=127).find(|c| dom_code(*c) == dom)
}

/// The Windows virtual-key code CEF wants for DOM `code`.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub fn virtual_key(dom: &str) -> i32 {
    if let Some((_, _, vk)) = KEYS.iter().find(|k| k.1 == dom) {
        return *vk;
    }
    if let Some(d) = dom
        .strip_prefix("Digit")
        .and_then(|d| d.parse::<i32>().ok())
    {
        return 0x30 + d;
    }
    if let Some(n) = dom.strip_prefix('F').and_then(|n| n.parse::<i32>().ok()) {
        return 0x6F + n;
    }
    if let Some(c) = dom.strip_prefix("Key").and_then(|k| k.chars().next()) {
        return c as i32;
    }
    0
}

/// The DOM `key` of a key that types nothing, from its keysym's name.
pub fn dom_key_from_keysym(name: &str) -> String {
    let named = match name {
        "Return" | "KP_Enter" => "Enter",
        "BackSpace" => "Backspace",
        "Left" => "ArrowLeft",
        "Right" => "ArrowRight",
        "Up" => "ArrowUp",
        "Down" => "ArrowDown",
        "Prior" => "PageUp",
        "Next" => "PageDown",
        "Shift_L" | "Shift_R" => "Shift",
        "Control_L" | "Control_R" => "Control",
        "Alt_L" | "Alt_R" | "ISO_Level3_Shift" => "Alt",
        "Super_L" | "Super_R" | "Meta_L" | "Meta_R" => "Meta",
        "Caps_Lock" => "CapsLock",
        "Hangul" => "HangulMode",
        "Hangul_Hanja" => "HanjaMode",
        "Escape" | "Tab" | "Delete" | "Home" | "End" | "Insert" => name,
        _ if name.len() <= 3 && name.starts_with('F') => name,
        _ => "Unidentified",
    };
    named.into()
}

/// `XF86Switch_VT_1` .. `XF86Switch_VT_12`: what xkb makes of Ctrl+Alt+F1..F12.
pub fn switch_vt(keysym: u32) -> Option<u32> {
    (0x1008_FE01..=0x1008_FE0C)
        .contains(&keysym)
        .then(|| keysym - 0x1008_FE00)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_round_trip() {
        assert_eq!(dom_code(30), "KeyA");
        assert_eq!(dom_code(50), "KeyM");
        assert_eq!(dom_code(11), "Digit0");
        assert_eq!(dom_code(59), "F1");
        assert_eq!(dom_code(122), "Lang1");
        assert_eq!(evdev_code("KeyQ"), Some(16));
        assert_eq!(virtual_key("KeyA"), 0x41);
        assert_eq!(virtual_key("F1"), 0x70);
        assert_eq!(virtual_key("Digit7"), 0x37);
        assert_eq!(switch_vt(0x1008_FE03), Some(3));
        assert_eq!(dom_key_from_keysym("Return"), "Enter");
    }
}
