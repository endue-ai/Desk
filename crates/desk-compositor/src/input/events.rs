//! The input the compositor hears from its OS window, as winit reports it but without winit: the shell
//! turns each window event into one of these, and a test harness feeds the same ones. Positions are
//! the scene's units (the window's device pixels, origin top left).

use desk_surface::generated::{SurfaceModifier, SurfacePointerButton, SurfaceWheelUnit};
use serde::{Deserialize, Serialize};

use super::keymap::KeyLike;

/// The modifier keys held, and Caps Lock.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Modifiers {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    /// Command on macOS, Windows or Super elsewhere.
    pub meta: bool,
    #[serde(rename = "capsLock")]
    pub caps_lock: bool,
}

impl Modifiers {
    /// As the surface protocol lists them.
    pub fn list(&self) -> Vec<SurfaceModifier> {
        let held = [
            (self.shift, SurfaceModifier::Shift),
            (self.ctrl, SurfaceModifier::Ctrl),
            (self.alt, SurfaceModifier::Alt),
            (self.meta, SurfaceModifier::Meta),
            (self.caps_lock, SurfaceModifier::CapsLock),
        ];
        held.into_iter()
            .filter(|(on, _)| *on)
            .map(|(_, m)| m)
            .collect()
    }
}

/// A pointer button.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Button {
    Left,
    Middle,
    Right,
    Back,
    Forward,
}

impl Button {
    pub fn protocol(self) -> SurfacePointerButton {
        match self {
            Button::Left => SurfacePointerButton::Left,
            Button::Middle => SurfacePointerButton::Middle,
            Button::Right => SurfacePointerButton::Right,
            Button::Back => SurfacePointerButton::Back,
            Button::Forward => SurfacePointerButton::Forward,
        }
    }
}

/// A key going down or up: the DOM's `key` and `code`, the text it types (after the layout and dead
/// keys) and whether the OS repeats it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct KeyInput {
    pub key: String,
    pub code: String,
    pub text: Option<String>,
    pub pressed: bool,
    pub repeat: bool,
}

/// What the OS input method says (winit's `Ime`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "ime", rename_all = "lowercase")]
pub enum ImeInput {
    Enabled,
    /// The text being composed; `cursor` is the caret or selection in it, in bytes; empty text
    /// clears the composition (a commit or a cancel follows).
    Preedit {
        text: String,
        #[serde(default)]
        cursor: Option<(usize, usize)>,
    },
    Commit {
        text: String,
    },
    Disabled,
}

/// One event of the compositor's window.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Input {
    PointerMoved {
        x: f32,
        y: f32,
    },
    PointerButton {
        button: Button,
        pressed: bool,
    },
    /// Signed as the DOM's `WheelEvent`: positive `dy` scrolls toward the end (down). Pixel deltas
    /// are device pixels here; the surface hears logical ones.
    Wheel {
        dx: f64,
        dy: f64,
        unit: SurfaceWheelUnit,
    },
    PointerLeft,
    Modifiers(Modifiers),
    Key(KeyInput),
    Ime(ImeInput),
    /// A file from the OS is dragged over the window (one event per file, at once).
    FileHovered {
        path: String,
    },
    /// The OS drag dropped its files (one event per file, at once).
    FileDropped {
        path: String,
    },
    FileHoverCancelled,
    /// The window got or lost the OS focus.
    WindowFocused {
        focused: bool,
    },
}

/// The key press the keymap reads.
pub fn key_like(key: &KeyInput, mods: Modifiers) -> KeyLike {
    KeyLike {
        key: key.key.clone(),
        code: (!key.code.is_empty()).then(|| key.code.clone()),
        meta: mods.meta,
        ctrl: mods.ctrl,
        alt: mods.alt,
        shift: mods.shift,
        repeat: key.repeat,
    }
}
