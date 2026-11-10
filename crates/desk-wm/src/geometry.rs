//! The reference frame and the free area (`packages/runtime/src/surface/geometry.ts`).
//!
//! Floating windows are stored in the 1440×900 reference frame and mapped onto the app's window.
//! Smaller apps move them inwards and shrink them, each axis on its own: a shorter app takes
//! height, a narrower one width. They never shrink below the minimum size, and a window may be
//! dragged to every edge of the app: the bars float above it. Windows open and tile in the free
//! area (`free_area`); a fill takes the whole app (ADR 0132).

use crate::math::round;
use crate::types::{Insets, Rect, Size};

/// The reference frame floating windows are stored in.
pub const REF: Size = Size {
    w: 1440.0,
    h: 900.0,
};

/// Where the bars sit, the one record of it: the side bars and the rail 24 + 56 + 24 from each
/// side, the profile switcher and the desktops 72 from the top, the drawer button, the composer and
/// the running chips 88 from the bottom. Windows open, tile and fill inside it.
pub const SAFE: Insets = Insets {
    left: 104.0,
    right: 104.0,
    top: 72.0,
    bottom: 88.0,
};

/// The smallest a window gets.
pub const MIN: Size = Size { w: 240.0, h: 160.0 };

/// Where Eris sits by default (centred, 40 px from the top, 138 px tall): windows tile below her.
pub const BELOW_ERIS: f64 = 190.0;

/// The free area between the bars and under Eris's place in the reference frame: where plugin
/// windows open. A window can still be dragged or resized over the bars, which stay on top.
pub const FREE: Rect = free_area(REF.w, REF.h, BELOW_ERIS);

/// The whole app window of `vw`×`vh` pixels: how far a window can move and grow.
pub const fn screen_area(vw: f64, vh: f64) -> Rect {
    Rect::new(0.0, 0.0, vw, vh)
}

/// Where the free area starts: under Eris while she sits in her default place, where she floats
/// above every window as the bars do, and under the profile switcher and the desktops once she is
/// moved.
pub const fn free_top(eris_at_home: bool) -> f64 {
    if eris_at_home { BELOW_ERIS } else { SAFE.top }
}

/// The part of a `vw`×`vh` app no bar covers, from `top` down (`SAFE.top` when Eris is away):
/// where windows open and what arranging tiles (ADR 0040's free area).
pub const fn free_area(vw: f64, vh: f64, top: f64) -> Rect {
    Rect::new(
        SAFE.left,
        top,
        MIN.w.max(vw - SAFE.left - SAFE.right),
        MIN.h.max(vh - top - SAFE.bottom),
    )
}

/// Positions follow the app both ways; sizes only shrink, width with the width, height with the
/// height: `(kx, ky, sx, sy)`.
fn factors(vw: f64, vh: f64) -> (f64, f64, f64, f64) {
    let kx = (vw - SAFE.left - SAFE.right) / (REF.w - SAFE.left - SAFE.right);
    let ky = (vh - SAFE.top - SAFE.bottom) / (REF.h - SAFE.top - SAFE.bottom);
    (kx, ky, kx.min(1.0), ky.min(1.0))
}

/// A rect of the reference frame on a `vw`×`vh` app.
pub fn to_screen(p: Rect, vw: f64, vh: f64) -> Rect {
    let (kx, ky, sx, sy) = factors(vw, vh);
    let w = MIN.w.max(round(p.w * sx));
    let h = MIN.h.max(round(p.h * sy));
    let x = round(SAFE.left + (p.x - SAFE.left) * kx);
    let y = round(SAFE.top + (p.y - SAFE.top) * ky);
    clamp_rect(Rect::new(x, y, w, h), vw, vh)
}

/// The inverse, for a window the person dragged or resized on screen.
pub fn from_screen(r: Rect, vw: f64, vh: f64) -> Rect {
    let (kx, ky, sx, sy) = factors(vw, vh);
    Rect::new(
        round(SAFE.left + (r.x - SAFE.left) / kx),
        round(SAFE.top + (r.y - SAFE.top) / ky),
        round(r.w / sx),
        round(r.h / sy),
    )
}

/// Keep a dragged rect inside the app window: as large as it, never off it.
pub fn clamp_rect(r: Rect, vw: f64, vh: f64) -> Rect {
    let w = MIN.w.max(r.w.min(vw));
    let h = MIN.h.max(r.h.min(vh));
    Rect::new(0f64.max(r.x.min(vw - w)), 0f64.max(r.y.min(vh - h)), w, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_free_area_of_the_reference_frame_sits_under_eris() {
        assert_eq!(FREE, Rect::new(104.0, 190.0, 1232.0, 622.0));
        assert_eq!(free_area(1440.0, 900.0, free_top(false)).y, SAFE.top);
        // A tiny app keeps the minimum.
        assert_eq!(
            free_area(100.0, 100.0, SAFE.top),
            Rect::new(104.0, 72.0, 240.0, 160.0)
        );
    }
}
