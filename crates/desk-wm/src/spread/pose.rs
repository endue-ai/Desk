//! How the spread draws a window and looks at the stage (`Pose`, `Camera`, `mix` in
//! `packages/runtime/src/arrange/spread-model.ts`). The runtime turned a pose into a CSS transform
//! (`transformOf`); the compositor turns it into a 3D transform on the window's quad (#54).

use serde::{Deserialize, Serialize};

/// A window's transform in the spread, about its own centre.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pose {
    pub tx: f64,
    pub ty: f64,
    pub z: f64,
    pub rotate_y: f64,
    pub rotate_x: f64,
    pub scale: f64,
    pub opacity: f64,
}

/// Where the window is on the desk: no move, no turn, full size, opaque.
pub const IDENTITY: Pose = Pose {
    tx: 0.0,
    ty: 0.0,
    z: 0.0,
    rotate_y: 0.0,
    rotate_x: 0.0,
    scale: 1.0,
    opacity: 1.0,
};

/// The spread's camera: panned by `x`, `y` and zoomed about the app's centre.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

/// How far the person can zoom the spread out and in.
pub const ZOOM_MIN: f64 = 0.5;
pub const ZOOM_MAX: f64 = 2.5;

/// Between two poses, `t` from 0 to 1.
pub fn mix(a: Pose, b: Pose, t: f64) -> Pose {
    let at = |from: f64, to: f64| from + (to - from) * t;
    Pose {
        tx: at(a.tx, b.tx),
        ty: at(a.ty, b.ty),
        z: at(a.z, b.z),
        rotate_y: at(a.rotate_y, b.rotate_y),
        rotate_x: at(a.rotate_x, b.rotate_x),
        scale: at(a.scale, b.scale),
        opacity: at(a.opacity, b.opacity),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixing_runs_from_one_pose_to_the_other() {
        let far = Pose {
            tx: 100.0,
            z: -160.0,
            scale: 0.5,
            opacity: 0.0,
            ..IDENTITY
        };
        assert_eq!(mix(IDENTITY, far, 0.0), IDENTITY);
        assert_eq!(mix(IDENTITY, far, 1.0), far);
        let half = mix(IDENTITY, far, 0.5);
        assert_eq!(
            (half.tx, half.z, half.scale, half.opacity),
            (50.0, -80.0, 0.75, 0.5)
        );
    }
}
