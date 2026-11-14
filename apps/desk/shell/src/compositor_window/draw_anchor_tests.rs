//! A window resized by its top or left edge keeps its bottom or right edge where it is while its
//! page has yet to paint the new size; the ring and the panes lie in the frame as drawn.

use desk_compositor::Rect;

use super::super::tests::hosted_at;
use super::{Anchor, Anchors, pictured, within};

const TOP_LEFT: Anchor = Anchor {
    right: false,
    bottom: false,
};

/// The fixture's plan with its one window at `rect`.
fn plan_at(rect: desk_wm::Rect) -> desk_wm::host::Plan {
    let mut plan = hosted_at("live", 1.0).plan().unwrap().clone();
    plan.windows[0].rect = rect;
    plan
}

#[test]
fn a_resize_anchors_the_window_at_the_edges_it_left_where_they_were() {
    let id = "endue.notes";
    let mut anchors = Anchors::default();
    let at = |x, y, w, h| plan_at(desk_wm::Rect::new(x, y, w, h));
    anchors.follow(&at(100.0, 200.0, 400.0, 300.0));
    assert_eq!(anchors.of(id), TOP_LEFT, "first seen");
    // Its top edge dragged up: the bottom stays.
    anchors.follow(&at(100.0, 150.0, 400.0, 350.0));
    assert_eq!(
        anchors.of(id),
        Anchor {
            right: false,
            bottom: true
        }
    );
    // At rest, and moved whole, while its page still paints: as it was.
    anchors.follow(&at(100.0, 150.0, 400.0, 350.0));
    anchors.follow(&at(130.0, 170.0, 400.0, 350.0));
    assert_eq!(
        anchors.of(id),
        Anchor {
            right: false,
            bottom: true
        }
    );
    // Its top-left corner dragged: the bottom right stays.
    anchors.follow(&at(110.0, 160.0, 420.0, 360.0));
    assert_eq!(
        anchors.of(id),
        Anchor {
            right: true,
            bottom: true
        }
    );
    // Its bottom-right corner dragged: the top left again.
    anchors.follow(&at(110.0, 160.0, 500.0, 400.0));
    assert_eq!(anchors.of(id), TOP_LEFT);
    assert_eq!(anchors.of("endue.unknown"), TOP_LEFT, "never seen");
}

#[test]
fn a_window_gone_from_the_desktop_in_front_is_forgotten() {
    let mut anchors = Anchors::default();
    anchors.follow(&plan_at(desk_wm::Rect::new(100.0, 200.0, 400.0, 300.0)));
    anchors.follow(&plan_at(desk_wm::Rect::new(100.0, 150.0, 400.0, 350.0)));
    let mut empty = plan_at(desk_wm::Rect::new(0.0, 0.0, 1.0, 1.0));
    empty.windows.clear();
    anchors.follow(&empty);
    anchors.follow(&plan_at(desk_wm::Rect::new(100.0, 150.0, 400.0, 350.0)));
    assert_eq!(anchors.of("endue.notes"), TOP_LEFT, "seen anew");
}

#[test]
fn an_older_picture_is_drawn_from_the_corner_that_stayed() {
    // Grown 100 up and 60 to the left; its page still shows 400×300 at a scale of 2.
    let placed = Rect::new(40.0, 100.0, 460.0, 400.0);
    let old = (800, 600);
    assert_eq!(
        pictured(placed, old, 2.0, TOP_LEFT),
        Rect::new(40.0, 100.0, 400.0, 300.0)
    );
    let bottom_right = Anchor {
        right: true,
        bottom: true,
    };
    assert_eq!(
        pictured(placed, old, 2.0, bottom_right),
        Rect::new(100.0, 200.0, 400.0, 300.0),
        "its right and bottom edges where the place has them"
    );
    // A picture of its size is drawn as placed, whatever the anchor; a device pixel off counts.
    assert_eq!(pictured(placed, (920, 800), 2.0, bottom_right), placed);
    assert_eq!(pictured(placed, (921, 799), 2.0, bottom_right), placed);
}

#[test]
fn what_lies_at_the_frames_far_edges_follows_the_frame_drawn() {
    let laid = (400.0, 300.0);
    // The one pane's body, a border in from the frame, under the title bar.
    let body = Rect::new(1.0, 41.0, 398.0, 258.0);
    assert_eq!(
        within(body, laid, laid),
        body,
        "the frame is the window's size"
    );
    // The frame still 340×240, before a growth: the body ends a border in from it.
    assert_eq!(
        within(body, laid, (340.0, 240.0)),
        Rect::new(1.0, 41.0, 338.0, 198.0)
    );
    // The frame still 460×360, before a shrink: the body reaches it too.
    assert_eq!(
        within(body, laid, (460.0, 360.0)),
        Rect::new(1.0, 41.0, 458.0, 318.0)
    );
    // Split side by side: the left pane ends where it did, or at a narrower frame; the right one
    // keeps its border from the frame's right edge and never turns inside out.
    let left = Rect::new(1.0, 41.0, 199.0, 258.0);
    assert_eq!(within(left, laid, (460.0, 300.0)), left);
    assert_eq!(
        within(left, laid, (150.0, 300.0)),
        Rect::new(1.0, 41.0, 149.0, 258.0)
    );
    let right = Rect::new(201.0, 41.0, 198.0, 258.0);
    assert_eq!(
        within(right, laid, (340.0, 300.0)),
        Rect::new(201.0, 41.0, 138.0, 258.0)
    );
    assert_eq!(
        within(right, laid, (150.0, 300.0)),
        Rect::new(201.0, 41.0, 0.0, 258.0)
    );
}
