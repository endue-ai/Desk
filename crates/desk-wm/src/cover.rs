//! Which plugin surfaces the windows hide (`packages/runtime/src/surface/cover.ts`, ADR 0070): a
//! plugin shown only in windows that are wholly covered by windows drawn above them, or off the
//! screen, is out of sight, and the live budget may put its process to sleep. Pure, from the
//! windows in desk order and the screen's size; the stacking order is the one they are drawn in.

use std::collections::BTreeSet;

use crate::coordinates::{is_floating, screen_rect};
use crate::types::{Offset, Placement, Rect};

/// Added to a floating window's level: floating windows stay put while the canvas moves under
/// them, so they are drawn above every normal one.
const FLOATING: usize = 200;

/// A window's stacking level, from its place in desk order (`index`): floating windows above every
/// normal one; within each, the focused one on top, pinned ones above the rest, in desk order.
pub fn z_of(p: &Placement, index: usize, focused: Option<&str>) -> usize {
    let level = if focused == Some(p.id.as_str()) {
        100
    } else if p.pinned {
        50 + index
    } else {
        1 + index
    };
    if is_floating(p) {
        FLOATING + level
    } else {
        level
    }
}

/// The plugin ids out of sight among those the `windows` of a desktop show (in desk order, as
/// drawn), with the canvas at `pan` on a `vw`×`vh` app. `plugins_of` names what a window shows
/// (`placed::shown_plugins`).
pub fn covered_plugins(
    windows: &[Placement],
    plugins_of: impl Fn(&Placement) -> Vec<String>,
    pan: Offset,
    focused: Option<&str>,
    vw: f64,
    vh: f64,
) -> BTreeSet<String> {
    let screen = Rect::new(0.0, 0.0, vw, vh);
    let drawn: Vec<(Option<Rect>, usize, Vec<String>)> = windows
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let rect = clip(screen_rect(p, pan, vw, vh), screen);
            (rect, z_of(p, i, focused), plugins_of(p))
        })
        .collect();
    let mut hidden = BTreeSet::new();
    let mut seen = BTreeSet::new();
    for (rect, z, plugins) in &drawn {
        let out = match rect {
            None => true,
            Some(target) => {
                let above: Vec<Rect> = drawn
                    .iter()
                    .filter(|(_, other, _)| other > z)
                    .filter_map(|(r, _, _)| *r)
                    .collect();
                covers(&above, *target)
            }
        };
        for id in plugins {
            if !out {
                seen.insert(id.clone());
            } else if !seen.contains(id) {
                hidden.insert(id.clone());
            }
        }
    }
    hidden.retain(|id| !seen.contains(id));
    hidden
}

/// The part of `r` inside `bounds`, or `None` when nothing is.
fn clip(r: Rect, bounds: Rect) -> Option<Rect> {
    let x = r.x.max(bounds.x);
    let y = r.y.max(bounds.y);
    let w = r.right().min(bounds.right()) - x;
    let h = r.bottom().min(bounds.bottom()) - y;
    (w > 0.0 && h > 0.0).then_some(Rect::new(x, y, w, h))
}

/// The edges along one axis: the target's and every rect's within it, sorted, each once.
fn edges(target: (f64, f64), rects: &[Rect], axis: impl Fn(&Rect) -> (f64, f64)) -> Vec<f64> {
    let (from, to) = target;
    let mut all = vec![from, to];
    for r in rects {
        let (start, size) = axis(r);
        all.extend([start, start + size]);
    }
    all.retain(|v| *v >= from && *v <= to);
    all.sort_by(f64::total_cmp);
    all.dedup();
    all
}

/// Whether the rects in `cover` together cover all of `target`: every cell between their edges.
fn covers(cover: &[Rect], target: Rect) -> bool {
    let rects: Vec<Rect> = cover.iter().filter_map(|r| clip(*r, target)).collect();
    if rects.is_empty() {
        return false;
    }
    let xs = edges((target.x, target.right()), &rects, |r| (r.x, r.w));
    let ys = edges((target.y, target.bottom()), &rects, |r| (r.y, r.h));
    xs.windows(2).all(|x| {
        ys.windows(2).all(|y| {
            let cx = (x[0] + x[1]) / 2.0;
            let cy = (y[0] + y[1]) / 2.0;
            rects
                .iter()
                .any(|r| cx > r.x && cx < r.right() && cy > r.y && cy < r.bottom())
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rects_side_by_side_cover_what_they_span_and_a_gap_between_them_does_not() {
        let target = Rect::new(0.0, 0.0, 100.0, 100.0);
        let left = Rect::new(-10.0, -10.0, 60.0, 200.0);
        assert!(covers(&[left, Rect::new(50.0, 0.0, 60.0, 100.0)], target));
        assert!(!covers(&[left, Rect::new(51.0, 0.0, 60.0, 100.0)], target));
        assert!(!covers(&[], target));
    }

    #[test]
    fn clipping_keeps_the_overlap_only() {
        let screen = Rect::new(0.0, 0.0, 100.0, 100.0);
        assert_eq!(
            clip(Rect::new(-20.0, 90.0, 50.0, 50.0), screen),
            Some(Rect::new(0.0, 90.0, 30.0, 10.0))
        );
        assert_eq!(clip(Rect::new(100.0, 0.0, 10.0, 10.0), screen), None);
    }
}
