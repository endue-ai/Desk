//! Where windows come to rest, on whole device pixels (#250, ADR 0209). The pointer, a pan and a
//! glide leave fractions of a CSS pixel; a window drawn at one has its page filtered between
//! pixels and its frame's edges soft. A drop, a resize, a keyboard step and a pan of the canvas
//! keep their place on the display's pixel grid (`scale` device pixels to a CSS pixel), so what is
//! stored is what is drawn; a move under the pointer and a glide stay where they are, smooth.

use crate::math::round;
use crate::types::{Offset, Rect};

/// `v` CSS pixels on the nearest whole device pixel at `scale`.
pub fn on_pixel(v: f64, scale: f64) -> f64 {
    let s = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    round(v * s) / s + 0.0
}

/// `r` with its corner and its size on whole device pixels at `scale`: its size never changes with
/// where it is.
pub fn on_pixels(r: Rect, scale: f64) -> Rect {
    let px = |v: f64| on_pixel(v, scale);
    Rect::new(px(r.x), px(r.y), px(r.w), px(r.h))
}

/// A pan on whole device pixels at `scale`: a canvas left there moves its windows by whole pixels.
pub fn pan_on_pixels(pan: Offset, scale: f64) -> Offset {
    Offset::new(on_pixel(pan.x, scale), on_pixel(pan.y, scale))
}

/// Whether two rects are within a device pixel of each other on every edge: nothing to glide.
pub fn within_a_pixel(a: Rect, b: Rect, scale: f64) -> bool {
    let pixel = 1.0 / if scale > 0.0 { scale } else { 1.0 };
    let near = |p: f64, q: f64| (p - q).abs() < pixel;
    near(a.x, b.x) && near(a.y, b.y) && near(a.right(), b.right()) && near(a.bottom(), b.bottom())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_place_lands_on_the_device_grid_at_every_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let r = on_pixels(Rect::new(510.4, 450.6, 401.3, 299.9), scale);
            for v in [r.x, r.y, r.w, r.h, r.right(), r.bottom()] {
                let device = v * scale;
                assert!((device - device.round()).abs() < 1e-9, "{scale}: {v}");
            }
            assert!((r.x - 510.4).abs() <= 0.5 / scale + 1e-9);
        }
        assert_eq!(on_pixels(Rect::new(510.4, 450.6, 10.0, 10.0), 1.0).x, 510.0);
        assert_eq!(on_pixel(510.4, 1.25), 510.4, "638 device pixels");
        assert_eq!(on_pixel(-0.2, 1.0), 0.0);
        assert!(on_pixel(-0.2, 1.0).is_sign_positive());
        assert_eq!(on_pixel(7.3, 0.0), 7.0, "no scale: CSS pixels");
    }

    #[test]
    fn its_size_does_not_change_with_where_it_lands() {
        let a = on_pixels(Rect::new(10.4, 0.0, 300.5, 10.0), 1.0);
        let b = on_pixels(Rect::new(10.6, 0.0, 300.5, 10.0), 1.0);
        assert_eq!(a.w, b.w);
    }

    #[test]
    fn rects_a_pixel_apart_glide_and_closer_ones_do_not() {
        let at = Rect::new(10.0, 10.0, 100.0, 100.0);
        assert!(within_a_pixel(at, Rect::new(10.4, 9.6, 100.0, 100.0), 1.0));
        assert!(!within_a_pixel(
            at,
            Rect::new(11.0, 10.0, 100.0, 100.0),
            1.0
        ));
        assert!(!within_a_pixel(
            at,
            Rect::new(10.0, 10.0, 100.6, 100.0),
            2.0
        ));
    }
}
