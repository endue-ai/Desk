//! The camera: scene units are target pixels on the z = 0 plane, origin top-left, y down.
//!
//! Both projections look at the z = 0 plane from the same eye, so a flat node lands on the same
//! pixels either way; the perspective one only shows when a node is tilted out of the plane (the
//! spread view). +z points into the screen, away from the viewer.

use crate::types::Rect;
use glam::{Mat4, Vec2, Vec3, Vec4};

/// The vertical field of view [`Projection::perspective`] uses.
pub const DEFAULT_FOV_Y: f32 = 40.0 * std::f32::consts::PI / 180.0;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Projection {
    /// Flat: tilted nodes look foreshortened along their axis only.
    #[default]
    Orthographic,
    /// Seen through a lens of vertical field of view `fov_y` (radians).
    Perspective { fov_y: f32 },
}

impl Projection {
    pub fn perspective() -> Projection {
        Projection::Perspective {
            fov_y: DEFAULT_FOV_Y,
        }
    }
}

/// A ray in some space: `origin + t * direction`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Ray {
    pub origin: Vec3,
    pub direction: Vec3,
}

impl Ray {
    /// The ray in the space `to_space` maps into (pass a world-to-local matrix).
    pub fn transformed(&self, to_space: &Mat4) -> Ray {
        let origin = to_space.project_point3(self.origin);
        let end = to_space.project_point3(self.origin + self.direction);
        Ray {
            origin,
            direction: end - origin,
        }
    }

    /// Where the ray meets the z = 0 plane, `None` when it runs parallel or the plane is behind it.
    pub fn hit_plane(&self) -> Option<Vec2> {
        if self.direction.z.abs() < 1e-9 {
            return None;
        }
        let t = -self.origin.z / self.direction.z;
        let point = self.origin + self.direction * t;
        (t >= 0.0 && point.is_finite()).then(|| point.truncate())
    }
}

/// The view-projection for one viewport, and its inverse for hit testing.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Camera {
    pub view_projection: Mat4,
    inverse: Mat4,
    viewport: Vec2,
}

impl Camera {
    pub fn new(projection: Projection, viewport: (u32, u32)) -> Camera {
        let (w, h) = (viewport.0.max(1) as f32, viewport.1.max(1) as f32);
        let fov = match projection {
            Projection::Perspective { fov_y } => fov_y.clamp(1e-3, 3.0),
            Projection::Orthographic => DEFAULT_FOV_Y,
        };
        let distance = (h / 2.0) / (fov / 2.0).tan();
        let center = Vec3::new(w / 2.0, h / 2.0, 0.0);
        let eye = center - Vec3::Z * distance;
        let view = Mat4::look_at_rh(eye, center, Vec3::NEG_Y);
        let (near, far) = (1.0, distance * 20.0);
        let projection = match projection {
            Projection::Perspective { .. } => Mat4::perspective_rh(fov, w / h, near, far),
            Projection::Orthographic => {
                Mat4::orthographic_rh(-w / 2.0, w / 2.0, -h / 2.0, h / 2.0, near, far)
            }
        };
        let view_projection = projection * view;
        Camera {
            view_projection,
            inverse: view_projection.inverse(),
            viewport: Vec2::new(w, h),
        }
    }

    /// The ray through screen pixel `point`, in scene (world) space.
    pub fn ray(&self, point: Vec2) -> Ray {
        let ndc = Vec2::new(
            point.x / self.viewport.x * 2.0 - 1.0,
            1.0 - point.y / self.viewport.y * 2.0,
        );
        let near = self.inverse.project_point3(ndc.extend(0.0));
        let far = self.inverse.project_point3(ndc.extend(1.0));
        Ray {
            origin: near,
            direction: far - near,
        }
    }

    /// Screen pixel of a point given in a space `model` maps to world; `None` behind the eye.
    pub fn project(&self, model: &Mat4, point: Vec2) -> Option<Vec2> {
        let clip = self.view_projection * *model * Vec4::new(point.x, point.y, 0.0, 1.0);
        if clip.w <= 1e-6 {
            return None;
        }
        let ndc = clip.truncate() / clip.w;
        Some(Vec2::new(
            (ndc.x + 1.0) / 2.0 * self.viewport.x,
            (1.0 - ndc.y) / 2.0 * self.viewport.y,
        ))
    }

    /// The screen rectangle covering `rect` (in `model`'s space), clamped to the viewport; the whole
    /// viewport when a corner falls behind the eye.
    pub fn screen_bounds(&self, model: &Mat4, rect: &Rect) -> Option<Rect> {
        let corners = [
            rect.min(),
            Vec2::new(rect.x + rect.width, rect.y),
            rect.max(),
            Vec2::new(rect.x, rect.y + rect.height),
        ];
        let mut points = corners.iter().map(|c| self.project(model, *c));
        let full = self.full();
        let first = match points.next().flatten() {
            Some(p) => p,
            None => return Some(full),
        };
        let (mut min, mut max) = (first, first);
        for p in points {
            let Some(p) = p else { return Some(full) };
            (min, max) = (min.min(p), max.max(p));
        }
        Rect::from_corners(min, max).round_out().intersect(&full)
    }

    /// The whole viewport.
    pub fn full(&self) -> Rect {
        Rect::new(0.0, 0.0, self.viewport.x, self.viewport.y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Vec2, b: Vec2) -> bool {
        (a - b).length() < 1e-2
    }

    #[test]
    fn the_z0_plane_maps_one_unit_to_one_pixel_in_both_projections() {
        for projection in [Projection::Orthographic, Projection::perspective()] {
            let camera = Camera::new(projection, (256, 160));
            for p in [Vec2::ZERO, Vec2::new(256.0, 160.0), Vec2::new(17.5, 99.25)] {
                let screen = camera.project(&Mat4::IDENTITY, p).unwrap();
                assert!(close(screen, p), "{projection:?}: {p} -> {screen}");
                let back = camera.ray(p).hit_plane().unwrap();
                assert!(close(back, p), "{projection:?}: ray {p} -> {back}");
            }
        }
    }

    #[test]
    fn perspective_foreshortens_a_tilted_plane_and_orthographic_does_not_shift_it() {
        let tilt = Mat4::from_translation(Vec3::new(128.0, 80.0, 0.0))
            * Mat4::from_rotation_y(0.5)
            * Mat4::from_translation(Vec3::new(-128.0, -80.0, 0.0));
        let ortho = Camera::new(Projection::Orthographic, (256, 160));
        let persp = Camera::new(Projection::perspective(), (256, 160));
        let a = ortho.project(&tilt, Vec2::new(0.0, 0.0)).unwrap();
        let b = persp.project(&tilt, Vec2::new(0.0, 0.0)).unwrap();
        assert!((a.y - 0.0).abs() < 1e-3, "ortho keeps y: {a}");
        assert!((b.y - 0.0).abs() > 0.5, "perspective moves y: {b}");
    }

    #[test]
    fn screen_bounds_round_out_and_clamp() {
        let camera = Camera::new(Projection::Orthographic, (100, 100));
        let r = camera
            .screen_bounds(&Mat4::IDENTITY, &Rect::new(-5.0, 10.2, 50.0, 20.0))
            .unwrap();
        assert_eq!(r, Rect::new(0.0, 10.0, 45.0, 21.0));
        assert_eq!(
            camera.screen_bounds(&Mat4::IDENTITY, &Rect::new(200.0, 0.0, 5.0, 5.0)),
            None
        );
    }
}
