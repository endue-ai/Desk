//! winit's window events as the compositor's input (#56): positions in the window's device pixels,
//! keys by the DOM's `key` and `code`, wheel deltas signed as the DOM's (winit's count up for "the
//! content moves down"), the IME's preedit and commit, and the OS's file drags.

use desk_compositor::input::{Button, ImeInput, Input, KeyInput, Modifiers};
use desk_surface::generated::SurfaceWheelUnit;
use winit::event::{ElementState, Ime, MouseButton, MouseScrollDelta, WindowEvent};
use winit::keyboard::{Key, NamedKey};

use crate::web_host::key_codes;

/// The DOM's `KeyboardEvent.key` for winit's logical key.
pub fn dom_key(key: &Key) -> String {
    match key {
        Key::Character(text) => text.to_string(),
        Key::Named(NamedKey::Space) => " ".to_owned(),
        Key::Named(NamedKey::Super) => "Meta".to_owned(),
        Key::Named(named) => format!("{named:?}"),
        Key::Dead(_) => "Dead".to_owned(),
        Key::Unidentified(_) => "Unidentified".to_owned(),
    }
}

/// The input a window event is, if any.
pub fn input_of(event: &WindowEvent) -> Option<Input> {
    Some(match event {
        WindowEvent::CursorMoved { position, .. } => Input::PointerMoved {
            x: position.x as f32,
            y: position.y as f32,
        },
        WindowEvent::CursorLeft { .. } => Input::PointerLeft,
        WindowEvent::MouseInput { state, button, .. } => Input::PointerButton {
            button: match button {
                MouseButton::Left => Button::Left,
                MouseButton::Right => Button::Right,
                MouseButton::Middle => Button::Middle,
                MouseButton::Back => Button::Back,
                MouseButton::Forward => Button::Forward,
                MouseButton::Other(_) => return None,
            },
            pressed: *state == ElementState::Pressed,
        },
        WindowEvent::MouseWheel { delta, .. } => match delta {
            MouseScrollDelta::LineDelta(x, y) => Input::Wheel {
                dx: -f64::from(*x),
                dy: -f64::from(*y),
                unit: SurfaceWheelUnit::Line,
            },
            MouseScrollDelta::PixelDelta(p) => Input::Wheel {
                dx: -p.x,
                dy: -p.y,
                unit: SurfaceWheelUnit::Pixel,
            },
        },
        WindowEvent::ModifiersChanged(mods) => {
            let state = mods.state();
            Input::Modifiers(Modifiers {
                shift: state.shift_key(),
                ctrl: state.control_key(),
                alt: state.alt_key(),
                meta: state.super_key(),
                caps_lock: false,
            })
        }
        WindowEvent::KeyboardInput { event, .. } => Input::Key(KeyInput {
            key: dom_key(&event.logical_key),
            code: key_codes::dom_code(event.physical_key).to_owned(),
            text: event.text.as_ref().map(|t| t.to_string()),
            pressed: event.state == ElementState::Pressed,
            repeat: event.repeat,
        }),
        WindowEvent::Ime(ime) => Input::Ime(match ime {
            Ime::Enabled => ImeInput::Enabled,
            Ime::Preedit(text, cursor) => ImeInput::Preedit {
                text: text.clone(),
                cursor: *cursor,
            },
            Ime::Commit(text) => ImeInput::Commit { text: text.clone() },
            Ime::Disabled => ImeInput::Disabled,
        }),
        WindowEvent::HoveredFile(path) => Input::FileHovered {
            path: path.to_string_lossy().into_owned(),
        },
        WindowEvent::DroppedFile(path) => Input::FileDropped {
            path: path.to_string_lossy().into_owned(),
        },
        WindowEvent::HoveredFileCancelled => Input::FileHoverCancelled,
        WindowEvent::Focused(focused) => Input::WindowFocused { focused: *focused },
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::dom_key;
    use winit::keyboard::{Key, NamedKey};

    #[test]
    fn winits_keys_are_named_as_the_dom_names_them() {
        assert_eq!(dom_key(&Key::Character("ㅎ".into())), "ㅎ");
        assert_eq!(dom_key(&Key::Named(NamedKey::ArrowLeft)), "ArrowLeft");
        assert_eq!(dom_key(&Key::Named(NamedKey::Space)), " ");
        assert_eq!(dom_key(&Key::Named(NamedKey::Super)), "Meta");
        assert_eq!(dom_key(&Key::Named(NamedKey::Enter)), "Enter");
        assert_eq!(dom_key(&Key::Dead(Some('´'))), "Dead");
    }
}
