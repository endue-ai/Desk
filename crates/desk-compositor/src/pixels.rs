//! A surface laid one texel to one device pixel (#250, ADR 0209). A texture another process
//! rendered at the target's scale shows as sharp as it was rendered only when each of its texels
//! lands on one whole pixel of the target: a window dropped at 510.4 on a 1x display, filtered
//! where it lands, lost a quarter of its edge contrast. When a surface's group maps its texels
//! one to one onto the target (no rotation, no tilt, a scale that makes one texel one pixel), the
//! draw list moves it by less than half a pixel so its texel grid is the target's, rounds its
//! edges to whole pixels, and the shader reads each pixel's texel as it is.

use crate::types::Rect;
use glam::Mat4;

/// How far, in pixels over the surface's width or height, the scale may be off one texel a pixel
/// and still count as one to one: float error, not a zoom.
const SLACK: f32 = 1.0 / 64.0;

/// A surface on whole pixels: its rect and uv for the draw list, and the target pixel its
/// texture's first texel lands on.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Whole {
    pub rect: Rect,
    pub uv: Rect,
    pub origin: [f32; 2],
}

/// `rect` (in the space `world` maps to target pixels) showing the `uv` part of a `texture`-sized
/// texture, on whole pixels; `None` when its texels do not map one to one onto the target.
pub(crate) fn whole(world: &Mat4, rect: Rect, uv: Rect, texture: (u32, u32)) -> Option<Whole> {
    let (sx, sy) = flat_scale(world)?;
    let (tw, th) = (texture.0.max(1) as f32, texture.1.max(1) as f32);
    let one = |pixels: f32, texels: f32| pixels > 0.0 && (pixels - texels).abs() <= SLACK;
    if !one(rect.width * sx, uv.width * tw) || !one(rect.height * sy, uv.height * th) {
        return None;
    }
    let (tx, ty) = (world.w_axis.x, world.w_axis.y);
    let x = Axis::of(rect.x * sx + tx, rect.width * sx, uv.x * tw, tw)?;
    let y = Axis::of(rect.y * sy + ty, rect.height * sy, uv.y * th, th)?;
    Some(Whole {
        rect: Rect::new(
            (x.from - tx) / sx,
            (y.from - ty) / sy,
            (x.to - x.from) / sx,
            (y.to - y.from) / sy,
        ),
        uv: Rect::new(
            (x.from - x.origin) / tw,
            (y.from - y.origin) / th,
            (x.to - x.from) / tw,
            (y.to - y.from) / th,
        ),
        origin: [x.origin, y.origin],
    })
}

/// One axis on whole pixels: where the texture's first texel lands, and the part's edges.
struct Axis {
    origin: f32,
    from: f32,
    to: f32,
}

impl Axis {
    /// The part drawn from target pixel `at`, `len` pixels long, showing texels from `texel` on.
    fn of(at: f32, len: f32, texel: f32, texels: f32) -> Option<Axis> {
        let origin = (at - texel).round();
        let shift = origin - (at - texel);
        // Edges on whole pixels, never past the texture's own.
        let from = (at + shift).round().max(origin);
        let to = (at + len + shift).round().min(origin + texels);
        (to > from && origin.is_finite()).then_some(Axis { origin, from, to })
    }
}

/// The scale `world` gives x and y on the target, when it only scales and moves in the z = 0
/// plane: no rotation, skew, tilt, mirror or perspective of its own.
fn flat_scale(world: &Mat4) -> Option<(f32, f32)> {
    const EPS: f32 = 1e-5;
    let (x, y, w) = (world.x_axis, world.y_axis, world.w_axis);
    let flat = x.y.abs() < EPS
        && x.z.abs() < EPS
        && x.w.abs() < EPS
        && y.x.abs() < EPS
        && y.z.abs() < EPS
        && y.w.abs() < EPS
        && w.z.abs() < EPS
        && (w.w - 1.0).abs() < EPS;
    (flat && x.x > 0.0 && y.y > 0.0).then_some((x.x, y.y))
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::Vec3;

    fn at(scale: f32, x: f32, y: f32) -> Mat4 {
        Mat4::from_translation(Vec3::new(x * scale, y * scale, 0.0))
            * Mat4::from_scale(Vec3::new(scale, scale, 1.0))
    }

    #[test]
    fn a_window_at_a_fraction_lands_its_texels_on_whole_pixels_at_every_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            // A 300×200 CSS px surface at (510.4, 450.6), its texture rendered at the scale.
            let texture = ((300.0 * scale) as u32, (200.0 * scale) as u32);
            let rect = Rect::new(0.0, 0.0, 300.0, 200.0);
            let world = at(scale, 510.4, 450.6);
            let got = whole(&world, rect, Rect::UNIT, texture).expect("one to one");
            let (ox, oy) = (got.origin[0], got.origin[1]);
            assert_eq!((ox.fract(), oy.fract()), (0.0, 0.0), "{scale}");
            assert!((ox - 510.4 * scale).abs() <= 0.5, "{scale}: {ox}");
            // Its edges where the texture's are, so each pixel shows one texel.
            let left = world.transform_point3(Vec3::new(got.rect.x, got.rect.y, 0.0));
            assert!(
                (left.x - ox).abs() < 1e-3 && (left.y - oy).abs() < 1e-3,
                "{scale}"
            );
            assert!((got.rect.width * scale - texture.0 as f32).abs() < 1e-3);
            assert_eq!(got.uv, Rect::UNIT, "{scale}");
        }
    }

    #[test]
    fn a_part_cut_from_a_texture_keeps_its_texels_and_ends_on_whole_pixels() {
        // The page's texture at 1.5: a part from CSS (100.5, 40) drawn at (7.25, 3.5).
        let scale = 1.5;
        let texture = (1500, 900);
        let uv = Rect::new(150.75 / 1500.0, 60.0 / 900.0, 300.0 / 1500.0, 90.0 / 900.0);
        let world = at(scale, 7.25, 3.5);
        let got = whole(&world, Rect::new(0.0, 0.0, 200.0, 60.0), uv, texture).unwrap();
        let first = got.uv.x * 1500.0;
        assert!(
            (first - first.round()).abs() < 1e-3,
            "starts on a texel: {first}"
        );
        // Within half a pixel of where it was asked for.
        assert!((got.rect.x * scale).abs() <= 0.5 + 1e-3);
    }

    #[test]
    fn a_scaled_rotated_or_tilted_surface_is_left_to_the_filter() {
        let rect = Rect::new(0.0, 0.0, 100.0, 100.0);
        let thumbnail = Mat4::from_scale(Vec3::new(0.5, 0.5, 1.0));
        assert_eq!(whole(&thumbnail, rect, Rect::UNIT, (100, 100)), None);
        let turned = Mat4::from_rotation_z(0.1);
        assert_eq!(whole(&turned, rect, Rect::UNIT, (100, 100)), None);
        let tilted = Mat4::from_rotation_y(0.3);
        assert_eq!(whole(&tilted, rect, Rect::UNIT, (100, 100)), None);
        // A texture larger than its rect: zoomed out, not one to one.
        assert_eq!(whole(&Mat4::IDENTITY, rect, Rect::UNIT, (101, 100)), None);
    }
}
