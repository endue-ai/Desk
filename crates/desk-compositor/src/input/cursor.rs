//! The cursor (`input.md` § Cursor): each surface says which cursor it wants while the pointer is
//! over it (a CSS keyword, or an image it drew); the compositor shows the one of the surface the
//! pointer is for (the one under it, or the one a press holds). While the desk drags, the cursor
//! says what a drop would do: copy, link, or nothing.

use std::collections::HashMap;

use desk_surface::generated::{SurfaceCursor, SurfaceCursorName, SurfaceDropAnswer};

/// What the OS window shows.
#[derive(Clone, Debug, PartialEq)]
pub enum CursorChoice {
    Named(SurfaceCursorName),
    /// A PNG (base64) the surface drew, its hotspot in the image's pixels, drawn for `scale`.
    Image {
        png: String,
        hotspot: (u64, u64),
        scale: f64,
    },
}

#[derive(Clone, Debug, Default)]
pub struct Cursors {
    by_surface: HashMap<String, SurfaceCursor>,
    shown: Option<CursorChoice>,
}

fn choice(cursor: &SurfaceCursor) -> CursorChoice {
    match cursor {
        SurfaceCursor::SurfaceNamed(named) => CursorChoice::Named(named.name),
        SurfaceCursor::SurfaceImage(image) => CursorChoice::Image {
            png: image.png.clone(),
            hotspot: (image.hotspot_x, image.hotspot_y),
            scale: image.scale,
        },
    }
}

/// The cursor a drag shows for the effect its target answered.
pub fn drag_cursor(effect: SurfaceDropAnswer) -> SurfaceCursorName {
    match effect {
        SurfaceDropAnswer::Copy => SurfaceCursorName::Copy,
        SurfaceDropAnswer::Link => SurfaceCursorName::Alias,
        SurfaceDropAnswer::Move => SurfaceCursorName::Default,
        SurfaceDropAnswer::None => SurfaceCursorName::NoDrop,
    }
}

impl Cursors {
    /// Surface `surface` wants `cursor` while the pointer is over it.
    pub fn set(&mut self, surface: &str, cursor: SurfaceCursor) {
        self.by_surface.insert(surface.to_owned(), cursor);
    }

    pub fn forget(&mut self, surface: &str) {
        self.by_surface.remove(surface);
    }

    /// What the window shows for the surface the pointer is for, or for a drag's answer; the new
    /// choice when it changed.
    pub fn update(
        &mut self,
        pointer_for: Option<&str>,
        drag: Option<SurfaceDropAnswer>,
    ) -> Option<CursorChoice> {
        let now = match drag {
            Some(effect) => CursorChoice::Named(drag_cursor(effect)),
            None => pointer_for
                .and_then(|s| self.by_surface.get(s))
                .map_or(CursorChoice::Named(SurfaceCursorName::Default), choice),
        };
        if self.shown.as_ref() == Some(&now) {
            return None;
        }
        self.shown = Some(now.clone());
        Some(now)
    }

    /// The cursor the window shows now.
    pub fn shown(&self) -> Option<&CursorChoice> {
        self.shown.as_ref()
    }
}
