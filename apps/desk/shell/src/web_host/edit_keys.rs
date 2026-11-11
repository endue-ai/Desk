//! The Mac's editing keys on an off-screen page (#156). A windowed Chromium view on macOS gets
//! ⌘A, ⌘C, ⌘X, ⌘V, ⌘Z and ⇧⌘Z from the Edit menu's key equivalents and ⌘←, ⌘⌫, ⌃A and the rest
//! from AppKit's key bindings (`interpretKeyEvents:`, `StandardKeyBinding.dict`), and hands them
//! to Blink as edit commands with the key down; Blink runs them as that key's default action, so a
//! page that cancels the key keeps it for itself. An off-screen browser has no such view, and
//! CEF's `SendKeyEvent` carries no commands, so these keys did nothing in any field. The shell
//! sends such a key down with its commands through the browser's own DevTools agent
//! (`Input.dispatchKeyEvent`), which puts it on the same input queue `SendKeyEvent` does, in the
//! order sent. Windows and Linux need none of it: Blink binds Ctrl+A, Ctrl+C and the rest itself
//! there.

use std::sync::atomic::{AtomicI32, Ordering};

use cef::*;
use desk_surface::generated::SurfaceModifier;
use serde_json::{Value, json};

/// DevTools message ids of these keys, clear of the accessibility export's (`a11y_devtools.rs`).
const FIRST_ID: i32 = 680_000;

const SHIFT: u8 = 1;
const CTRL: u8 = 2;
const ALT: u8 = 4;
const META: u8 = 8;

/// (DOM code, modifiers held, Blink's edit commands): the Edit menu's key equivalents, then
/// AppKit's standard key bindings Blink does not bind on macOS itself (it binds ⌥←, ⌥⌫, Home, End
/// and the plain keys). Blink's command names are AppKit's selectors without the colon.
const MAC: &[(&str, u8, &[&str])] = &[
    ("KeyA", META, &["SelectAll"]),
    ("KeyC", META, &["Copy"]),
    ("KeyX", META, &["Cut"]),
    ("KeyV", META, &["Paste"]),
    ("KeyV", META | ALT | SHIFT, &["PasteAndMatchStyle"]),
    ("KeyZ", META, &["Undo"]),
    ("KeyZ", META | SHIFT, &["Redo"]),
    ("ArrowLeft", META, &["MoveToLeftEndOfLine"]),
    (
        "ArrowLeft",
        META | SHIFT,
        &["MoveToLeftEndOfLineAndModifySelection"],
    ),
    ("ArrowRight", META, &["MoveToRightEndOfLine"]),
    (
        "ArrowRight",
        META | SHIFT,
        &["MoveToRightEndOfLineAndModifySelection"],
    ),
    ("ArrowUp", META, &["MoveToBeginningOfDocument"]),
    (
        "ArrowUp",
        META | SHIFT,
        &["MoveToBeginningOfDocumentAndModifySelection"],
    ),
    ("ArrowDown", META, &["MoveToEndOfDocument"]),
    (
        "ArrowDown",
        META | SHIFT,
        &["MoveToEndOfDocumentAndModifySelection"],
    ),
    ("Backspace", META, &["DeleteToBeginningOfLine"]),
    (
        "ArrowUp",
        ALT,
        &["MoveBackward", "MoveToBeginningOfParagraph"],
    ),
    (
        "ArrowUp",
        ALT | SHIFT,
        &["MoveParagraphBackwardAndModifySelection"],
    ),
    ("ArrowDown", ALT, &["MoveForward", "MoveToEndOfParagraph"]),
    (
        "ArrowDown",
        ALT | SHIFT,
        &["MoveParagraphForwardAndModifySelection"],
    ),
    ("ArrowLeft", CTRL, &["MoveToLeftEndOfLine"]),
    (
        "ArrowLeft",
        CTRL | SHIFT,
        &["MoveToLeftEndOfLineAndModifySelection"],
    ),
    ("ArrowRight", CTRL, &["MoveToRightEndOfLine"]),
    (
        "ArrowRight",
        CTRL | SHIFT,
        &["MoveToRightEndOfLineAndModifySelection"],
    ),
    ("KeyA", CTRL, &["MoveToBeginningOfParagraph"]),
    (
        "KeyA",
        CTRL | SHIFT,
        &["MoveToBeginningOfParagraphAndModifySelection"],
    ),
    ("KeyE", CTRL, &["MoveToEndOfParagraph"]),
    (
        "KeyE",
        CTRL | SHIFT,
        &["MoveToEndOfParagraphAndModifySelection"],
    ),
    ("KeyB", CTRL, &["MoveBackward"]),
    ("KeyB", CTRL | SHIFT, &["MoveBackwardAndModifySelection"]),
    ("KeyF", CTRL, &["MoveForward"]),
    ("KeyF", CTRL | SHIFT, &["MoveForwardAndModifySelection"]),
    ("KeyP", CTRL, &["MoveUp"]),
    ("KeyP", CTRL | SHIFT, &["MoveUpAndModifySelection"]),
    ("KeyN", CTRL, &["MoveDown"]),
    ("KeyN", CTRL | SHIFT, &["MoveDownAndModifySelection"]),
    ("KeyD", CTRL, &["DeleteForward"]),
    ("KeyH", CTRL, &["DeleteBackward"]),
    ("KeyK", CTRL, &["DeleteToEndOfParagraph"]),
    ("KeyY", CTRL, &["Yank"]),
    ("KeyT", CTRL, &["Transpose"]),
];

fn held(mods: &[SurfaceModifier]) -> u8 {
    mods.iter().fold(0, |all, m| {
        all | match m {
            SurfaceModifier::Shift => SHIFT,
            SurfaceModifier::Ctrl => CTRL,
            SurfaceModifier::Alt => ALT,
            SurfaceModifier::Meta => META,
            SurfaceModifier::CapsLock => 0,
        }
    })
}

/// The edit commands a key down at DOM `code` with `mods` held is on macOS, if it is any.
pub fn mac_commands(code: &str, mods: &[SurfaceModifier]) -> Option<&'static [&'static str]> {
    let mods = held(mods);
    MAC.iter()
        .find(|(c, m, _)| *c == code && *m == mods)
        .map(|(_, _, commands)| *commands)
}

/// The DevTools call that sends `event`, the key down at DOM `code` meaning `key`, with `commands`.
pub fn dispatch(
    id: i32,
    event: &KeyEvent,
    code: &str,
    key: &str,
    mods: &[SurfaceModifier],
    repeat: bool,
    commands: &[&str],
) -> Value {
    let mods = held(mods);
    // The protocol's bits: Alt 1, Control 2, Meta 4, Shift 8.
    let bits = [(ALT, 1), (CTRL, 2), (META, 4), (SHIFT, 8)]
        .iter()
        .filter(|(m, _)| mods & m != 0)
        .fold(0, |all, (_, bit)| all | bit);
    json!({ "id": id, "method": "Input.dispatchKeyEvent", "params": {
        "type": "rawKeyDown",
        "modifiers": bits,
        "code": code,
        "key": key,
        "windowsVirtualKeyCode": event.windows_key_code,
        "nativeVirtualKeyCode": event.native_key_code,
        "autoRepeat": repeat,
        // As in Chromium's own Mac events: a Command chord is a system key, which types nothing.
        "isSystemKey": mods & META != 0,
        "commands": commands,
    } })
}

/// Send the key down at DOM `code` (`event`, as `SendKeyEvent` would have) to `host`'s page with
/// the edit commands it is on macOS: whether it went. When it did not (not macOS, not one of the
/// keys, the focus in another frame, not CEF's UI thread), send `event` as ever.
pub fn send(
    host: &BrowserHost,
    event: &KeyEvent,
    code: &str,
    key: &str,
    mods: &[SurfaceModifier],
    repeat: bool,
) -> bool {
    if !cfg!(target_os = "macos") || currently_on(ThreadId::UI) != 1 {
        return false;
    }
    let Some(commands) = mac_commands(code, mods) else {
        return false;
    };
    // DevTools' input goes to the page's main frame: a frame inside it keeps its keys as they were.
    let browser = host.browser();
    let focused = browser.as_ref().and_then(|b| b.focused_frame());
    if focused.is_some_and(|f| f.is_main() != 1) {
        return false;
    }
    static NEXT: AtomicI32 = AtomicI32::new(0);
    let id = FIRST_ID + NEXT.fetch_add(1, Ordering::Relaxed).rem_euclid(100_000);
    let message = dispatch(id, event, code, key, mods, repeat, commands).to_string();
    host.send_dev_tools_message(Some(message.as_bytes())) == 1
}

#[cfg(test)]
mod tests {
    use super::{MAC, dispatch, mac_commands};
    use cef::KeyEvent;
    use desk_surface::generated::SurfaceModifier as M;

    #[test]
    fn the_edit_menus_keys_are_its_commands() {
        let cases: [(&str, &[M], &str); 7] = [
            ("KeyA", &[M::Meta], "SelectAll"),
            ("KeyC", &[M::Meta], "Copy"),
            ("KeyX", &[M::Meta], "Cut"),
            ("KeyV", &[M::Meta], "Paste"),
            ("KeyZ", &[M::Meta], "Undo"),
            ("KeyZ", &[M::Shift, M::Meta], "Redo"),
            ("KeyV", &[M::Alt, M::Shift, M::Meta], "PasteAndMatchStyle"),
        ];
        for (code, mods, command) in cases {
            assert_eq!(
                mac_commands(code, mods),
                Some(&[command][..]),
                "{code} {mods:?}"
            );
        }
    }

    #[test]
    fn line_and_document_moves_select_with_shift() {
        assert_eq!(
            mac_commands("ArrowLeft", &[M::Meta]),
            Some(&["MoveToLeftEndOfLine"][..])
        );
        assert_eq!(
            mac_commands("ArrowLeft", &[M::Meta, M::Shift]),
            Some(&["MoveToLeftEndOfLineAndModifySelection"][..])
        );
        assert_eq!(
            mac_commands("ArrowDown", &[M::Shift, M::Meta]),
            Some(&["MoveToEndOfDocumentAndModifySelection"][..])
        );
        assert_eq!(
            mac_commands("Backspace", &[M::Meta]),
            Some(&["DeleteToBeginningOfLine"][..])
        );
        assert_eq!(
            mac_commands("KeyA", &[M::Ctrl]),
            Some(&["MoveToBeginningOfParagraph"][..])
        );
        // Caps Lock changes no binding.
        assert_eq!(
            mac_commands("KeyA", &[M::Meta, M::CapsLock]),
            Some(&["SelectAll"][..])
        );
    }

    #[test]
    fn keys_blink_binds_itself_or_nobody_binds_pass_as_they_are() {
        // Blink's own Mac bindings: a word left, a word deleted, the plain keys.
        assert_eq!(mac_commands("ArrowLeft", &[M::Alt]), None);
        assert_eq!(mac_commands("Backspace", &[M::Alt]), None);
        assert_eq!(mac_commands("ArrowLeft", &[]), None);
        assert_eq!(mac_commands("Home", &[]), None);
        assert_eq!(mac_commands("KeyA", &[]), None);
        // A chord with more keys held than a binding has is not that binding.
        assert_eq!(mac_commands("KeyA", &[M::Meta, M::Alt]), None);
        assert_eq!(mac_commands("KeyK", &[M::Meta]), None);
    }

    #[test]
    fn each_chord_is_bound_once() {
        for (i, (code, mods, _)) in MAC.iter().enumerate() {
            let again = MAC[i + 1..].iter().any(|(c, m, _)| c == code && m == mods);
            assert!(!again, "{code} {mods} twice");
        }
    }

    #[test]
    fn the_call_is_a_raw_key_down_with_the_keys_codes_and_commands() {
        let event = KeyEvent {
            windows_key_code: 0x41,
            native_key_code: 0,
            ..Default::default()
        };
        let call = dispatch(
            680_001,
            &event,
            "KeyA",
            "a",
            &[M::Meta, M::Shift],
            true,
            &["SelectAll"],
        );
        assert_eq!(call["id"], 680_001);
        assert_eq!(call["method"], "Input.dispatchKeyEvent");
        let params = &call["params"];
        assert_eq!(params["type"], "rawKeyDown");
        assert_eq!(params["modifiers"], 4 | 8);
        assert_eq!(params["code"], "KeyA");
        assert_eq!(params["key"], "a");
        assert_eq!(params["windowsVirtualKeyCode"], 0x41);
        assert_eq!(params["autoRepeat"], true);
        assert_eq!(params["isSystemKey"], true);
        assert_eq!(params["commands"], serde_json::json!(["SelectAll"]));
        let ctrl = dispatch(1, &event, "KeyA", "a", &[M::Ctrl], false, &["X"]);
        assert_eq!(ctrl["params"]["modifiers"], 2);
        assert_eq!(ctrl["params"]["isSystemKey"], false);
    }
}
