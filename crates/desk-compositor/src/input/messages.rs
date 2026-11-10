//! The surface protocol's input messages, built in one place (`specs/surface/v0/input.md`, `ime.md`).

use desk_surface::generated::{
    CompositorMessage as M, SurfaceFocusIn, SurfaceFocusOut, SurfaceImeCancel, SurfaceImeCommit,
    SurfaceImeComposition, SurfaceImeUnderline, SurfaceKeyChar, SurfaceKeyDown, SurfaceKeyUp,
    SurfacePointerButton, SurfacePointerDown, SurfacePointerLeave, SurfacePointerMove,
    SurfacePointerUp, SurfacePointerWheel, SurfaceTextRange, SurfaceUnderlineStyle,
    SurfaceWheelUnit,
};
use glam::Vec2;

use super::events::{Button, Modifiers};

fn buttons(held: &[Button]) -> Vec<SurfacePointerButton> {
    held.iter().map(|b| b.protocol()).collect()
}

pub fn pointer_move(surface: &str, at: Vec2, held: &[Button], mods: Modifiers) -> M {
    M::SurfacePointerMove(SurfacePointerMove {
        r#type: Default::default(),
        surface: surface.to_owned(),
        x: f64::from(at.x),
        y: f64::from(at.y),
        buttons: buttons(held),
        modifiers: mods.list(),
    })
}

/// A press (`down`) or a release of `button` with `held` after it.
pub fn pointer_button(
    surface: &str,
    at: Vec2,
    button: Button,
    down: bool,
    held: &[Button],
    clicks: u64,
    mods: Modifiers,
) -> M {
    let (x, y, button, buttons, modifiers) = (
        f64::from(at.x),
        f64::from(at.y),
        button.protocol(),
        buttons(held),
        mods.list(),
    );
    let surface = surface.to_owned();
    if down {
        M::SurfacePointerDown(SurfacePointerDown {
            r#type: Default::default(),
            surface,
            x,
            y,
            button,
            buttons,
            clicks,
            modifiers,
        })
    } else {
        M::SurfacePointerUp(SurfacePointerUp {
            r#type: Default::default(),
            surface,
            x,
            y,
            button,
            buttons,
            clicks,
            modifiers,
        })
    }
}

pub fn pointer_wheel(
    surface: &str,
    at: Vec2,
    delta: (f64, f64),
    unit: SurfaceWheelUnit,
    mods: Modifiers,
) -> M {
    M::SurfacePointerWheel(SurfacePointerWheel {
        r#type: Default::default(),
        surface: surface.to_owned(),
        x: f64::from(at.x),
        y: f64::from(at.y),
        delta_x: delta.0,
        delta_y: delta.1,
        unit,
        modifiers: mods.list(),
    })
}

pub fn pointer_leave(surface: &str) -> M {
    M::SurfacePointerLeave(SurfacePointerLeave {
        r#type: Default::default(),
        surface: surface.to_owned(),
    })
}

pub fn key_down(surface: &str, key: &str, code: &str, mods: Modifiers, repeat: bool) -> M {
    M::SurfaceKeyDown(SurfaceKeyDown {
        r#type: Default::default(),
        surface: surface.to_owned(),
        key: key.to_owned(),
        code: code.to_owned(),
        modifiers: mods.list(),
        repeat,
    })
}

pub fn key_up(surface: &str, key: &str, code: &str, mods: Modifiers) -> M {
    M::SurfaceKeyUp(SurfaceKeyUp {
        r#type: Default::default(),
        surface: surface.to_owned(),
        key: key.to_owned(),
        code: code.to_owned(),
        modifiers: mods.list(),
    })
}

pub fn key_char(surface: &str, text: &str, mods: Modifiers) -> M {
    M::SurfaceKeyChar(SurfaceKeyChar {
        r#type: Default::default(),
        surface: surface.to_owned(),
        text: text.to_owned(),
        modifiers: mods.list(),
    })
}

pub fn focus(surface: &str, gained: bool) -> M {
    let surface = surface.to_owned();
    if gained {
        M::SurfaceFocusIn(SurfaceFocusIn {
            r#type: Default::default(),
            surface,
        })
    } else {
        M::SurfaceFocusOut(SurfaceFocusOut {
            r#type: Default::default(),
            surface,
        })
    }
}

/// The text composed so far, `selection` in UTF-16 units; the clause selected (when the caret is
/// a range) is the thick one.
pub fn ime_composition(surface: &str, text: &str, selection: (u64, u64)) -> M {
    let length = text.encode_utf16().count() as u64;
    let range = |start, end| SurfaceTextRange { start, end };
    let mut underlines = vec![SurfaceImeUnderline {
        range: range(0, length),
        style: SurfaceUnderlineStyle::Solid,
        thick: false,
    }];
    if selection.0 < selection.1 {
        underlines.push(SurfaceImeUnderline {
            range: range(selection.0, selection.1),
            style: SurfaceUnderlineStyle::Solid,
            thick: true,
        });
    }
    M::SurfaceImeComposition(SurfaceImeComposition {
        r#type: Default::default(),
        surface: surface.to_owned(),
        text: text.to_owned(),
        underlines,
        selection: range(selection.0, selection.1),
        replacement: None,
    })
}

pub fn ime_commit(surface: &str, text: &str) -> M {
    M::SurfaceImeCommit(SurfaceImeCommit {
        r#type: Default::default(),
        surface: surface.to_owned(),
        text: text.to_owned(),
        replacement: None,
    })
}

pub fn ime_cancel(surface: &str) -> M {
    M::SurfaceImeCancel(SurfaceImeCancel {
        r#type: Default::default(),
        surface: surface.to_owned(),
    })
}

/// The UTF-16 offset of byte offset `byte` of `text` (clamped to a character boundary).
pub fn utf16_at(text: &str, byte: usize) -> u64 {
    let mut end = byte.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].encode_utf16().count() as u64
}
