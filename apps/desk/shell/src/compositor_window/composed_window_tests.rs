//! A window's own page's paints between its picture and the textures aside, and the sizes a
//! picture of it leaves its panes (ADR 0233).

use desk_compositor::{Rect, TextureId};

use super::{KEPT, MOST_ASIDE, MOST_LOOKS, PageWait, Paned, To};
use crate::compositor_window::draw::anchor::Anchor;

const SHOWN: Option<(u32, u32)> = Some((1200, 800));

/// The Terminal's window at 600×400 CSS pixels, its one pane under a 36-pixel title bar, 8 in.
fn terminal() -> Paned {
    Paned {
        page: "window:endue.terminal".into(),
        placed: Rect::new(100.0, 50.0, 600.0, 400.0),
        laid: (600.0, 400.0),
        corner: Anchor::default(),
        panes: vec![("plugin:endue.terminal".into(), Rect::new(8.0, 36.0, 584.0, 356.0))],
    }
}

#[test]
fn a_paint_of_a_new_size_waits_aside_only_in_a_window_with_a_plugin_pane() {
    let mut page = PageWait::default();
    assert_eq!(page.paint((1200, 800), None, true), To::Shown, "its first");
    assert_eq!(page.paint((1200, 800), SHOWN, true), To::Shown, "its size");
    assert_eq!(page.paint((1280, 800), SHOWN, false), To::Shown, "no pane to wait for");
    assert_eq!(page.paint((1280, 800), SHOWN, true), To::Aside(None));
    assert_eq!(page.keep((1280, 800), TextureId(7)), None);
    assert_eq!(page.paint((1280, 800), SHOWN, true), To::Aside(Some(TextureId(7))));
    assert!(page.waits());
}

#[test]
fn a_picture_aside_shows_once_its_panes_plugins_have_their_sizes() {
    let mut page = PageWait::default();
    for (i, w) in [1280, 1360, 1440].into_iter().enumerate() {
        assert_eq!(page.paint((w, 800), SHOWN, true), To::Aside(None));
        page.keep((w, 800), TextureId(10 + i as u64));
    }
    assert_eq!(page.pick(|_| false), None, "no plugin has painted a size of them");
    // The plugin has painted the second size: that one shows, the first is left behind.
    let found = page.pick(|(w, _)| w == 1360);
    assert_eq!(found, Some((TextureId(11), vec![TextureId(10)])));
    assert!(page.waits(), "the newest still waits");
    assert_eq!(page.pick(|_| true), Some((TextureId(12), vec![])));
    assert!(!page.waits());
}

#[test]
fn the_newest_sizes_wait_and_a_repainted_one_is_the_newest() {
    let mut page = PageWait::default();
    for i in 0..=KEPT {
        let size = (1280 + 80 * i as u32, 800);
        assert_eq!(page.paint(size, SHOWN, true), To::Aside(None));
        let gone = page.keep(size, TextureId(20 + i as u64));
        assert_eq!(gone, (i == KEPT).then_some(TextureId(20)), "{i}");
    }
    assert_eq!(page.paint((1360, 800), SHOWN, true), To::Aside(Some(TextureId(21))));
    assert_eq!(page.pick(|_| true).map(|f| f.0), Some(TextureId(21)), "repainted last");
}

#[test]
fn a_page_whose_panes_never_take_its_size_still_shows_by_a_count() {
    let mut page = PageWait::default();
    page.paint((1280, 800), SHOWN, true);
    page.keep((1280, 800), TextureId(7));
    for i in 0..MOST_LOOKS {
        assert_eq!(page.pick(|_| false), None, "scene {i}");
    }
    assert_eq!(page.pick(|_| false), Some((TextureId(7), vec![])), "a count of scenes");
    // A count of paints aside in a row draws the next as it comes.
    let mut page = PageWait::default();
    for i in 0..MOST_ASIDE {
        let size = (1280 + i as u32, 800);
        assert!(matches!(page.paint(size, SHOWN, true), To::Aside(_)), "{i}");
        page.keep(size, TextureId(30 + i as u64));
    }
    assert_eq!(page.paint((1400, 800), SHOWN, true), To::Shown, "a count, not a time");
    assert_eq!(page.clear().len(), KEPT, "the older ones go");
}

#[test]
fn a_picture_leaves_each_pane_what_its_frame_holds() {
    let terminal = terminal();
    // At the window's size: the pane's body.
    assert_eq!(
        terminal.leaves((1200, 800), 2.0),
        vec![("plugin:endue.terminal", (1168, 712))]
    );
    // A picture 40 CSS pixels wider and 20 higher: the pane at the frame's edges keeps its inset.
    assert_eq!(
        terminal.leaves((1280, 840), 2.0),
        vec![("plugin:endue.terminal", (1248, 752))]
    );
    // Narrower: cut at the frame's edge with its inset still.
    assert_eq!(
        terminal.leaves((1100, 800), 2.0),
        vec![("plugin:endue.terminal", (1068, 712))]
    );
}
