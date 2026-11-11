//! Each pane keeps room for its header (#159 finding 19): its title and its close button, at
//! least `PANE_MIN`. A window's minimum grows with its panes, so a resize stops before a pane gets
//! smaller; a resize, a divider's drag and a split move each split's ratio as little as it takes
//! for both sides to keep their minimum where the window has room; and a split that leaves a pane
//! less grows the window. The page lays the panes out by their ratios (`PaneView.ts`), so the
//! ratios are what change, never the layout's rule.

use crate::geometry::MIN;
use crate::host::{BORDER, DIVIDER, TITLE};
use crate::types::{PaneNode, Size, SplitDir};

/// The smallest a pane gets, its 28 px header included.
pub const PANE_MIN: Size = Size { w: 120.0, h: 80.0 };

/// The smallest box `node`'s panes fit in, the dividers between them included.
pub fn min_size(node: &PaneNode) -> Size {
    match node {
        PaneNode::View { .. } => PANE_MIN,
        PaneNode::Split { dir, a, b, .. } => {
            let (a, b) = (min_size(a), min_size(b));
            match dir {
                SplitDir::Row => Size {
                    w: a.w + DIVIDER + b.w,
                    h: a.h.max(b.h),
                },
                SplitDir::Column => Size {
                    w: a.w.max(b.w),
                    h: a.h + DIVIDER + b.h,
                },
            }
        }
    }
}

/// The smallest a window of panes `node` gets: the window's minimum, or its panes' with the border
/// and the title bar round them. One pane needs no more than any window.
pub fn window_min(node: &PaneNode) -> Size {
    let panes = min_size(node);
    Size {
        w: MIN.w.max(panes.w + 2.0 * BORDER),
        h: MIN.h.max(panes.h + 2.0 * BORDER + TITLE),
    }
}

/// The body of a window `w`×`h` pixels: under its title bar, inside its border.
pub fn body_size(w: f64, h: f64) -> Size {
    Size {
        w: (w - 2.0 * BORDER).max(0.0),
        h: (h - 2.0 * BORDER - TITLE).max(0.0),
    }
}

/// `node` laid out in a body `size` big, each split's ratio moved as little as it takes for both
/// sides to keep their minimum, where the split has room for both; a split without that room, or
/// one whose sides have it, keeps its ratio.
pub fn fit_panes(node: &PaneNode, size: Size) -> PaneNode {
    let PaneNode::Split {
        id,
        dir,
        ratio,
        a,
        b,
    } = node
    else {
        return node.clone();
    };
    let along = |s: Size| match dir {
        SplitDir::Row => s.w,
        SplitDir::Column => s.h,
    };
    let room = along(size);
    let (least_a, least_b) = (along(min_size(a)), along(min_size(b)));
    let mut kept = *ratio;
    if room > 0.0 && room >= least_a + DIVIDER + least_b {
        let low = least_a / room;
        let high = (room - DIVIDER - least_b) / room;
        if kept < low || kept > high {
            kept = kept.clamp(low, high.max(low));
        }
    }
    let first = room * kept.clamp(0.0, 1.0);
    let second = (room - first - DIVIDER).max(0.0);
    let (sa, sb) = match dir {
        SplitDir::Row => (Size { w: first, ..size }, Size { w: second, ..size }),
        SplitDir::Column => (Size { h: first, ..size }, Size { h: second, ..size }),
    };
    PaneNode::Split {
        id: id.clone(),
        dir: *dir,
        ratio: kept,
        a: Box::new(fit_panes(a, sa)),
        b: Box::new(fit_panes(b, sb)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{Cell, body_of, cells};
    use crate::types::Rect;

    fn row(id: &str, ratio: f64, a: PaneNode, b: PaneNode) -> PaneNode {
        PaneNode::Split {
            id: id.into(),
            dir: SplitDir::Row,
            ratio,
            a: Box::new(a),
            b: Box::new(b),
        }
    }

    /// A three-pane window: the first pane, then the second split in two again.
    fn three(outer: f64, inner: f64) -> PaneNode {
        let v = |id: &str| PaneNode::view(id, "launcher");
        row("s2", outer, v("p1"), row("s3", inner, v("p2"), v("p3")))
    }

    fn widths(tree: &PaneNode, window: Rect) -> Vec<f64> {
        (cells(tree, body_of(window)).into_iter())
            .filter_map(|c| match c {
                Cell::Pane { rect, .. } => Some(rect.w),
                Cell::Divider { .. } => None,
            })
            .collect()
    }

    #[test]
    fn a_window_of_three_panes_side_by_side_is_wide_enough_for_three_headers() {
        let tree = three(0.5, 0.5);
        let least = window_min(&tree);
        assert_eq!(least.w, 3.0 * PANE_MIN.w + 2.0 * DIVIDER + 2.0 * BORDER);
        assert_eq!(least.h, MIN.h);
        assert_eq!(window_min(&PaneNode::view("p1", "launcher")), MIN);
    }

    #[test]
    fn at_its_minimum_each_pane_keeps_its_own() {
        let tree = three(0.5, 0.5);
        let least = window_min(&tree);
        let window = Rect::new(0.0, 0.0, least.w, least.h);
        let fitted = fit_panes(&tree, body_size(least.w, least.h));
        let got = widths(&fitted, window);
        assert!(got.iter().all(|w| *w >= PANE_MIN.w - 0.5), "{got:?}");
        // Without fitting, the halves of a half leave two panes too narrow.
        let raw = widths(&tree, window);
        assert!(raw.iter().any(|w| *w < PANE_MIN.w), "{raw:?}");
    }

    #[test]
    fn a_split_with_room_keeps_its_ratio_and_one_without_room_too() {
        let tree = three(0.5, 0.5);
        assert_eq!(fit_panes(&tree, Size { w: 800.0, h: 400.0 }), tree);
        assert_eq!(fit_panes(&tree, Size { w: 200.0, h: 400.0 }), tree);
        // A divider dragged far to one side gives back the pane on the other its room.
        let far = three(0.9, 0.5);
        let PaneNode::Split { ratio, .. } = fit_panes(&far, Size { w: 600.0, h: 400.0 }) else {
            unreachable!()
        };
        let rest = 600.0 * (1.0 - ratio) - DIVIDER;
        assert!(
            ratio < 0.9 && rest >= 2.0 * PANE_MIN.w + DIVIDER - 1e-9,
            "{ratio}"
        );
    }
}
