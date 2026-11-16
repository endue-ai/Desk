//! Magnetic edges: a window moved or resized with an edge close to another window's edge, or to an
//! edge of the app's free area, is pulled flush with it, so windows line up side by side or one
//! above the other without pixel hunting. Pure over rects: the drag passes the rect the pointer
//! asks for, the other windows on screen and the free area, and draws what comes back.
//!
//! An edge pulls only to edges it could meet: a vertical edge to another window's left or right
//! edge when the two windows overlap top to bottom (or nearly), a horizontal edge likewise. Of the
//! edges in reach the closest wins, on each axis apart.

use crate::types::{Rect, Size};

/// How close, in pixels, an edge has to come to another before it is pulled flush.
pub const MAGNET: f64 = 10.0;

/// Which edges of a window a resize moves.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Edges {
    pub left: bool,
    pub right: bool,
    pub top: bool,
    pub bottom: bool,
}

/// Whether the spans `a0..a1` and `b0..b1` overlap, or come within `MAGNET` of each other.
fn near(a0: f64, a1: f64, b0: f64, b1: f64) -> bool {
    a0 <= b1 + MAGNET && b0 <= a1 + MAGNET
}

/// The x of every vertical edge `r` could meet: the other windows' beside it, the area's.
fn targets_x(r: Rect, others: &[Rect], area: Rect) -> Vec<f64> {
    let mut xs = vec![area.x, area.right()];
    for o in others
        .iter()
        .filter(|o| near(r.y, r.bottom(), o.y, o.bottom()))
    {
        xs.extend([o.x, o.right()]);
    }
    xs
}

/// The y of every horizontal edge `r` could meet.
fn targets_y(r: Rect, others: &[Rect], area: Rect) -> Vec<f64> {
    let mut ys = vec![area.y, area.bottom()];
    for o in others
        .iter()
        .filter(|o| near(r.x, r.right(), o.x, o.right()))
    {
        ys.extend([o.y, o.bottom()]);
    }
    ys
}

/// The smallest shift, within `MAGNET`, that puts one of `edges` on one of `targets`.
fn pull(edges: &[f64], targets: &[f64]) -> Option<f64> {
    let mut best: Option<f64> = None;
    for e in edges {
        for t in targets {
            let d = t - e;
            if d.abs() <= MAGNET && best.is_none_or(|b| d.abs() < b.abs()) {
                best = Some(d);
            }
        }
    }
    best
}

/// A window moved to `r`: shifted so its closest edges in reach sit flush.
pub fn magnet_move(r: Rect, others: &[Rect], area: Rect) -> Rect {
    let dx = pull(&[r.x, r.right()], &targets_x(r, others, area)).unwrap_or(0.0);
    let dy = pull(&[r.y, r.bottom()], &targets_y(r, others, area)).unwrap_or(0.0);
    Rect::new(r.x + dx, r.y + dy, r.w, r.h)
}

/// A window resized to `r` by `edges`: each moving edge in reach sits flush, the opposite edges
/// where they are, never smaller than `least`.
pub fn magnet_resize(r: Rect, edges: Edges, others: &[Rect], area: Rect, least: Size) -> Rect {
    let (mut left, mut right, mut top, mut bottom) = (r.x, r.right(), r.y, r.bottom());
    let xs = targets_x(r, others, area);
    let ys = targets_y(r, others, area);
    if edges.left
        && let Some(d) = pull(&[left], &xs)
        && right - (left + d) >= least.w
    {
        left += d;
    }
    if edges.right
        && let Some(d) = pull(&[right], &xs)
        && right + d - left >= least.w
    {
        right += d;
    }
    if edges.top
        && let Some(d) = pull(&[top], &ys)
        && bottom - (top + d) >= least.h
    {
        top += d;
    }
    if edges.bottom
        && let Some(d) = pull(&[bottom], &ys)
        && bottom + d - top >= least.h
    {
        bottom += d;
    }
    Rect::new(left, top, right - left, bottom - top)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect::new(0.0, 40.0, 1600.0, 1000.0);
    const LEAST: Size = Size { w: 200.0, h: 120.0 };

    #[test]
    fn a_move_close_to_a_neighbour_sits_flush_beside_it() {
        let other = Rect::new(100.0, 200.0, 400.0, 300.0);
        let r = magnet_move(Rect::new(507.0, 260.0, 300.0, 200.0), &[other], AREA);
        assert_eq!(r, Rect::new(500.0, 260.0, 300.0, 200.0));
        let r = magnet_move(Rect::new(-205.0, 260.0, 300.0, 200.0), &[other], AREA);
        assert_eq!(r.right(), 100.0);
    }

    #[test]
    fn a_move_beyond_reach_stays_where_the_pointer_put_it() {
        let other = Rect::new(100.0, 200.0, 400.0, 300.0);
        let asked = Rect::new(520.0, 260.0, 300.0, 200.0);
        assert_eq!(magnet_move(asked, &[other], AREA), asked);
    }

    #[test]
    fn a_neighbour_far_above_or_below_does_not_pull_sideways() {
        let other = Rect::new(100.0, 200.0, 400.0, 300.0);
        let asked = Rect::new(505.0, 700.0, 300.0, 200.0);
        assert_eq!(magnet_move(asked, &[other], AREA), asked);
    }

    #[test]
    fn a_window_stacked_under_another_lines_up_with_it() {
        let other = Rect::new(100.0, 200.0, 400.0, 300.0);
        let r = magnet_move(Rect::new(104.0, 506.0, 300.0, 200.0), &[other], AREA);
        assert_eq!(r, Rect::new(100.0, 500.0, 300.0, 200.0));
    }

    #[test]
    fn the_free_area_s_edges_pull_too() {
        let r = magnet_move(Rect::new(6.0, 47.0, 300.0, 200.0), &[], AREA);
        assert_eq!(r, Rect::new(0.0, 40.0, 300.0, 200.0));
        let r = magnet_move(Rect::new(1295.0, 300.0, 300.0, 200.0), &[], AREA);
        assert_eq!(r.right(), 1600.0);
    }

    #[test]
    fn the_closest_edge_wins() {
        let a = Rect::new(100.0, 200.0, 400.0, 300.0);
        let b = Rect::new(800.0, 200.0, 300.0, 300.0);
        // Left edge 8 px from a's right, right edge 3 px from b's left.
        let r = magnet_move(Rect::new(508.0, 250.0, 289.0, 100.0), &[a, b], AREA);
        assert_eq!(r.x, 511.0);
        assert_eq!(r.right(), 800.0);
    }

    #[test]
    fn a_resize_pulls_only_the_edges_it_moves() {
        let other = Rect::new(600.0, 200.0, 400.0, 300.0);
        let east = Edges {
            right: true,
            ..Edges::default()
        };
        let r = magnet_resize(
            Rect::new(91.0, 196.0, 503.0, 300.0),
            east,
            &[other],
            AREA,
            LEAST,
        );
        assert_eq!(r, Rect::new(91.0, 196.0, 509.0, 300.0));
    }

    #[test]
    fn a_resize_never_pulls_below_the_least_size() {
        let other = Rect::new(100.0, 200.0, 400.0, 300.0);
        let west = Edges {
            left: true,
            ..Edges::default()
        };
        // Pulling the left edge to 500 would leave 195 px, less than 200.
        let asked = Rect::new(492.0, 250.0, 203.0, 200.0);
        assert_eq!(magnet_resize(asked, west, &[other], AREA, LEAST), asked);
    }
}
