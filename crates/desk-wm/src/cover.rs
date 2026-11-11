//! The order the windows stack in, and which plugin surfaces the windows hide
//! (`packages/runtime/src/surface/cover.ts`, ADR 0070).
//!
//! The windows stack in the order of use (ADR XXXX): the window in use on top of every other, then
//! the windows floating by choice, then the rest (normal and filled ones), each kind in the order
//! it was last in use; those never in use since the desk started stack under the others as they
//! did before it kept that order, floating and filled ones above the rest, in desk order.
//! A plugin shown only in windows that are wholly covered by windows drawn above them, or off the
//! screen, is out of sight, and the live budget may put its process to sleep. Pure, from the
//! windows in desk order, the order of use and the screen's size.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::coordinates::{is_floating, screen_rect};
use crate::types::{Offset, Placement, Rect};

/// Added to the level of a window floating by choice: it stays put while the canvas moves under
/// it, so it is drawn above every normal or filled window not in use (ADR 0082).
const FLOATING: usize = 200;
/// Added to a pinned window's rank: above the unpinned ones of its kind.
const PINNED: usize = 50;
/// The window in use: above every other, whatever it is (ADR XXXX).
const IN_USE: usize = 300;
/// How many windows the order of use remembers; one that falls out was the least recent, and
/// stacks with the windows never in use, which are under every other anyway.
const REMEMBERED: usize = 64;

/// The windows in the order they were last put in use, the least recent first: what stacks the
/// windows that are not in use. A window comes on top of it whenever it takes the focus.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UseOrder(Vec<String>);

impl UseOrder {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The windows remembered, the least recent first.
    pub fn ids(&self) -> &[String] {
        &self.0
    }

    /// Window `id` was put in use: it is the most recent now.
    pub fn touch(&mut self, id: &str) {
        if self.0.last().is_some_and(|last| last == id) {
            return;
        }
        self.0.retain(|other| other != id);
        self.0.push(id.to_string());
        if self.0.len() > REMEMBERED {
            self.0.remove(0);
        }
    }

    /// Each of `windows`' (one desktop's, in desk order) place in the order of use, from the
    /// back: the windows never in use first, those on the canvas under the floating and filled
    /// ones, each in desk order (a restored session's fill stays above its other windows), then
    /// the others, the least recent first.
    pub fn ranks(&self, windows: &[Placement]) -> Vec<usize> {
        let mut order: Vec<usize> = (0..windows.len()).collect();
        order.sort_by_key(|&i| {
            let p = &windows[i];
            match self.0.iter().position(|id| *id == p.id) {
                Some(at) => (true, false, at),
                None => (false, is_floating(p), i),
            }
        });
        let mut ranks = vec![0; windows.len()];
        for (rank, i) in order.into_iter().enumerate() {
            ranks[i] = rank;
        }
        ranks
    }

    /// Each of `windows`' stacking level (`z_of`), with `focused` in use.
    pub fn levels(&self, windows: &[Placement], focused: Option<&str>) -> Vec<usize> {
        (windows.iter().zip(self.ranks(windows)))
            .map(|(p, rank)| z_of(p, rank, focused))
            .collect()
    }

    /// `windows` back to front, each with its level; equal levels keep desk order.
    pub fn stack<'a>(
        &self,
        windows: &'a [Placement],
        focused: Option<&str>,
    ) -> Vec<(usize, &'a Placement)> {
        let levels = self.levels(windows, focused);
        let mut all: Vec<(usize, &Placement)> = levels.into_iter().zip(windows).collect();
        all.sort_by_key(|(level, _)| *level);
        all
    }
}

/// Whether `p` floats by choice: a floating window that fills nothing. A fill floats only to keep
/// its part of the app (ADR 0128), and stacks with the normal windows.
fn floats_above(p: &Placement) -> bool {
    is_floating(p) && p.fill.is_none()
}

/// A window's stacking level from its place in the order of use (`rank`, `UseOrder::ranks`): the
/// focused one above every other; windows floating by choice above the normal and filled ones;
/// within each, pinned ones above the rest, then the order of use.
pub fn z_of(p: &Placement, rank: usize, focused: Option<&str>) -> usize {
    if focused == Some(p.id.as_str()) {
        return IN_USE;
    }
    let level = if p.pinned { PINNED + rank } else { 1 + rank };
    if floats_above(p) {
        FLOATING + level
    } else {
        level
    }
}

/// The plugin ids out of sight among those the `windows` of a desktop show (in desk order, at
/// their stacking `levels`), with the canvas at `pan` on a `vw`×`vh` app. `plugins_of` names what a
/// window shows (`placed::shown_plugins`).
pub fn covered_plugins(
    windows: &[Placement],
    levels: &[usize],
    plugins_of: impl Fn(&Placement) -> Vec<String>,
    pan: Offset,
    vw: f64,
    vh: f64,
) -> BTreeSet<String> {
    let screen = Rect::new(0.0, 0.0, vw, vh);
    let drawn: Vec<(Option<Rect>, usize, Vec<String>)> = windows
        .iter()
        .zip(levels)
        .map(|(p, z)| {
            let rect = clip(screen_rect(p, pan, vw, vh), screen);
            (rect, *z, plugins_of(p))
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

    #[test]
    fn the_order_of_use_remembers_a_bounded_number_of_windows_the_least_recent_leave_first() {
        let mut used = UseOrder::default();
        for n in 0..=REMEMBERED {
            used.touch(&format!("w{n}"));
        }
        used.touch("w1");
        assert_eq!(used.ids().len(), REMEMBERED);
        assert_eq!(used.ids().first().map(String::as_str), Some("w2"));
        assert_eq!(used.ids().last().map(String::as_str), Some("w1"));
    }
}
