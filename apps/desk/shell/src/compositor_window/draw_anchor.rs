//! Which corner of a window a picture of another size is drawn from, and how what lies in the
//! window follows the frame drawn (ADR 0211). A window drawn from its own page is its picture's
//! size until the page paints the size it was given, a frame or more behind a resize. Drawn from
//! the place's top left, a window resized by its top or left edge showed its old picture at the new
//! corner: its bottom or right edge, which the person holds still, jumped by the resize and came
//! back with the next paint, and a window stretched upward looked moved, not grown. The picture is
//! drawn from the corner the resize left where it was instead: the edges that stay put stay put,
//! and the edge dragged shows the new size once the page has painted it.
//!
//! A pane's plugin lies in the frame as drawn, not in the place the page has yet to paint: at the
//! frame's far edges it keeps its inset from it, so no content is drawn past the frame.

use std::collections::BTreeMap;

use desk_compositor::Rect;
use desk_wm::host::Plan;

/// How near (CSS pixels) two places of an edge count as the same: under any resize step.
const SAME: f64 = 0.01;
/// How near (CSS pixels) the frame's far edge a box counts as lying at it: its border and gap.
const AT_EDGE: f32 = 4.0;

/// The corner a picture of another size is drawn from: the top left, unless the window's last
/// resize moved its left edge (`right`) or its top edge (`bottom`) and left the other where it was.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Anchor {
    pub right: bool,
    pub bottom: bool,
}

impl Anchor {
    /// The anchor after the window went from `was` to `now`: an axis whose one edge moved and
    /// whose other stayed is anchored at the one that stayed; else as it was (a move shifts both,
    /// a rest neither).
    fn after(self, was: desk_wm::Rect, now: desk_wm::Rect) -> Anchor {
        let same = |a: f64, b: f64| (a - b).abs() < SAME;
        let axis = |kept: bool, (near0, far0): (f64, f64), (near1, far1): (f64, f64)| match (
            same(near0, near1),
            same(far0, far1),
        ) {
            (true, false) => false,
            (false, true) => true,
            _ => kept,
        };
        Anchor {
            right: axis(self.right, (was.x, was.x + was.w), (now.x, now.x + now.w)),
            bottom: axis(self.bottom, (was.y, was.y + was.h), (now.y, now.y + now.h)),
        }
    }
}

/// Every window's anchor, followed from one layout of the scene to the next.
#[derive(Debug, Default)]
pub struct Anchors {
    seen: BTreeMap<String, (desk_wm::Rect, Anchor)>,
}

impl Anchors {
    /// Take the windows of `plan` as the scene is laid out from it: each one's anchor from where
    /// it was at the last layout. A window not in it (closed, on another desktop) is forgotten.
    pub fn follow(&mut self, plan: &Plan) {
        let seen = (plan.windows.iter())
            .map(|w| {
                let anchor = (self.seen.get(&w.id))
                    .map_or_else(Anchor::default, |(was, anchor)| anchor.after(*was, w.rect));
                (w.id.clone(), (w.rect, anchor))
            })
            .collect();
        self.seen = seen;
    }

    /// Window `id`'s anchor: the top left for one never seen.
    pub fn of(&self, id: &str) -> Anchor {
        self.seen
            .get(id)
            .map(|(_, anchor)| *anchor)
            .unwrap_or_default()
    }
}

/// `placed` sized to a picture of `size` device pixels at `scale`, from the corner `anchor` names;
/// as placed while the picture is its size, to a device pixel.
pub fn pictured(placed: Rect, (tw, th): (u32, u32), scale: f32, anchor: Anchor) -> Rect {
    let (w, h) = (tw as f32 / scale, th as f32 / scale);
    let near = |a: f32, b: f32| ((a - b) * scale).abs() <= 1.0;
    if near(placed.width, w) && near(placed.height, h) {
        return placed;
    }
    let x = if anchor.right {
        placed.x + placed.width - w
    } else {
        placed.x
    };
    let y = if anchor.bottom {
        placed.y + placed.height - h
    } else {
        placed.y
    };
    Rect::new(x, y, w, h)
}

/// `part` of a window laid out `laid` wide and high (its box from the window's top left), in the
/// frame drawn `drawn` wide and high: where it lay at the window's right or bottom edge it keeps
/// its inset from the frame's, and elsewhere it ends where it did or at the frame, whichever comes
/// first. Unchanged while the frame is the window's size.
pub fn within(part: Rect, laid: (f32, f32), drawn: (f32, f32)) -> Rect {
    let span = |from: f32, len: f32, laid: f32, drawn: f32| {
        let inset = laid - (from + len);
        let to = if inset.abs() <= AT_EDGE {
            drawn - inset
        } else {
            (from + len).min(drawn)
        };
        (to - from).max(0.0)
    };
    Rect::new(
        part.x,
        part.y,
        span(part.x, part.width, laid.0, drawn.0),
        span(part.y, part.height, laid.1, drawn.1),
    )
}

#[cfg(test)]
#[path = "draw_anchor_tests.rs"]
mod tests;
