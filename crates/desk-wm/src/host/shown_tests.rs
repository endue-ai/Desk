use std::collections::BTreeMap;

use super::{Laid, PageShown, QUIET_MS, REORDER_MS};
use crate::types::Rect;

const SCREEN: Rect = Rect {
    x: 0.0,
    y: 0.0,
    w: 1280.0,
    h: 800.0,
};

/// A window at `rect` whose page draws its 40 px title bar.
fn bar(rect: Rect) -> Laid {
    Laid {
        rect,
        parts: vec![Rect::new(rect.x, rect.y, rect.w, 40.0)],
    }
}

fn one(id: &str, laid: Laid) -> BTreeMap<String, Laid> {
    BTreeMap::from([(id.to_owned(), laid)])
}

/// A picture that shows window "a" at `rect`, painted.
fn shown_at(rect: Rect) -> PageShown {
    let mut shown = PageShown::new();
    shown.laid(&one("a", bar(rect)), SCREEN, 0.0);
    assert!(shown.painted(&[SCREEN], 1.0));
    assert_eq!(shown.rect("a"), Some(rect));
    shown
}

#[test]
fn a_moved_window_is_shown_where_the_page_had_it_until_a_paint_covers_both_places() {
    let from = Rect::new(100.0, 100.0, 400.0, 300.0);
    let to = Rect::new(160.0, 130.0, 400.0, 300.0);
    let mut shown = shown_at(from);
    shown.laid(&one("a", bar(to)), SCREEN, 10.0);
    assert_eq!(
        shown.rect("a"),
        Some(from),
        "the DOM has it there, the picture not yet"
    );
    // A paint of something else (a caret elsewhere) shows nothing of the move.
    assert!(!shown.painted(&[Rect::new(800.0, 600.0, 10.0, 20.0)], 12.0));
    assert_eq!(shown.rect("a"), Some(from));
    // The new place alone is not enough: the old one still shows the window.
    assert!(!shown.painted(&[Rect::new(160.0, 130.0, 400.0, 40.0)], 14.0));
    // The move's own damage, the old and the new place's union.
    assert!(shown.painted(&[Rect::new(100.0, 100.0, 460.0, 70.0)], 16.0));
    assert_eq!(shown.rect("a"), Some(to));
    assert!(!shown.waiting());
}

#[test]
fn a_paint_shows_the_newest_layout_its_damage_covers_and_later_ones_wait() {
    let at = |x: f64| Rect::new(x, 100.0, 300.0, 200.0);
    let mut shown = shown_at(at(100.0));
    for (i, x) in [110.0, 120.0, 130.0].into_iter().enumerate() {
        shown.laid(&one("a", bar(at(x))), SCREEN, 10.0 + i as f64);
    }
    // The picture went from 100 to 120 in one paint: 130 is not drawn yet.
    assert!(shown.painted(&[Rect::new(100.0, 100.0, 320.0, 40.0)], 20.0));
    assert_eq!(shown.rect("a"), Some(at(120.0)));
    assert!(shown.waiting());
    assert!(shown.painted(&[Rect::new(120.0, 100.0, 310.0, 40.0)], 36.0));
    assert_eq!(shown.rect("a"), Some(at(130.0)));
}

#[test]
fn a_new_window_waits_for_its_paint_and_one_whose_parts_stay_put_is_shown_at_once() {
    let mut shown = PageShown::new();
    let first = Rect::new(200.0, 200.0, 400.0, 300.0);
    shown.laid(&one("a", bar(first)), SCREEN, 0.0);
    assert_eq!(shown.rect("a"), None, "nothing of it is in the picture yet");
    assert!(shown.painted(&[first], 5.0));
    assert_eq!(shown.rect("a"), Some(first));
    // Grown from its bottom edge: the title bar the page draws is where it was.
    let taller = Rect { h: 420.0, ..first };
    shown.laid(&one("a", bar(taller)), SCREEN, 10.0);
    assert_eq!(shown.rect("a"), Some(taller));
    assert!(!shown.waiting());
}

#[test]
fn a_window_the_page_dropped_stays_in_the_picture_until_a_paint_clears_its_parts() {
    let at = Rect::new(100.0, 100.0, 400.0, 300.0);
    let mut shown = shown_at(at);
    shown.laid(&BTreeMap::new(), SCREEN, 10.0);
    assert_eq!(shown.rect("a"), None);
    assert_eq!(shown.stale(), vec![Rect::new(100.0, 100.0, 400.0, 40.0)]);
    assert!(!shown.painted(&[Rect::new(100.0, 100.0, 100.0, 40.0)], 12.0));
    assert!(shown.painted(&[at], 14.0));
    assert!(shown.stale().is_empty());
}

#[test]
fn a_quiet_page_has_painted_what_it_laid_out() {
    let from = Rect::new(100.0, 100.0, 400.0, 300.0);
    let to = Rect::new(500.0, 300.0, 400.0, 300.0);
    let mut shown = shown_at(from);
    shown.laid(&one("a", bar(to)), SCREEN, 100.0);
    assert_eq!(shown.due(), Some(100.0 + QUIET_MS));
    assert!(!shown.settle(100.0 + QUIET_MS - 1.0));
    // A paint that showed none of it puts the time off.
    assert!(!shown.painted(&[Rect::new(0.0, 0.0, 10.0, 10.0)], 200.0));
    assert_eq!(shown.due(), Some(200.0 + QUIET_MS));
    assert!(shown.settle(200.0 + QUIET_MS));
    assert_eq!(shown.rect("a"), Some(to));
    assert_eq!(shown.due(), None);
}

#[test]
fn what_lies_off_the_page_needs_no_damage() {
    // Half past the page's right edge, moved down: only what is on the page can be painted.
    let from = Rect::new(1000.0, 100.0, 600.0, 300.0);
    let to = Rect::new(1000.0, 200.0, 600.0, 300.0);
    let mut shown = shown_at(from);
    shown.laid(&one("a", bar(to)), SCREEN, 10.0);
    assert!(shown.painted(&[Rect::new(1000.0, 100.0, 280.0, 140.0)], 20.0));
    assert_eq!(shown.rect("a"), Some(to));
}

#[test]
fn a_paint_that_came_just_before_its_report_shows_it() {
    let from = Rect::new(100.0, 100.0, 400.0, 300.0);
    let to = Rect::new(80.0, 90.0, 400.0, 300.0);
    let mut shown = shown_at(from);
    // The page moved it and painted; its report took the bridge's thread and came 8 ms later.
    assert!(!shown.painted(&[Rect::new(80.0, 90.0, 420.0, 50.0)], 50.0));
    shown.laid(&one("a", bar(to)), SCREEN, 58.0);
    assert_eq!(shown.rect("a"), Some(to));
    // One that came long before the report shows an older layout.
    let later = Rect::new(60.0, 80.0, 400.0, 300.0);
    assert!(!shown.painted(&[Rect::new(60.0, 80.0, 420.0, 50.0)], 70.0));
    shown.laid(&one("a", bar(later)), SCREEN, 70.0 + REORDER_MS + 50.0);
    assert_eq!(shown.rect("a"), Some(to));
}

#[test]
fn paints_whose_reports_came_late_still_add_up() {
    let at = |x: f64| Rect::new(x, 100.0, 300.0, 200.0);
    let mut shown = shown_at(at(100.0));
    // Two moves painted, each a little before its report.
    assert!(!shown.painted(&[Rect::new(100.0, 100.0, 320.0, 40.0)], 20.0));
    assert!(!shown.painted(&[Rect::new(120.0, 100.0, 320.0, 40.0)], 36.0));
    shown.laid(&one("a", bar(at(120.0))), SCREEN, 40.0);
    assert_eq!(shown.rect("a"), Some(at(120.0)));
    shown.laid(&one("a", bar(at(140.0))), SCREEN, 41.0);
    assert_eq!(shown.rect("a"), Some(at(140.0)));
    assert!(!shown.waiting());
}
