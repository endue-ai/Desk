//! Where arranged windows go (ADR 0116; the tile and cascade half of
//! `packages/runtime/src/arrange/geometry.ts`): a grid that fills an area, and a cascade down from
//! its top left. Pure over rects and counts: the same count in the same area always gives the same
//! places. The spread's places are `spread::slots`.

use serde::{Deserialize, Serialize};

use crate::geometry::{MIN, free_area, free_top};
use crate::math::round;
use crate::types::{Rect, Size};

/// The cell shape a grid aims for: windows on a desk read best a little wider than tall.
pub const TARGET_ASPECT: f64 = 4.0 / 3.0;

/// A grid's columns and rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridShape {
    pub cols: usize,
    pub rows: usize,
}

/// What arranging fills: the app between the side bars and above the bottom line, and under Eris
/// while she sits in her default place at the top (the area plugin windows open in, ADR 0040).
pub fn arrange_area(vw: f64, vh: f64, below_eris: bool) -> Rect {
    free_area(vw, vh, free_top(below_eris))
}

/// How many windows each row of a `cols` wide grid of `n` holds: full rows, then the rest.
pub fn row_sizes(n: usize, cols: usize) -> Vec<usize> {
    let cols = cols.max(1);
    (0..n.div_ceil(cols))
        .map(|row| cols.min(n - row * cols))
        .collect()
}

/// The columns and rows for `n` windows in `area`, `gap` apart: the shape whose cells come closest
/// to `TARGET_ASPECT`, a short last row costing a little, so the count follows both the number of
/// windows and the area's aspect (2×2 for four on a wide screen, 3 + 2 for five, 4 × 3 for twelve).
pub fn grid_shape(n: usize, area: Rect, gap: f64) -> GridShape {
    if n <= 1 {
        return GridShape { cols: 1, rows: n };
    }
    let mut best = (GridShape { cols: 1, rows: n }, f64::INFINITY);
    for cols in 1..=n {
        let sizes = row_sizes(n, cols);
        let rows = sizes.len() as f64;
        let h = (area.h - gap * (rows - 1.0)) / rows;
        let off: f64 = sizes
            .iter()
            .map(|&k| {
                let k = k as f64;
                let w = (area.w - gap * (k - 1.0)) / k;
                k * (w / h / TARGET_ASPECT).ln().abs()
            })
            .sum();
        let empty = (cols * sizes.len() - n) as f64;
        let score = off / n as f64 + (0.25 * empty) / cols as f64;
        if score < best.1 - 1e-9 {
            best = (
                GridShape {
                    cols,
                    rows: sizes.len(),
                },
                score,
            );
        }
    }
    best.0
}

/// Cell `i` of `count` across `size` from `from`, `gap` apart: integer edges, the last one flush.
fn span(from: f64, size: f64, count: usize, gap: f64, i: usize) -> (f64, f64) {
    let count = count as f64;
    let i = i as f64;
    let start = from + round((i * (size + gap)) / count);
    let end = from + round(((i + 1.0) * (size + gap)) / count) - gap;
    (start, end - start)
}

/// The tile grid: rows top to bottom, windows left to right in each; a shorter last row stretches
/// across the width, so the cells and the gaps between them fill `area` exactly and never overlap.
pub fn tile_rects(n: usize, area: Rect, gap: f64) -> Vec<Rect> {
    let sizes = row_sizes(n, grid_shape(n, area, gap).cols);
    let rows = sizes.len();
    sizes
        .iter()
        .enumerate()
        .flat_map(|(row, &k)| {
            let (y, h) = span(area.y, area.h, rows, gap, row);
            (0..k).map(move |i| {
                let (x, w) = span(area.x, area.w, k, gap, i);
                Rect::new(x, y, w, h)
            })
        })
        .collect()
}

/// The size every cascaded window takes in `area`: most of it, never under the minimum.
pub fn cascade_size(area: Rect) -> Size {
    Size {
        w: area.w.min(MIN.w.max(round(area.w * 0.6))),
        h: area.h.min(MIN.h.max(round(area.h * 0.65))),
    }
}

/// The cascade: one size for all, each window `step` down and right of the one before from the
/// area's top left (`tiling::CASCADE`). When the next step would leave the area, a new run starts
/// at the top, moved right by the run before's width, so no title bar ever hides exactly under
/// another.
pub fn cascade_rects(n: usize, area: Rect, step: f64) -> Vec<Rect> {
    let Size { w, h } = cascade_size(area);
    let room = (area.w - w).min(area.h - h);
    let per_run = 1f64.max((room / step).floor() + 1.0);
    let shift = 0f64.max(area.w - w - (per_run - 1.0) * step);
    (0..n)
        .map(|i| {
            let i = i as f64;
            let run = (i / per_run).floor();
            let k = i % per_run;
            let x = area.x + (run * per_run * step).min(shift) + k * step;
            Rect::new(x, area.y + k * step, w, h)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_are_full_then_the_rest() {
        assert_eq!(row_sizes(5, 3), [3, 2]);
        assert_eq!(row_sizes(6, 3), [3, 3]);
        assert!(row_sizes(0, 3).is_empty());
        assert_eq!(
            grid_shape(0, Rect::new(0.0, 0.0, 100.0, 100.0), 12.0).rows,
            0
        );
    }
}
