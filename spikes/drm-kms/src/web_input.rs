//! The surface protocol's input on the windowless browser: a spike-sized copy of the CEF shell's
//! `web_host/input.rs` (pointer, wheel, keys, text, focus; no IME) whose key codes come from
//! evdev (`keys.rs`) instead of winit. On Linux CEF reads `native_key_code` as an XKB keycode.

use crate::keys;
use cef::*;
use desk_surface::generated::{
    CompositorMessage as M, SurfaceModifier, SurfacePointerButton, SurfaceWheelUnit,
};

/// Pixels a wheel line scrolls in Chromium.
const LINE: f64 = 40.0;

fn flags(mods: &[SurfaceModifier], buttons: &[SurfacePointerButton]) -> u32 {
    use cef::sys::cef_event_flags_t as F;
    let mut all = 0;
    for m in mods {
        all |= match m {
            SurfaceModifier::Shift => F::EVENTFLAG_SHIFT_DOWN,
            SurfaceModifier::Ctrl => F::EVENTFLAG_CONTROL_DOWN,
            SurfaceModifier::Alt => F::EVENTFLAG_ALT_DOWN,
            SurfaceModifier::Meta => F::EVENTFLAG_COMMAND_DOWN,
            SurfaceModifier::CapsLock => F::EVENTFLAG_CAPS_LOCK_ON,
        }
        .0;
    }
    for b in buttons {
        all |= match b {
            SurfacePointerButton::Left => F::EVENTFLAG_LEFT_MOUSE_BUTTON.0,
            SurfacePointerButton::Middle => F::EVENTFLAG_MIDDLE_MOUSE_BUTTON.0,
            SurfacePointerButton::Right => F::EVENTFLAG_RIGHT_MOUSE_BUTTON.0,
            _ => 0,
        };
    }
    all
}

fn mouse(x: f64, y: f64, modifiers: u32) -> MouseEvent {
    MouseEvent {
        x: x.round() as i32,
        y: y.round() as i32,
        modifiers,
    }
}

fn button(b: SurfacePointerButton) -> Option<MouseButtonType> {
    match b {
        SurfacePointerButton::Left => Some(MouseButtonType::LEFT),
        SurfacePointerButton::Middle => Some(MouseButtonType::MIDDLE),
        SurfacePointerButton::Right => Some(MouseButtonType::RIGHT),
        _ => None,
    }
}

fn key_event(kind: KeyEventType, code: &str, text: &str, mods: &[SurfaceModifier]) -> KeyEvent {
    let mut units = text.encode_utf16();
    let character = match (units.next(), units.next()) {
        (Some(unit), None) => unit,
        _ => 0,
    };
    KeyEvent {
        size: std::mem::size_of::<cef::sys::cef_key_event_t>(),
        type_: kind,
        modifiers: flags(mods, &[]),
        windows_key_code: keys::virtual_key(code),
        native_key_code: keys::evdev_code(code).map_or(0, |c| c as i32 + 8),
        is_system_key: 0,
        character,
        unmodified_character: character,
        focus_on_editable_field: 0,
    }
}

pub fn deliver(host: &BrowserHost, message: &M, composing: &mut Option<String>) {
    match message {
        M::SurfacePointerMove(m) => {
            host.send_mouse_move_event(Some(&mouse(m.x, m.y, flags(&m.modifiers, &m.buttons))), 0)
        }
        M::SurfacePointerLeave(_) => host.send_mouse_move_event(Some(&mouse(-1.0, -1.0, 0)), 1),
        M::SurfacePointerDown(m) => {
            if let Some(b) = button(m.button) {
                let event = mouse(m.x, m.y, flags(&m.modifiers, &m.buttons));
                host.send_mouse_click_event(Some(&event), b, 0, m.clicks.min(3) as i32);
            }
        }
        M::SurfacePointerUp(m) => {
            if let Some(b) = button(m.button) {
                let mut held = m.buttons.clone();
                held.push(m.button);
                let event = mouse(m.x, m.y, flags(&m.modifiers, &held));
                host.send_mouse_click_event(Some(&event), b, 1, m.clicks.min(3) as i32);
            }
        }
        M::SurfacePointerWheel(m) => {
            let per = match m.unit {
                SurfaceWheelUnit::Pixel => 1.0,
                SurfaceWheelUnit::Line => LINE,
                SurfaceWheelUnit::Page => 10.0 * LINE,
            };
            // CEF counts up for "towards the top", the DOM for "towards the end".
            let event = mouse(m.x, m.y, flags(&m.modifiers, &[]));
            host.send_mouse_wheel_event(
                Some(&event),
                (-m.delta_x * per).round() as i32,
                (-m.delta_y * per).round() as i32,
            );
        }
        M::SurfaceKeyDown(k) => {
            let mut event = key_event(KeyEventType::RAWKEYDOWN, &k.code, &k.key, &k.modifiers);
            if k.repeat {
                event.modifiers |= cef::sys::cef_event_flags_t::EVENTFLAG_IS_REPEAT.0;
            }
            host.send_key_event(Some(&event));
        }
        M::SurfaceKeyUp(k) => host.send_key_event(Some(&key_event(
            KeyEventType::KEYUP,
            &k.code,
            &k.key,
            &k.modifiers,
        ))),
        M::SurfaceKeyChar(c) => {
            let mut event = key_event(KeyEventType::CHAR, "", &c.text, &c.modifiers);
            event.windows_key_code = i32::from(event.character);
            if event.character != 0 {
                host.send_key_event(Some(&event));
            } else if !c.text.is_empty() {
                let none = Range {
                    from: u32::MAX,
                    to: u32::MAX,
                };
                host.ime_commit_text(Some(&c.text.as_str().into()), Some(&none), 0);
            }
        }
        M::SurfaceFocusIn(_) => host.set_focus(1),
        M::SurfaceFocusOut(_) => host.set_focus(0),
        // No input method on a bare VT yet (README): nothing composes.
        _ => *composing = None,
    }
}
