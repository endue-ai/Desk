//! Snapping (`packages/runtime/src/surface/snap.ts`): a window dragged to one of the app's four
//! edges takes that half of the app, one dragged to a corner takes that quarter (ADR 0128); every
//! fill takes the whole app, the bars floating above it (ADR 0132). Pure over rects: the drag asks
//! with the pointer's place, shows the part while the pointer is there, and the window keeps the
//! fill (`Placement::fill`) so it still fills after the app is resized.

use crate::types::{Fill, Point, Rect};

/// How close to the left, right or bottom edge, in pixels, the pointer has to come to snap. A
/// pointer past the edge (outside a windowed app) is as close as can be.
pub const SNAP: f64 = 24.0;
/// The top is stricter: a window moved up under the bars, not at them, keeps its place.
pub const SNAP_TOP: f64 = 8.0;
/// How far from a corner along an edge, in pixels, the pointer takes the corner's quarter.
pub const CORNER: f64 = 120.0;
/// Between the two halves, or the four quarters, of the area.
const GAP: f64 = 12.0;

/// The two halves of an area side by side.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Halves {
    pub left: Rect,
    pub right: Rect,
}

/// The two halves of an area one above the other.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rows {
    pub top: Rect,
    pub bottom: Rect,
}

/// The two halves of an area side by side, a gap between them.
pub fn halves(area: Rect) -> Halves {
    let w = ((area.w - GAP) / 2.0).floor();
    Halves {
        left: Rect::new(area.x, area.y, w, area.h),
        right: Rect::new(area.x + area.w - w, area.y, w, area.h),
    }
}

/// The two halves of an area one above the other, a gap between them.
pub fn rows(area: Rect) -> Rows {
    let h = ((area.h - GAP) / 2.0).floor();
    Rows {
        top: Rect::new(area.x, area.y, area.w, h),
        bottom: Rect::new(area.x, area.y + h + GAP, area.w, h),
    }
}

/// The part of `area` a fill takes.
pub fn fill_rect(fill: Fill, area: Rect) -> Rect {
    let Halves { left, right } = halves(area);
    let Rows { top, bottom } = rows(area);
    let quarter = |column: Rect, row: Rect| Rect::new(column.x, row.y, column.w, row.h);
    match fill {
        Fill::Full => area,
        Fill::Left => left,
        Fill::Right => right,
        Fill::Top => top,
        Fill::Bottom => bottom,
        Fill::TopLeft => quarter(left, top),
        Fill::TopRight => quarter(right, top),
        Fill::BottomLeft => quarter(left, bottom),
        Fill::BottomRight => quarter(right, bottom),
    }
}

/// Which part a window dragged with the pointer at `pointer` snaps to, or `None` when it stays
/// put. Never `Fill::Full`.
pub fn snap_for(pointer: Point, area: Rect) -> Option<Fill> {
    let left = pointer.x <= area.x + SNAP;
    let right = pointer.x >= area.x + area.w - SNAP;
    let top = pointer.y <= area.y + SNAP.min(SNAP_TOP);
    let bottom = pointer.y >= area.y + area.h - SNAP;
    if !(left || right || top || bottom) {
        return None;
    }
    // Along an edge, the last stretch before a corner is the corner's: a quarter of the edge at
    // most.
    let reach_x = CORNER.min(area.w / 4.0);
    let reach_y = CORNER.min(area.h / 4.0);
    let near_left = left || pointer.x <= area.x + reach_x;
    let near_right = right || pointer.x >= area.x + area.w - reach_x;
    let near_top = top || pointer.y <= area.y + reach_y;
    let near_bottom = bottom || pointer.y >= area.y + area.h - reach_y;
    let snap = if (left || top) && near_left && near_top {
        Fill::TopLeft
    } else if (right || top) && near_right && near_top {
        Fill::TopRight
    } else if (left || bottom) && near_left && near_bottom {
        Fill::BottomLeft
    } else if (right || bottom) && near_right && near_bottom {
        Fill::BottomRight
    } else if left {
        Fill::Left
    } else if right {
        Fill::Right
    } else if top {
        Fill::Top
    } else {
        Fill::Bottom
    };
    Some(snap)
}

/// A drag's aim (`aimSnap`): the part it snaps to while the pointer is where it is. The pointer has
/// to come to the edge from inside the app: a drag that starts in a zone (a title bar grabbed on a
/// window that sits at an edge) aims at nothing until the pointer has left every zone once.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aim {
    area: Rect,
    armed: bool,
}

impl Aim {
    /// A drag that started with the pointer at `from` in an app of `area`.
    pub fn new(from: Point, area: Rect) -> Self {
        Self {
            area,
            armed: snap_for(from, area).is_none(),
        }
    }

    /// The part a drop at `pointer` would snap to, in the app as it was when the drag started.
    pub fn at(&mut self, pointer: Point) -> Option<Fill> {
        self.at_in(pointer, self.area)
    }

    /// The same in the app as it is now, `now`.
    pub fn at_in(&mut self, pointer: Point, now: Rect) -> Option<Fill> {
        let snap = snap_for(pointer, now);
        if snap.is_none() {
            self.armed = true;
        }
        if self.armed { snap } else { None }
    }
}
