//! Where the spread's cards are drawn, not only where their boxes are: the compositor draws each card
//! at its slot's pose under the stage's perspective (`desk_compositor::stage`, what the runtime's CSS
//! did with `perspective: 1800px` at `perspective-origin: 50% 45%`). A front row's outer cards come
//! forward and turn, and the selected card comes further forward and grows, so a card is drawn
//! larger than its box: at 1280×800 a fan of 14 drew its selected outer card into the dock (#158).
//! The stage a count is laid out on is shortened until every card, selected or not, stays on it.

use super::slots::{Slot, flat_slots, spread_slots, spread_stage};
use crate::geometry::MIN;
use crate::types::Rect;

/// How far the eye is from the stage, in CSS pixels (`desk_compositor::stage::PERSPECTIVE`).
pub const PERSPECTIVE: f64 = 1800.0;
/// Where on the app the eye looks straight at, as shares of its width and height
/// (`desk_compositor::stage::ORIGIN`).
pub const ORIGIN: (f64, f64) = (0.5, 0.45);
/// How far the selected card comes towards the viewer in the curved spread.
pub const LIFT: f64 = 56.0;
/// How much the selected card grows.
pub const GROW: f64 = 1.04;
/// How many times the stage is shortened at most; the overshoot shrinks with the cards.
const FITS: usize = 8;

/// The rect a card filling `slot`'s box is drawn in on a `vw`×`vh` app: the box's corners grown by
/// `grow` and turned about its centre (`rotate_y`, then `rotate_x`, as CSS composes them), moved
/// `z` and `lift` towards the viewer and seen through the stage's perspective.
fn seen(slot: &Slot, (vw, vh): (f64, f64), lift: f64, grow: f64) -> Rect {
    let (ox, oy) = (vw * ORIGIN.0, vh * ORIGIN.1);
    let (cx, cy) = (slot.x + slot.w / 2.0, slot.y + slot.h / 2.0);
    let (a, b) = (slot.rotate_y.to_radians(), slot.rotate_x.to_radians());
    let (mut left, mut top) = (f64::INFINITY, f64::INFINITY);
    let (mut right, mut bottom) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for (x, y) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
        let (x, y) = (x * grow * slot.w / 2.0, y * grow * slot.h / 2.0);
        // rotateX(b) then rotateY(a) of the point (x, y, 0); CSS's y is down and z towards the eye.
        let (yb, zb) = (y * b.cos(), y * b.sin());
        let (xa, za) = (x * a.cos() + zb * a.sin(), -x * a.sin() + zb * a.cos());
        let k = PERSPECTIVE / (PERSPECTIVE - (slot.z + lift + za));
        let (sx, sy) = (ox + (cx + xa - ox) * k, oy + (cy + yb - oy) * k);
        left = left.min(sx);
        top = top.min(sy);
        right = right.max(sx);
        bottom = bottom.max(sy);
    }
    Rect::new(left, top, right - left, bottom - top)
}

/// The rect a card filling `slot`'s box is drawn in on a `vw`×`vh` app.
pub fn drawn_box(slot: &Slot, vw: f64, vh: f64) -> Rect {
    seen(slot, (vw, vh), 0.0, 1.0)
}

/// The rect the same card is drawn in while it is selected: grown, and in the curved spread
/// (`flat` false) come forward.
pub fn lifted_box(slot: &Slot, vw: f64, vh: f64, flat: bool) -> Rect {
    seen(slot, (vw, vh), if flat { 0.0 } else { LIFT }, GROW)
}

/// The stage `n` cards are laid out on for a `vw`×`vh` app: the spread's stage, shortened until no
/// card, selected or not, is drawn past its bottom, the dock's band. Its top and sides stay.
pub fn fitted_stage(n: usize, vw: f64, vh: f64, flat: bool) -> Rect {
    let mut stage = spread_stage(vw, vh);
    let floor = stage.bottom();
    for _ in 0..FITS {
        let slots = if flat {
            flat_slots(n, stage)
        } else {
            spread_slots(n, stage, false)
        };
        let reach = (slots.iter())
            .map(|slot| lifted_box(slot, vw, vh, flat).bottom())
            .fold(f64::NEG_INFINITY, f64::max);
        let over = reach - floor;
        if over <= 0.0 || stage.h <= MIN.h {
            break;
        }
        stage.h = MIN.h.max(stage.h - over.ceil());
    }
    stage
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: (f64, f64) = (1280.0, 800.0);

    #[test]
    fn a_card_facing_the_eye_on_the_stage_plane_is_drawn_in_its_box() {
        let slot = flat_slots(1, spread_stage(APP.0, APP.1))[0];
        let drawn = drawn_box(&slot, APP.0, APP.1);
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert!(
            close(drawn.x, slot.x) && close(drawn.y, slot.y),
            "{drawn:?} {slot:?}"
        );
        assert!(
            close(drawn.w, slot.w) && close(drawn.h, slot.h),
            "{drawn:?} {slot:?}"
        );
    }

    #[test]
    fn a_card_that_comes_forward_is_drawn_larger_than_its_box_and_larger_still_selected() {
        let slots = spread_slots(14, spread_stage(APP.0, APP.1), false);
        let outer = slots
            .iter()
            .find(|s| s.z > 0.0)
            .expect("an outer front card");
        let drawn = drawn_box(outer, APP.0, APP.1);
        let lifted = lifted_box(outer, APP.0, APP.1, false);
        assert!(
            drawn.h > outer.h && drawn.bottom() > outer.y + outer.h,
            "{drawn:?}"
        );
        assert!(
            lifted.h > drawn.h && lifted.bottom() > drawn.bottom(),
            "{lifted:?}"
        );
    }

    #[test]
    fn the_fitted_stage_keeps_the_spreads_top_and_sides() {
        let plain = spread_stage(APP.0, APP.1);
        let fitted = fitted_stage(14, APP.0, APP.1, false);
        assert_eq!((fitted.x, fitted.y, fitted.w), (plain.x, plain.y, plain.w));
        assert!(fitted.h < plain.h);
    }
}
