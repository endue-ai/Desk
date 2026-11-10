//! The spread's stage (#54, ADR 0116): what the runtime's CSS did with `perspective: 1800px` at
//! `perspective-origin: 50% 45%` on the windows' layer and each window's pose, `translate3d(tx, ty,
//! z) rotateY(a) rotateX(b) scale(s)` about its centre, as the compositor's projection and group
//! transforms. CSS's z comes towards the viewer and the compositor's goes into the screen, so depth
//! and both turns change sign; units are CSS pixels inside the stage, which scales them, depth
//! too, to device pixels.

use glam::{Mat4, Vec3};

use crate::camera::Projection;
use crate::types::Rect;

/// How far the eye is from the stage, in CSS pixels.
pub const PERSPECTIVE: f32 = 1800.0;
/// Where on the app the eye looks straight at, as shares of its width and height.
pub const ORIGIN: (f32, f32) = (0.5, 0.45);

/// The camera that sees the z = 0 plane of a `height` CSS pixels tall app one pixel to one, with
/// the eye `PERSPECTIVE` away.
pub fn stage_projection(height: f32) -> Projection {
    Projection::Perspective {
        fov_y: 2.0 * (height.max(1.0) / 2.0 / PERSPECTIVE).atan(),
    }
}

/// The stage group for a `size` CSS pixels app drawn at `scale` device pixels each: its units to
/// the scene's, depth scaled as width and height are, and shifted by depth so the eye looks at
/// `ORIGIN` rather than the app's centre, where the camera looks.
pub fn stage_transform(scale: f32, size: (f32, f32)) -> Mat4 {
    let (w, h) = size;
    // A point `z` deep lands where it would through a lens centred on the origin.
    let lean_x = (ORIGIN.0 - 0.5) * w / PERSPECTIVE;
    let lean_y = (ORIGIN.1 - 0.5) * h / PERSPECTIVE;
    let shear = Mat4::from_cols_array(&[
        1.0, 0.0, 0.0, 0.0, //
        0.0, 1.0, 0.0, 0.0, //
        lean_x, lean_y, 1.0, 0.0, //
        0.0, 0.0, 0.0, 1.0,
    ]);
    Mat4::from_scale(Vec3::splat(scale)) * shear
}

/// A window's pose (`desk_wm::Pose`): moved by `tx`, `ty` and `z` towards the viewer, turned
/// `rotate_y` degrees about its vertical axis, then `rotate_x` about its horizontal one, and scaled,
/// all about the centre of `rect`, where the window is on the desk.
pub fn pose_transform(
    rect: Rect,
    (tx, ty, z): (f32, f32, f32),
    (rotate_y, rotate_x): (f32, f32),
    scale: f32,
) -> Mat4 {
    let centre = Vec3::new(rect.x + rect.width / 2.0, rect.y + rect.height / 2.0, 0.0);
    Mat4::from_translation(centre + Vec3::new(tx, ty, -z))
        * Mat4::from_rotation_y(-rotate_y.to_radians())
        * Mat4::from_rotation_x(-rotate_x.to_radians())
        * Mat4::from_scale(Vec3::new(scale, scale, 1.0))
        * Mat4::from_translation(-centre)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::Camera;
    use glam::Vec2;

    fn close(a: Vec2, b: Vec2) -> bool {
        (a - b).length() < 0.05
    }

    /// Where CSS draws the point `p` of an element `z` deep, seen from `PERSPECTIVE` at `origin`.
    fn css(p: Vec3, origin: Vec2) -> Vec2 {
        let k = PERSPECTIVE / (PERSPECTIVE - p.z);
        origin + (p.truncate() - origin) * k
    }

    #[test]
    fn a_flat_pose_lands_where_css_puts_it_one_pixel_to_one_at_any_scale() {
        let rect = Rect::new(100.0, 80.0, 400.0, 300.0);
        for scale in [1.0, 2.0] {
            let camera = Camera::new(
                stage_projection(900.0),
                ((1440.0 * scale) as u32, (900.0 * scale) as u32),
            );
            let m = stage_transform(scale, (1440.0, 900.0))
                * pose_transform(rect, (20.0, -10.0, 0.0), (0.0, 0.0), 0.5);
            let corner = camera.project(&m, Vec2::new(100.0, 80.0)).unwrap() / scale;
            // About the centre (300, 230): half the size, then moved.
            assert!(close(corner, Vec2::new(220.0, 145.0)), "{corner}");
        }
    }

    #[test]
    fn depth_and_turns_land_where_css_puts_them_through_its_perspective_origin() {
        let (w, h) = (1440.0, 900.0);
        let camera = Camera::new(stage_projection(h), (w as u32, h as u32));
        let rect = Rect::new(200.0, 300.0, 400.0, 300.0);
        let pose = |p: Vec2| {
            let m = stage_transform(1.0, (w, h))
                * pose_transform(rect, (0.0, 0.0, -160.0), (14.0, 3.0), 0.6);
            camera.project(&m, p).unwrap()
        };
        // The same point by CSS's own rules: about the centre, rotateY then rotateX, then back.
        let c = Vec3::new(400.0, 450.0, 0.0);
        let (a, b) = (14.0f32.to_radians(), 3.0f32.to_radians());
        let local = Vec3::new(200.0, 300.0, 0.0) - c;
        let scaled = local * Vec3::new(0.6, 0.6, 1.0);
        // CSS rotateX(b): y' = y cos b - z sin b, z' = y sin b + z cos b.
        let x1 = Vec3::new(
            scaled.x,
            scaled.y * b.cos() - scaled.z * b.sin(),
            scaled.y * b.sin() + scaled.z * b.cos(),
        );
        // CSS rotateY(a): x' = x cos a + z sin a, z' = -x sin a + z cos a.
        let y1 = Vec3::new(
            x1.x * a.cos() + x1.z * a.sin(),
            x1.y,
            -x1.x * a.sin() + x1.z * a.cos(),
        );
        let point = c + y1 + Vec3::new(0.0, 0.0, -160.0);
        let want = css(point, Vec2::new(w * 0.5, h * 0.45));
        let got = pose(Vec2::new(200.0, 300.0));
        assert!(close(got, want), "{got} vs {want}");
    }
}
