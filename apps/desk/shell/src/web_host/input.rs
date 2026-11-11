//! The surface protocol's input on a windowless CEF browser (#56): `pointer.*` become
//! `SendMouseMoveEvent`, `SendMouseClickEvent` and `SendMouseWheelEvent` in the view's logical pixels
//! with the held buttons and keys as flags; `key.*` become `SendKeyEvent` with the OS's own key codes
//! (`key_codes.rs`), the Mac's editing keys going down with Blink's edit commands (`edit_keys.rs`);
//! `ime.*` become `ImeSetComposition`, `ImeCommitText` (or `ImeFinishComposingText` for the text
//! already composed) and `ImeCancelComposition`; `focus.*` is `SetFocus`. CEF's wheel deltas count
//! up for "towards the top", the DOM's for "towards the end".

use cef::*;
use desk_surface::generated::{
    CompositorMessage as M, SurfaceModifier, SurfacePointerButton, SurfaceUnderlineStyle,
    SurfaceWheelUnit,
};

use super::{edit_keys, key_codes};

/// Pixels a wheel line scrolls in Chromium.
const LINE: f64 = 40.0;

fn flag(f: cef::sys::cef_event_flags_t) -> u32 {
    f.0
}

fn modifiers(mods: &[SurfaceModifier], buttons: &[SurfacePointerButton]) -> u32 {
    use cef::sys::cef_event_flags_t as F;
    let mut all = 0;
    for m in mods {
        all |= flag(match m {
            SurfaceModifier::Shift => F::EVENTFLAG_SHIFT_DOWN,
            SurfaceModifier::Ctrl => F::EVENTFLAG_CONTROL_DOWN,
            SurfaceModifier::Alt => F::EVENTFLAG_ALT_DOWN,
            SurfaceModifier::Meta => F::EVENTFLAG_COMMAND_DOWN,
            SurfaceModifier::CapsLock => F::EVENTFLAG_CAPS_LOCK_ON,
        });
    }
    for b in buttons {
        all |= match b {
            SurfacePointerButton::Left => flag(F::EVENTFLAG_LEFT_MOUSE_BUTTON),
            SurfacePointerButton::Middle => flag(F::EVENTFLAG_MIDDLE_MOUSE_BUTTON),
            SurfacePointerButton::Right => flag(F::EVENTFLAG_RIGHT_MOUSE_BUTTON),
            _ => 0,
        };
    }
    all
}

fn mouse(x: f64, y: f64, mods: u32) -> MouseEvent {
    MouseEvent {
        x: x.round() as i32,
        y: y.round() as i32,
        modifiers: mods,
    }
}

fn button(b: SurfacePointerButton) -> Option<MouseButtonType> {
    match b {
        SurfacePointerButton::Left => Some(MouseButtonType::LEFT),
        SurfacePointerButton::Middle => Some(MouseButtonType::MIDDLE),
        SurfacePointerButton::Right => Some(MouseButtonType::RIGHT),
        // Back and forward would navigate the page; a surface has no history to walk.
        _ => None,
    }
}

fn range(start: u64, end: u64) -> Range {
    Range {
        from: start as u32,
        to: end as u32,
    }
}

/// The replacement range of a composition or commit: CEF drops the call whole when the pointer is
/// null, so "none" is Chromium's invalid range.
fn replacement(r: Option<&desk_surface::generated::SurfaceTextRange>) -> Range {
    r.map_or(
        Range {
            from: u32::MAX,
            to: u32::MAX,
        },
        |r| range(r.start, r.end),
    )
}

/// Whether `message` is input this module delivers.
pub fn is_input(message: &M) -> bool {
    matches!(
        message,
        M::SurfacePointerMove(_)
            | M::SurfacePointerDown(_)
            | M::SurfacePointerUp(_)
            | M::SurfacePointerWheel(_)
            | M::SurfacePointerLeave(_)
            | M::SurfaceKeyDown(_)
            | M::SurfaceKeyUp(_)
            | M::SurfaceKeyChar(_)
            | M::SurfaceFocusIn(_)
            | M::SurfaceFocusOut(_)
            | M::SurfaceImeComposition(_)
            | M::SurfaceImeCommit(_)
            | M::SurfaceImeCancel(_)
    )
}

/// Deliver an input message to `host`, the surface's browser. `composing` is the text the surface
/// composes now, kept by the caller; `view_height` scales `page` wheel deltas.
pub fn deliver(host: &BrowserHost, message: &M, composing: &mut Option<String>, view_height: f64) {
    // A press or a key is followed by begin frames at once, and any input wakes a long-idle surface
    // onto every desk frame (`frames.rs`); on a desk that painted nothing for a while, it wakes the
    // GPU's copies first (#133, `copy_wake.rs`).
    if is_input(message)
        && let Some(browser) = host.browser()
    {
        super::copy_wake::input();
        super::frames::heard(browser.identifier(), super::frames::prompts(message));
    }
    match message {
        M::SurfacePointerMove(m) => {
            let event = mouse(m.x, m.y, modifiers(&m.modifiers, &m.buttons));
            host.send_mouse_move_event(Some(&event), 0);
        }
        M::SurfacePointerLeave(_) => host.send_mouse_move_event(Some(&mouse(-1.0, -1.0, 0)), 1),
        M::SurfacePointerDown(m) => {
            if let Some(b) = button(m.button) {
                let event = mouse(m.x, m.y, modifiers(&m.modifiers, &m.buttons));
                host.send_mouse_click_event(Some(&event), b, 0, m.clicks.min(3) as i32);
            }
        }
        M::SurfacePointerUp(m) => {
            if let Some(b) = button(m.button) {
                let mut held = m.buttons.clone();
                held.push(m.button);
                let event = mouse(m.x, m.y, modifiers(&m.modifiers, &held));
                host.send_mouse_click_event(Some(&event), b, 1, m.clicks.min(3) as i32);
            }
        }
        M::SurfacePointerWheel(m) => {
            let per = match m.unit {
                SurfaceWheelUnit::Pixel => 1.0,
                SurfaceWheelUnit::Line => LINE,
                SurfaceWheelUnit::Page => view_height.max(LINE),
            };
            let event = mouse(m.x, m.y, modifiers(&m.modifiers, &[]));
            let (dx, dy) = ((-m.delta_x * per).round(), (-m.delta_y * per).round());
            host.send_mouse_wheel_event(Some(&event), dx as i32, dy as i32);
        }
        M::SurfaceKeyDown(k) => {
            let mut event = key_event(
                KeyEventType::RAWKEYDOWN,
                &k.code,
                &k.key,
                &k.modifiers,
                false,
            );
            if k.repeat {
                event.modifiers |= flag(cef::sys::cef_event_flags_t::EVENTFLAG_IS_REPEAT);
            }
            // The Mac's editing keys go down with their edit commands (#156, `edit_keys.rs`).
            if !edit_keys::send(host, &event, &k.code, &k.key, &k.modifiers, k.repeat) {
                host.send_key_event(Some(&event));
            }
        }
        M::SurfaceKeyUp(k) => {
            let event = key_event(KeyEventType::KEYUP, &k.code, &k.key, &k.modifiers, true);
            host.send_key_event(Some(&event));
        }
        M::SurfaceKeyChar(c) => {
            let units: Vec<u16> = c.text.encode_utf16().collect();
            if units.len() == 1 {
                let mut event = key_event(KeyEventType::CHAR, "", &c.text, &c.modifiers, false);
                event.windows_key_code = i32::from(units[0]);
                host.send_key_event(Some(&event));
            } else if !units.is_empty() {
                host.ime_commit_text(Some(&c.text.as_str().into()), Some(&replacement(None)), 0);
            }
        }
        M::SurfaceFocusIn(_) => host.set_focus(1),
        M::SurfaceFocusOut(_) => host.set_focus(0),
        M::SurfaceImeComposition(c) => {
            let underlines: Vec<CompositionUnderline> = c
                .underlines
                .iter()
                .map(|u| CompositionUnderline {
                    size: std::mem::size_of::<cef::sys::cef_composition_underline_t>(),
                    range: range(u.range.start, u.range.end),
                    color: 0xff00_0000,
                    background_color: 0,
                    thick: i32::from(u.thick),
                    style: underline_style(u.style),
                })
                .collect();
            let selection = range(c.selection.start, c.selection.end);
            host.ime_set_composition(
                Some(&c.text.as_str().into()),
                Some(&underlines),
                Some(&replacement(c.replacement.as_ref())),
                Some(&selection),
            );
            *composing = Some(c.text.clone());
        }
        M::SurfaceImeCommit(c) => {
            // The composition committed as it stands (the focus moved on): finish it in place.
            if composing.as_deref() == Some(c.text.as_str()) && c.replacement.is_none() {
                host.ime_finish_composing_text(0);
            } else {
                let replacement = replacement(c.replacement.as_ref());
                host.ime_commit_text(Some(&c.text.as_str().into()), Some(&replacement), 0);
            }
            *composing = None;
        }
        M::SurfaceImeCancel(_) => {
            host.ime_cancel_composition();
            *composing = None;
        }
        _ => {}
    }
}

/// A press of Tab (Shift+Tab with `back`) in `host`'s page, whose own focus order moves on from the
/// plugin surface's place that has its focus (#123, `relay.rs`).
pub fn press_tab(host: &BrowserHost, back: bool) {
    // A key: its paint follows at once, as `deliver`'s do (#117).
    if let Some(browser) = host.browser() {
        super::copy_wake::input();
        super::frames::heard(browser.identifier(), true);
    }
    let mods: &[SurfaceModifier] = if back { &[SurfaceModifier::Shift] } else { &[] };
    let down = key_event(KeyEventType::RAWKEYDOWN, "Tab", "Tab", mods, false);
    host.send_key_event(Some(&down));
    let up = key_event(KeyEventType::KEYUP, "Tab", "Tab", mods, true);
    host.send_key_event(Some(&up));
}

fn underline_style(style: SurfaceUnderlineStyle) -> CompositionUnderlineStyle {
    use cef::sys::cef_composition_underline_style_t as S;
    CompositionUnderlineStyle::from(match style {
        SurfaceUnderlineStyle::Solid => S::CEF_CUS_SOLID,
        SurfaceUnderlineStyle::Dotted => S::CEF_CUS_DOT,
        SurfaceUnderlineStyle::Dashed => S::CEF_CUS_DASH,
        SurfaceUnderlineStyle::None => S::CEF_CUS_NONE,
    })
}

/// The flag of the modifier key at DOM `code`, if it is one.
fn modifier_flag(code: &str) -> Option<u32> {
    use cef::sys::cef_event_flags_t as F;
    let f = match code.trim_end_matches("Left").trim_end_matches("Right") {
        "Shift" => F::EVENTFLAG_SHIFT_DOWN,
        "Control" => F::EVENTFLAG_CONTROL_DOWN,
        "Alt" => F::EVENTFLAG_ALT_DOWN,
        "Meta" => F::EVENTFLAG_COMMAND_DOWN,
        _ => return None,
    };
    Some(flag(f))
}

/// One CEF key event for the key at DOM `code` meaning `key`.
fn key_event(
    kind: KeyEventType,
    code: &str,
    key: &str,
    mods: &[SurfaceModifier],
    up: bool,
) -> KeyEvent {
    let mut units = key.encode_utf16();
    let typed = match (units.next(), units.next()) {
        (Some(unit), None) => Some(unit),
        _ => None,
    };
    let character = if cfg!(target_os = "macos") {
        key_codes::mac_character(code).or(typed).unwrap_or(0)
    } else {
        typed.unwrap_or(0)
    };
    let held = |m| mods.contains(&m);
    let plain = key_codes::unmodified(code).map(|c| c as u16);
    let unmodified =
        if held(SurfaceModifier::Alt) || held(SurfaceModifier::Ctrl) || held(SurfaceModifier::Meta)
        {
            plain.unwrap_or(character)
        } else {
            character
        };
    let mut modifiers = modifiers(mods, &[]);
    // A modifier key's own flag says whether it went down or up (macOS reads its events as
    // `flagsChanged`), whatever order the window reported the key and the modifiers in.
    if let Some(own) = modifier_flag(code) {
        if up {
            modifiers &= !own;
        } else {
            modifiers |= own;
        }
    }
    if code.starts_with("Numpad") {
        modifiers |= flag(cef::sys::cef_event_flags_t::EVENTFLAG_IS_KEY_PAD);
    }
    if code.ends_with("Left") && code != "ArrowLeft" {
        modifiers |= flag(cef::sys::cef_event_flags_t::EVENTFLAG_IS_LEFT);
    } else if code.ends_with("Right") && code != "ArrowRight" {
        modifiers |= flag(cef::sys::cef_event_flags_t::EVENTFLAG_IS_RIGHT);
    }
    KeyEvent {
        size: std::mem::size_of::<cef::sys::cef_key_event_t>(),
        type_: kind,
        modifiers,
        windows_key_code: key_codes::virtual_key(code),
        native_key_code: key_codes::native_key(code, up),
        // Windows reports Alt chords as system keys (WM_SYSKEYDOWN).
        is_system_key: i32::from(cfg!(target_os = "windows") && held(SurfaceModifier::Alt)),
        character,
        unmodified_character: unmodified,
        focus_on_editable_field: 0,
    }
}
