//! A plugin's paints between its picture and the textures aside (ADR 0227).

use desk_compositor::TextureId;

use super::{KEPT, MOST_ASIDE, PaneAside, To};

const A: TextureId = TextureId(11);

#[test]
fn a_plugin_not_drawn_yet_shows_every_paint() {
    let mut pane = PaneAside::default();
    assert_eq!(pane.paint((600, 400), None), To::Shown, "its first");
    assert_eq!(pane.paint((640, 400), Some((600, 400))), To::Shown);
}

#[test]
fn a_paint_ahead_of_the_pane_goes_aside_until_the_pane_is_drawn_its_size() {
    let mut pane = PaneAside::default();
    assert_eq!(pane.drawn((600, 400), None), None);
    let shown = Some((600, 400));
    assert_eq!(pane.paint((600, 400), shown), To::Shown, "the pane's size");
    // The plugin painted the next size before its window's page did.
    let fresh = To::Aside {
        slot: 0,
        fresh: true,
    };
    assert_eq!(pane.paint((640, 400), shown), fresh);
    pane.aside.push(((640, 400), A));
    let again = To::Aside {
        slot: 0,
        fresh: false,
    };
    assert_eq!(pane.paint((640, 400), shown), again, "the same picture");
    assert_eq!(
        pane.paint((600, 400), shown),
        To::Shown,
        "its own size still"
    );
    assert_eq!(
        pane.drawn((600, 400), shown),
        None,
        "the frame has not grown"
    );
    assert_eq!(
        pane.drawn((641, 400), shown),
        Some(A),
        "to a pixel: shown now"
    );
    assert!(pane.aside.is_empty());
    assert_eq!(pane.paint((640, 400), Some((640, 400))), To::Shown);
}

#[test]
fn the_newest_sizes_wait_and_the_oldest_gives_its_place() {
    let mut pane = PaneAside::default();
    pane.drawn((600, 400), None);
    let shown = Some((600, 400));
    for slot in 0..KEPT {
        let size = (640 + 40 * slot as u32, 400);
        let fresh = To::Aside { slot, fresh: true };
        assert_eq!(pane.paint(size, shown), fresh);
        pane.aside.push((size, TextureId(20 + slot as u64)));
    }
    let past = To::Aside {
        slot: KEPT,
        fresh: true,
    };
    assert_eq!(pane.paint((900, 400), shown), past, "past what is kept");
    assert_eq!(
        pane.drawn((680, 400), shown),
        Some(TextureId(21)),
        "a step skipped"
    );
    assert_eq!(pane.aside.len(), KEPT - 1);
    assert_eq!(pane.aside[0], ((640, 400), TextureId(20)));
}

#[test]
fn a_pane_that_never_takes_the_size_still_shows_its_plugin() {
    let mut pane = PaneAside::default();
    pane.drawn((600, 400), None);
    let shown = Some((600, 400));
    for i in 0..MOST_ASIDE {
        let to = pane.paint((640 + i as u32, 400), shown);
        assert!(matches!(to, To::Aside { fresh: true, .. }), "{i}");
        pane.aside.clear();
    }
    assert_eq!(
        pane.paint((700, 400), shown),
        To::Shown,
        "a count, not a time"
    );
}

#[test]
fn a_picture_of_the_panes_size_already_shown_takes_nothing_from_aside() {
    let mut pane = PaneAside::default();
    pane.drawn((600, 400), None);
    pane.aside.push(((640, 400), A));
    assert_eq!(pane.drawn((640, 400), Some((640, 400))), None);
    assert_eq!(pane.aside.len(), 1, "kept for the scene that needs it");
}

#[test]
fn a_paint_of_a_size_the_pane_has_left_is_drawn_as_it_comes() {
    let mut pane = PaneAside::default();
    pane.drawn((600, 400), None);
    pane.drawn((640, 400), Some((600, 400)));
    pane.drawn((680, 400), Some((600, 400)));
    // The plugin trails its frame: 640 is nearer the frame than the 600 it shows.
    assert_eq!(pane.paint((640, 400), Some((600, 400))), To::Shown);
    let ahead = To::Aside {
        slot: 0,
        fresh: true,
    };
    assert_eq!(pane.paint((720, 400), Some((640, 400))), ahead);
}
