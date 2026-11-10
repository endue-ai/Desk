//! Physical keys between the DOM's `KeyboardEvent.code` (what the surface protocol carries), winit's
//! `KeyCode` (what the window hears) and what CEF's `SendKeyEvent` wants: the Windows virtual key,
//! the OS's own key code (macOS's virtual key code, Windows's `lParam` with the scan code, X11's XKB
//! key code), and on macOS the function-key character AppKit gives keys that type nothing.

use winit::keyboard::{KeyCode, PhysicalKey};
use winit::platform::scancode::PhysicalKeyExtScancode;

use KeyCode as K;

/// (DOM code, winit key, Windows virtual key).
const KEYS: &[(&str, KeyCode, u8)] = &[
    ("KeyA", K::KeyA, 0x41),
    ("KeyB", K::KeyB, 0x42),
    ("KeyC", K::KeyC, 0x43),
    ("KeyD", K::KeyD, 0x44),
    ("KeyE", K::KeyE, 0x45),
    ("KeyF", K::KeyF, 0x46),
    ("KeyG", K::KeyG, 0x47),
    ("KeyH", K::KeyH, 0x48),
    ("KeyI", K::KeyI, 0x49),
    ("KeyJ", K::KeyJ, 0x4a),
    ("KeyK", K::KeyK, 0x4b),
    ("KeyL", K::KeyL, 0x4c),
    ("KeyM", K::KeyM, 0x4d),
    ("KeyN", K::KeyN, 0x4e),
    ("KeyO", K::KeyO, 0x4f),
    ("KeyP", K::KeyP, 0x50),
    ("KeyQ", K::KeyQ, 0x51),
    ("KeyR", K::KeyR, 0x52),
    ("KeyS", K::KeyS, 0x53),
    ("KeyT", K::KeyT, 0x54),
    ("KeyU", K::KeyU, 0x55),
    ("KeyV", K::KeyV, 0x56),
    ("KeyW", K::KeyW, 0x57),
    ("KeyX", K::KeyX, 0x58),
    ("KeyY", K::KeyY, 0x59),
    ("KeyZ", K::KeyZ, 0x5a),
    ("Digit0", K::Digit0, 0x30),
    ("Digit1", K::Digit1, 0x31),
    ("Digit2", K::Digit2, 0x32),
    ("Digit3", K::Digit3, 0x33),
    ("Digit4", K::Digit4, 0x34),
    ("Digit5", K::Digit5, 0x35),
    ("Digit6", K::Digit6, 0x36),
    ("Digit7", K::Digit7, 0x37),
    ("Digit8", K::Digit8, 0x38),
    ("Digit9", K::Digit9, 0x39),
    ("Enter", K::Enter, 0x0d),
    ("Escape", K::Escape, 0x1b),
    ("Backspace", K::Backspace, 0x08),
    ("Tab", K::Tab, 0x09),
    ("Space", K::Space, 0x20),
    ("Minus", K::Minus, 0xbd),
    ("Equal", K::Equal, 0xbb),
    ("BracketLeft", K::BracketLeft, 0xdb),
    ("BracketRight", K::BracketRight, 0xdd),
    ("Backslash", K::Backslash, 0xdc),
    ("Semicolon", K::Semicolon, 0xba),
    ("Quote", K::Quote, 0xde),
    ("Backquote", K::Backquote, 0xc0),
    ("Comma", K::Comma, 0xbc),
    ("Period", K::Period, 0xbe),
    ("Slash", K::Slash, 0xbf),
    ("IntlBackslash", K::IntlBackslash, 0xe2),
    ("IntlRo", K::IntlRo, 0xc1),
    ("IntlYen", K::IntlYen, 0xdc),
    ("CapsLock", K::CapsLock, 0x14),
    ("F1", K::F1, 0x70),
    ("F2", K::F2, 0x71),
    ("F3", K::F3, 0x72),
    ("F4", K::F4, 0x73),
    ("F5", K::F5, 0x74),
    ("F6", K::F6, 0x75),
    ("F7", K::F7, 0x76),
    ("F8", K::F8, 0x77),
    ("F9", K::F9, 0x78),
    ("F10", K::F10, 0x79),
    ("F11", K::F11, 0x7a),
    ("F12", K::F12, 0x7b),
    ("PrintScreen", K::PrintScreen, 0x2c),
    ("ScrollLock", K::ScrollLock, 0x91),
    ("Pause", K::Pause, 0x13),
    ("Insert", K::Insert, 0x2d),
    ("Home", K::Home, 0x24),
    ("PageUp", K::PageUp, 0x21),
    ("Delete", K::Delete, 0x2e),
    ("End", K::End, 0x23),
    ("PageDown", K::PageDown, 0x22),
    ("ArrowRight", K::ArrowRight, 0x27),
    ("ArrowLeft", K::ArrowLeft, 0x25),
    ("ArrowDown", K::ArrowDown, 0x28),
    ("ArrowUp", K::ArrowUp, 0x26),
    ("NumLock", K::NumLock, 0x90),
    ("NumpadDivide", K::NumpadDivide, 0x6f),
    ("NumpadMultiply", K::NumpadMultiply, 0x6a),
    ("NumpadSubtract", K::NumpadSubtract, 0x6d),
    ("NumpadAdd", K::NumpadAdd, 0x6b),
    ("NumpadEnter", K::NumpadEnter, 0x0d),
    ("NumpadDecimal", K::NumpadDecimal, 0x6e),
    ("NumpadEqual", K::NumpadEqual, 0xbb),
    ("NumpadComma", K::NumpadComma, 0xbc),
    ("Numpad0", K::Numpad0, 0x60),
    ("Numpad1", K::Numpad1, 0x61),
    ("Numpad2", K::Numpad2, 0x62),
    ("Numpad3", K::Numpad3, 0x63),
    ("Numpad4", K::Numpad4, 0x64),
    ("Numpad5", K::Numpad5, 0x65),
    ("Numpad6", K::Numpad6, 0x66),
    ("Numpad7", K::Numpad7, 0x67),
    ("Numpad8", K::Numpad8, 0x68),
    ("Numpad9", K::Numpad9, 0x69),
    ("ContextMenu", K::ContextMenu, 0x5d),
    ("ShiftLeft", K::ShiftLeft, 0x10),
    ("ShiftRight", K::ShiftRight, 0x10),
    ("ControlLeft", K::ControlLeft, 0x11),
    ("ControlRight", K::ControlRight, 0x11),
    ("AltLeft", K::AltLeft, 0x12),
    ("AltRight", K::AltRight, 0x12),
    ("MetaLeft", K::SuperLeft, 0x5b),
    ("MetaRight", K::SuperRight, 0x5c),
    // The Korean and Japanese keyboards' mode keys.
    ("Lang1", K::Lang1, 0x15),
    ("Lang2", K::Lang2, 0x19),
];

/// The DOM code of a winit physical key, `Unidentified` for one the table lacks.
pub fn dom_code(key: PhysicalKey) -> &'static str {
    match key {
        PhysicalKey::Code(code) => KEYS
            .iter()
            .find(|(_, k, _)| *k == code)
            .map_or("Unidentified", |(dom, _, _)| dom),
        PhysicalKey::Unidentified(_) => "Unidentified",
    }
}

fn row(code: &str) -> Option<&'static (&'static str, KeyCode, u8)> {
    KEYS.iter().find(|(dom, _, _)| *dom == code)
}

/// The Windows virtual key of a DOM code (the US layout's), 0 when unknown.
pub fn virtual_key(code: &str) -> i32 {
    row(code).map_or(0, |(_, _, vk)| i32::from(*vk))
}

/// The OS's own code for a key: macOS's virtual key code; Windows's `lParam` with the scan code
/// (the extended bit, and the release's transition bits when `up`); X11's XKB key code.
pub fn native_key(code: &str, up: bool) -> i32 {
    let Some(scancode) = row(code).and_then(|(_, k, _)| PhysicalKey::Code(*k).to_scancode()) else {
        return 0;
    };
    if cfg!(target_os = "windows") {
        let extended = i32::from(scancode & 0xe000 != 0) << 24;
        let transition = if up { (1 << 30) | (1 << 31) } else { 0 };
        1 | ((scancode as i32 & 0xff) << 16) | extended | transition
    } else if cfg!(target_os = "macos") {
        scancode as i32
    } else {
        scancode as i32 + 8
    }
}

/// The character AppKit gives a key that types none (arrows, function keys), so Chromium on macOS
/// names it as an NSEvent would; the control character of Enter, Tab, Backspace and Escape.
pub fn mac_character(code: &str) -> Option<u16> {
    Some(match code {
        "ArrowUp" => 0xf700,
        "ArrowDown" => 0xf701,
        "ArrowLeft" => 0xf702,
        "ArrowRight" => 0xf703,
        "F1" => 0xf704,
        "F2" => 0xf705,
        "F3" => 0xf706,
        "F4" => 0xf707,
        "F5" => 0xf708,
        "F6" => 0xf709,
        "F7" => 0xf70a,
        "F8" => 0xf70b,
        "F9" => 0xf70c,
        "F10" => 0xf70d,
        "F11" => 0xf70e,
        "F12" => 0xf70f,
        "Insert" => 0xf727,
        "Delete" => 0xf728,
        "Home" => 0xf729,
        "End" => 0xf72b,
        "PageUp" => 0xf72c,
        "PageDown" => 0xf72d,
        "Enter" => 0x0d,
        "NumpadEnter" => 0x03,
        "Tab" => 0x09,
        "Backspace" => 0x7f,
        "Escape" => 0x1b,
        _ => return None,
    })
}

/// What the key types on a US layout with no modifier (Option+D's `d`): the character AppKit's
/// `charactersIgnoringModifiers` gives.
pub fn unmodified(code: &str) -> Option<char> {
    if let Some(letter) = code.strip_prefix("Key") {
        return letter.chars().next().map(|c| c.to_ascii_lowercase());
    }
    code.strip_prefix("Digit").and_then(|d| d.chars().next())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_physical_key_is_named_as_the_dom_names_it_and_back() {
        assert_eq!(dom_code(PhysicalKey::Code(KeyCode::KeyA)), "KeyA");
        assert_eq!(dom_code(PhysicalKey::Code(KeyCode::SuperLeft)), "MetaLeft");
        assert_eq!(virtual_key("KeyA"), 0x41);
        assert_eq!(virtual_key("Enter"), 0x0d);
        assert_eq!(virtual_key("Nonsense"), 0);
        if cfg!(target_os = "macos") {
            assert_eq!(native_key("KeyA", false), 0x00, "kVK_ANSI_A");
            assert_eq!(native_key("Enter", false), 0x24, "kVK_Return");
        }
        assert_eq!(mac_character("ArrowLeft"), Some(0xf702));
        assert_eq!(unmodified("KeyD"), Some('d'));
    }
}
