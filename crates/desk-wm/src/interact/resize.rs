//! The eight resize grips (`packages/runtime/src/surface/resize.ts`, the `.surface-resize` rules in
//! `surface/surface.css`): which edges a grip moves, how a rect grows and shrinks from it with the
//! opposite edges anchored, at the minimum size and inside the app for a floating window, the cursor
//! it shows, and where each grip lies in a window: along the edges 6 px thick, 16 px clear of the
//! corners, and a 16 px square in each corner, inside the window's border, above its title bar and
//! its panes.

use serde::{Deserialize, Serialize};

use crate::geometry::MIN;
use crate::host::BORDER;
use crate::types::{Point, Rect};

/// A resize grip, by the edges it moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grip {
    N,
    Ne,
    E,
    Se,
    S,
    Sw,
    W,
    Nw,
}

/// Every grip, in the runtime's order (`RESIZE_DIRECTIONS`).
pub const GRIPS: [Grip; 8] = [
    Grip::N,
    Grip::Ne,
    Grip::E,
    Grip::Se,
    Grip::S,
    Grip::Sw,
    Grip::W,
    Grip::Nw,
];

/// How thick an edge's grip is.
pub const EDGE: f64 = 6.0;
/// A corner's grip, square; the edges' grips keep this clear of the corners.
pub const CORNER: f64 = 16.0;

impl Grip {
    pub fn north(self) -> bool {
        matches!(self, Grip::N | Grip::Ne | Grip::Nw)
    }

    pub fn south(self) -> bool {
        matches!(self, Grip::S | Grip::Se | Grip::Sw)
    }

    pub fn east(self) -> bool {
        matches!(self, Grip::E | Grip::Ne | Grip::Se)
    }

    pub fn west(self) -> bool {
        matches!(self, Grip::W | Grip::Nw | Grip::Sw)
    }

    /// The cursor it shows, as CSS names it (`resizeCursor`).
    pub fn cursor(self) -> &'static str {
        match self {
            Grip::N | Grip::S => "ns-resize",
            Grip::E | Grip::W => "ew-resize",
            Grip::Ne | Grip::Sw => "nesw-resize",
            Grip::Se | Grip::Nw => "nwse-resize",
        }
    }

    /// Where it lies in a window drawn at `window`: inside its border.
    pub fn rect_in(self, window: Rect) -> Rect {
        let inner = Rect::new(
            window.x + BORDER,
            window.y + BORDER,
            (window.w - 2.0 * BORDER).max(0.0),
            (window.h - 2.0 * BORDER).max(0.0),
        );
        let along_x = Rect::new(
            inner.x + CORNER,
            0.0,
            (inner.w - 2.0 * CORNER).max(0.0),
            0.0,
        );
        let along_y = Rect::new(
            0.0,
            inner.y + CORNER,
            0.0,
            (inner.h - 2.0 * CORNER).max(0.0),
        );
        let left = inner.x;
        let right = inner.right();
        let top = inner.y;
        let bottom = inner.bottom();
        match self {
            Grip::N => Rect::new(along_x.x, top, along_x.w, EDGE),
            Grip::S => Rect::new(along_x.x, bottom - EDGE, along_x.w, EDGE),
            Grip::E => Rect::new(right - EDGE, along_y.y, EDGE, along_y.h),
            Grip::W => Rect::new(left, along_y.y, EDGE, along_y.h),
            Grip::Nw => Rect::new(left, top, CORNER, CORNER),
            Grip::Ne => Rect::new(right - CORNER, top, CORNER, CORNER),
            Grip::Sw => Rect::new(left, bottom - CORNER, CORNER, CORNER),
            Grip::Se => Rect::new(right - CORNER, bottom - CORNER, CORNER, CORNER),
        }
    }
}

/// The grip of a window drawn at `window` under `at`, if any: the corners first, as they lie above
/// the edges' ends.
pub fn grip_at(window: Rect, at: Point) -> Option<Grip> {
    let inside = |r: Rect| at.x >= r.x && at.x < r.right() && at.y >= r.y && at.y < r.bottom();
    [
        Grip::Nw,
        Grip::Ne,
        Grip::Sw,
        Grip::Se,
        Grip::N,
        Grip::E,
        Grip::S,
        Grip::W,
    ]
    .into_iter()
    .find(|g| inside(g.rect_in(window)))
}

/// `start` resized from `grip` by `dx`, `dy`: the grabbed edges move, the opposite ones stay, never
/// below the minimum size; with `bounds` (a floating window: the app) the grabbed edges stop there.
pub fn resize_rect(start: Rect, grip: Grip, dx: f64, dy: f64, bounds: Option<Rect>) -> Rect {
    let mut left = start.x;
    let mut top = start.y;
    let mut right = left + start.w;
    let mut bottom = top + start.h;
    let (min_x, max_x) = bounds.map_or((f64::NEG_INFINITY, f64::INFINITY), |b| (b.x, b.right()));
    let (min_y, max_y) = bounds.map_or((f64::NEG_INFINITY, f64::INFINITY), |b| (b.y, b.bottom()));
    if grip.west() {
        left = (right - MIN.w).min(min_x.max(left + dx));
    }
    if grip.east() {
        right = (left + MIN.w).max(max_x.min(right + dx));
    }
    if grip.north() {
        top = (bottom - MIN.h).min(min_y.max(top + dy));
    }
    if grip.south() {
        bottom = (top + MIN.h).max(max_y.min(bottom + dy));
    }
    Rect::new(left, top, right - left, bottom - top)
}
