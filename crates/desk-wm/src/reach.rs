//! A window's title bar within reach (#159 findings 4 and 7): wherever a drop or a move command
//! leaves a window, the pointer can take it again by its title bar. The bar stays in the app from
//! its top to its bottom line, enough of the stretch that drags it stays in sight on either side,
//! and it keeps clear of the edge bars' surfaces (the dock), which lie above every window and hear
//! the presses there (ADR 0167). While the pointer holds the window it follows the pointer anywhere;
//! the drop brings it back within reach.

use crate::host::{BORDER, TITLE, TITLE_END};
use crate::types::{Rect, Size};

/// How much of the title bar's draggable stretch stays in sight at the app's left or right edge,
/// at most (a stretch shorter than this stays whole).
pub const GRAB: f64 = 48.0;

/// The title bar's top to its bottom line, from the window's top.
const BAR: f64 = BORDER + TITLE;

/// `r`, a normal or floating window on a `screen`-sized app with the edge bars `bars` (on screen),
/// moved as little as it takes to keep its title bar within reach. Its size never changes.
pub fn within_reach(r: Rect, screen: Size, bars: &[Rect]) -> Rect {
    // The stretch a press drags: from the window's left edge to its tools.
    let stretch = (r.w - TITLE_END - BORDER).max(0.0);
    let keep = GRAB.min(stretch);
    let x = r.x.max(keep - stretch).min(screen.w - keep);
    let mut y = r.y;
    let bar = |y: f64| Rect::new(x + BORDER, y + BORDER, (r.w - 2.0 * BORDER).max(0.0), TITLE);
    // A bar along the bottom or the top edge (wider than it is tall) that the title bar runs
    // under: the window goes above it, or below it.
    for b in bars.iter().filter(|b| b.w > b.h) {
        if !overlaps(bar(y), *b) {
            continue;
        }
        if b.y + b.h / 2.0 >= screen.h / 2.0 {
            y = y.min(b.y - BAR);
        } else {
            y = y.max(b.bottom() - BORDER);
        }
    }
    let y = y.min(screen.h - BAR).max(0.0);
    Rect::new(x, y, r.w, r.h)
}

/// `r` resized by its top edge, that edge stopped where the title bar stays within reach; the
/// bottom edge stays, unless the window would get less than `least` tall.
pub fn top_within_reach(r: Rect, screen: Size, bars: &[Rect], least: f64) -> Rect {
    let top = within_reach(r, screen, bars).y;
    let h = (r.bottom() - top).max(least);
    Rect::new(r.x, top, r.w, h)
}

fn overlaps(a: Rect, b: Rect) -> bool {
    a.x < b.right() && b.x < a.right() && a.y < b.bottom() && b.y < a.bottom()
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: Size = Size {
        w: 1280.0,
        h: 800.0,
    };
    /// The dock at 1280 × 800, as the QA pass found it.
    const DOCK: Rect = Rect::new(13.0, 701.0, 1254.0, 58.0);

    #[test]
    fn a_window_within_reach_stays_where_it_is() {
        let r = Rect::new(168.0, 254.0, 402.0, 305.0);
        assert_eq!(within_reach(r, APP, &[DOCK]), r);
        // Below the app's bottom edge but for its title bar, it is in reach too.
        let low = Rect::new(168.0, 640.0, 402.0, 305.0);
        assert_eq!(within_reach(low, APP, &[]), low);
    }

    #[test]
    fn a_title_bar_under_the_dock_goes_above_it() {
        let r = within_reach(Rect::new(582.0, 706.0, 402.0, 305.0), APP, &[DOCK]);
        assert_eq!(r, Rect::new(582.0, 701.0 - BAR, 402.0, 305.0));
        assert!(r.y + BAR <= DOCK.y);
        // Beside a short dock, the title bar keeps its place.
        let short = Rect::new(500.0, 701.0, 280.0, 58.0);
        let beside = Rect::new(100.0, 706.0, 300.0, 200.0);
        assert_eq!(within_reach(beside, APP, &[short]), beside);
        // A bar at the top keeps the title bar below it.
        let top = Rect::new(0.0, 0.0, 1280.0, 50.0);
        let under = within_reach(Rect::new(300.0, 10.0, 402.0, 305.0), APP, &[top]);
        assert_eq!(under.y, 50.0 - BORDER);
    }

    #[test]
    fn a_window_beyond_any_edge_keeps_its_title_bar_in_the_app() {
        let (w, h) = (402.0, 305.0);
        let stretch = w - TITLE_END - BORDER;
        let above = within_reach(Rect::new(120.0, -631.0, w, h), APP, &[]);
        assert_eq!(above.y, 0.0);
        let below = within_reach(Rect::new(582.0, 1565.0, w, h), APP, &[]);
        assert_eq!(below.y, APP.h - BAR);
        let left = within_reach(Rect::new(-880.0, 254.0, w, h), APP, &[]);
        assert_eq!(left.x + stretch, GRAB);
        let right = within_reach(Rect::new(2280.0, 222.0, w, h), APP, &[]);
        assert_eq!(right.x, APP.w - GRAB);
        // The dock does not push a window above the app's top.
        let tall = Rect::new(0.0, 40.0, 1280.0, 760.0);
        assert_eq!(
            within_reach(Rect::new(10.0, 300.0, w, h), APP, &[tall]).y,
            0.0
        );
    }

    #[test]
    fn a_narrow_window_keeps_its_whole_stretch_in_sight() {
        let w = TITLE_END + BORDER + 20.0;
        let r = within_reach(Rect::new(-500.0, 100.0, w, 200.0), APP, &[]);
        assert_eq!(r.x, 0.0);
    }
}
