//! The two coordinate spaces a window can live in (`packages/runtime/src/surface/coordinates.ts`).
//!
//! Normal windows keep world coordinates and size on the desktop's canvas, moved by its pan;
//! floating ones keep the reference frame and scale with the app; a filled one takes its part of
//! the whole app whatever its size (ADR 0132), a fill kept from when fills stayed between the bars
//! too. The runtime's `appSize` read the DOM: the compositor passes the size it draws at.

use crate::geometry::{from_screen, screen_area, to_screen};
use crate::snap::fill_rect;
use crate::types::{Offset, Placement, Rect};

/// No pan: the canvas's origin at the app's top left.
pub const ORIGIN: Offset = Offset::new(0.0, 0.0);

/// Normal windows (the default) sit on the desktop's canvas; floating ones are pinned to the app.
pub fn is_floating(p: &Placement) -> bool {
    p.floating == Some(true)
}

/// Where `p` is drawn on a `vw`×`vh` app with the canvas at `pan`.
pub fn screen_rect(p: &Placement, pan: Offset, vw: f64, vh: f64) -> Rect {
    if !is_floating(p) {
        return Rect::new(p.x + pan.x, p.y + pan.y, p.w, p.h);
    }
    match p.fill {
        Some(fill) => fill_rect(fill, screen_area(vw, vh)),
        None => to_screen(p.rect(), vw, vh),
    }
}

/// What a window drawn at `r` on screen stores, in the space of its mode.
pub fn stored_rect(r: Rect, floating: bool, pan: Offset, vw: f64, vh: f64) -> Rect {
    if floating {
        from_screen(r, vw, vh)
    } else {
        Rect::new(r.x - pan.x, r.y - pan.y, r.w, r.h)
    }
}
