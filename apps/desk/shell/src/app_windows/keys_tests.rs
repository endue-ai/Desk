use cef::sys::cef_event_flags_t as F;
use cef::{KeyEvent, KeyEventType};
use desk_compositor::input::keymap::{KeyEntry, Platform};

use super::{Keys, like_of, report};
use crate::web_host::key_codes::{native_key, virtual_key};

const SURFACE: &str = "main.endue-terminal";

fn entry(key: &str, command: &str) -> KeyEntry {
    KeyEntry {
        key: key.to_owned(),
        mac: None,
        command: command.to_owned(),
        args: None,
        owner: "desk".to_owned(),
        source: None,
    }
}

/// CEF's event for the key at `code` typing `typed`, with Mod (⌘ on macOS, Control elsewhere)
/// held when `chord`.
fn event(kind: KeyEventType, code: &str, typed: char, chord: bool) -> KeyEvent {
    let flag = if cfg!(target_os = "macos") {
        F::EVENTFLAG_COMMAND_DOWN
    } else {
        F::EVENTFLAG_CONTROL_DOWN
    };
    KeyEvent {
        size: std::mem::size_of::<cef::sys::cef_key_event_t>(),
        type_: kind,
        modifiers: if chord { flag.0 } else { 0 },
        windows_key_code: virtual_key(code),
        native_key_code: native_key(code, kind == KeyEventType::KEYUP),
        is_system_key: 0,
        character: typed as u16,
        unmodified_character: typed as u16,
        focus_on_editable_field: 0,
    }
}

// One test: the reported keymap is the process's, which other tests would change under it.
#[test]
fn a_chord_the_desk_binds_is_the_desks_in_an_app_window_with_its_character_and_release() {
    report(
        Platform::current(),
        &[
            entry("Mod+K", "desk.palette.open"),
            entry("Mod+X F", "desk.files.open"),
        ],
        None,
        0,
    );
    let mut keys = Keys::default();
    // ⌘K: the runtime hears it from the surface; the page hears neither it, its character, nor
    // its release.
    let (taken, said) = keys.event(&event(KeyEventType::RAWKEYDOWN, "KeyK", 'k', true), SURFACE);
    assert!(taken);
    let said = said.expect("desk:key");
    assert_eq!(said["type"], "desk:key");
    assert_eq!(
        (said["key"]["key"].clone(), said["key"]["code"].clone()),
        ("k".into(), "KeyK".into())
    );
    assert_eq!(
        said["key"][if cfg!(target_os = "macos") {
            "metaKey"
        } else {
            "ctrlKey"
        }],
        true
    );
    assert!(
        keys.event(&event(KeyEventType::CHAR, "KeyK", 'k', true), SURFACE)
            .0
    );
    assert!(
        keys.event(&event(KeyEventType::KEYUP, "KeyK", 'k', true), SURFACE)
            .0
    );
    assert!(
        !keys
            .event(&event(KeyEventType::KEYUP, "KeyK", 'k', true), SURFACE)
            .0,
        "once"
    );
    // A plain key, and a chord nothing binds, are the page's.
    assert_eq!(
        keys.event(
            &event(KeyEventType::RAWKEYDOWN, "KeyK", 'k', false),
            SURFACE
        ),
        (false, None)
    );
    assert!(
        !keys
            .event(&event(KeyEventType::RAWKEYDOWN, "KeyJ", 'j', true), SURFACE)
            .0
    );
    // A sequence: after its first chord, the next plain key is the desk's too.
    assert!(
        keys.event(&event(KeyEventType::RAWKEYDOWN, "KeyX", 'x', true), SURFACE)
            .0
    );
    assert!(
        keys.event(
            &event(KeyEventType::RAWKEYDOWN, "KeyF", 'f', false),
            SURFACE
        )
        .0
    );
    assert!(
        !keys
            .event(
                &event(KeyEventType::RAWKEYDOWN, "KeyF", 'f', false),
                SURFACE
            )
            .0,
        "done"
    );
}

#[test]
fn a_key_that_types_nothing_is_named_by_its_code() {
    let escape = like_of(&event(KeyEventType::RAWKEYDOWN, "Escape", '\u{1b}', false));
    assert_eq!(
        (escape.key.as_str(), escape.code.as_deref()),
        ("Escape", Some("Escape"))
    );
    let up = like_of(&event(
        KeyEventType::RAWKEYDOWN,
        "ArrowUp",
        '\u{f700}',
        true,
    ));
    assert_eq!(up.key, "ArrowUp");
    let space = like_of(&event(KeyEventType::RAWKEYDOWN, "Space", ' ', true));
    assert_eq!(space.key, " ");
}
