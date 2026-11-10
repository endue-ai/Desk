//! The canvas map's geometry (`packages/runtime/src/shell/minimap-model.ts`, ADR 0082): the world
//! that the desktop's normal windows and the part in sight span, fitted into the map's box, and the
//! pan that puts the part in sight where the map points. World pixels are the canvas's; map pixels
//! are the box's. Drawing the map from the windows' textures is the compositor's (#54).

use serde::{Deserialize, Serialize};

use crate::math::round;
use crate::types::{Offset, Rect, Size};

/// The map's box in CSS pixels, in the 1440×900 frame's proportions.
pub const MAP: Size = Size { w: 192.0, h: 120.0 };
/// Room around what the map shows, as a share of the world's longer side.
const MARGIN: f64 = 0.06;

/// World to map: one scale for both axes, then an offset that centres the world in the box.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fit {
    pub scale: f64,
    pub x: f64,
    pub y: f64,
}

/// The part of the canvas in sight at `pan` in a `vw`×`vh` app.
pub fn view_rect(pan: Offset, vw: f64, vh: f64) -> Rect {
    Rect::new(0.0 - pan.x, 0.0 - pan.y, vw, vh)
}

/// What the map shows: every window and the part in sight, with a margin round them.
pub fn world_of(windows: &[Rect], view: Rect) -> Rect {
    let (mut x0, mut y0, mut x1, mut y1) = (view.x, view.y, view.right(), view.bottom());
    for r in windows {
        x0 = x0.min(r.x);
        y0 = y0.min(r.y);
        x1 = x1.max(r.right());
        y1 = y1.max(r.bottom());
    }
    let m = (x1 - x0).max(y1 - y0) * MARGIN;
    Rect::new(x0 - m, y0 - m, x1 - x0 + 2.0 * m, y1 - y0 + 2.0 * m)
}

/// Fit `world` into `map` whole, centred on the axis it does not fill (`MAP` for the canvas map).
pub fn fit_world(world: Rect, map: Size) -> Fit {
    let scale = (map.w / world.w.max(1.0)).min(map.h / world.h.max(1.0));
    Fit {
        scale,
        x: (map.w - world.w * scale) / 2.0 - world.x * scale,
        y: (map.h - world.h * scale) / 2.0 - world.y * scale,
    }
}

/// A world rect in the map.
pub fn to_map(r: Rect, f: Fit) -> Rect {
    Rect::new(
        r.x * f.scale + f.x,
        r.y * f.scale + f.y,
        r.w * f.scale,
        r.h * f.scale,
    )
}

/// A map point in the world.
pub fn to_world(x: f64, y: f64, f: Fit) -> Offset {
    Offset::new((x - f.x) / f.scale, (y - f.y) / f.scale)
}

/// The pan that centres the part in sight on the world point `at`.
pub fn pan_centred_on(at: Offset, vw: f64, vh: f64) -> Offset {
    Offset::new(round(vw / 2.0 - at.x), round(vh / 2.0 - at.y))
}

/// Dragging the part in sight by `dx`, `dy` map pixels moves the canvas the other way, scaled up.
pub fn pan_moved_by(start: Offset, dx: f64, dy: f64, f: Fit) -> Offset {
    Offset::new(round(start.x - dx / f.scale), round(start.y - dy / f.scale))
}

/// An arrow key (`"ArrowLeft"`, ...) moves the part in sight a quarter of itself; `whole` (Shift),
/// a whole view. `None` for any other key.
pub fn pan_by_key(pan: Offset, key: &str, whole: bool, vw: f64, vh: f64) -> Option<Offset> {
    let k = if whole { 1.0 } else { 0.25 };
    let (sx, sy) = (round(vw * k), round(vh * k));
    match key {
        "ArrowLeft" => Some(Offset::new(pan.x + sx, pan.y)),
        "ArrowRight" => Some(Offset::new(pan.x - sx, pan.y)),
        "ArrowUp" => Some(Offset::new(pan.x, pan.y + sy)),
        "ArrowDown" => Some(Offset::new(pan.x, pan.y - sy)),
        _ => None,
    }
}
