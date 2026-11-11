//! The keys follow the window in use (ADR XXXX; issues 158 #10, 159 #2 #5, 160 #11, 162 #6 #7):
//! where the page's focus rests on nothing of its own (its body after the palette closed, a
//! window's section after Ctrl+Tab), after a press on the page (a title bar, a divider, a grip),
//! and when the window in use changes; never past an element of the page's own or a surface of no
//! window. A window covers what lies under it. The desk is `input_desk`'s: a.one and b.two, each
//! in a window of its own unless a test says otherwise.

use desk_compositor::glam::Vec2;
use desk_compositor::input::*;
use desk_compositor::*;

mod input_desk;
use input_desk::*;

/// a.one's window, then b.two's above it, in screen pixels.
fn windows(d: &mut Desk) {
    let areas = vec![
        Area {
            rect: Rect::new(200.0, 100.0, 800.0, 600.0),
            surfaces: vec![A.into()],
        },
        Area {
            rect: Rect::new(1200.0, 100.0, 800.0, 600.0),
            surfaces: vec![B.into()],
        },
    ];
    d.router.targets.set_areas(PAGE, areas);
}

fn typed(d: &mut Desk) -> Vec<String> {
    kinds(&d.key("a", "KeyA", Some("a"), NO_MODS))
}

#[test]
fn where_the_pages_focus_rests_on_nothing_of_its_own_the_keys_go_to_the_window_in_use() {
    let mut d = desk();
    windows(&mut d);
    d.router.in_use(Some(A));
    assert_eq!(
        d.router.focused(),
        Some(A),
        "at a start, with nothing focused yet"
    );
    // ⌘K: the palette's place takes the page's focus, and the keys.
    d.router
        .page_focus(PageFocus::Place("main.desk-palette".into()));
    assert_eq!(d.router.focused(), Some("main.desk-palette"));
    // Escape: the palette hides, the page's focus falls to its body (issue 158, finding 10).
    let out = d.router.page_focus(PageFocus::Rest);
    assert_eq!(d.router.focused(), Some(A));
    assert!(kinds(&out).contains(&"focus.in@a.one".to_owned()));
    assert!(out.contains(&Out::Redraw), "the ring comes back");
    assert_eq!(
        typed(&mut d),
        ["key.down@a.one", "key.char@a.one", "key.up@a.one"]
    );
    // A field of the page's own (the talk line) keeps them on the page.
    d.router.page_focus(PageFocus::Own);
    assert_eq!(d.router.focused(), Some(PAGE));
    assert_eq!(typed(&mut d)[0], "key.down@desk");
}

#[test]
fn the_keys_go_along_when_the_window_in_use_changes() {
    let mut d = desk();
    windows(&mut d);
    d.click(150.0, 80.0);
    assert_eq!(d.router.focused(), Some(A));
    d.router.in_use(Some(A));
    // Ctrl+Tab, a window shown, a file opened, a question: another window is in use.
    let out = d.router.in_use(Some(B));
    assert_eq!(
        kinds(&out),
        ["focus.out@a.one", "focus.in@b.two"],
        "issue 159, finding 2"
    );
    assert_eq!(d.router.surface_in_use(), Some(B));
    // A pane the page draws in use (a launcher): the page has them.
    d.router.in_use(None);
    assert_eq!(d.router.focused(), Some(PAGE));
    d.router.in_use(Some(A));
    assert_eq!(d.router.focused(), Some(A));
}

#[test]
fn an_element_of_the_pages_own_or_a_surface_of_no_window_keeps_the_keys() {
    let mut d = desk();
    windows(&mut d);
    d.router.in_use(Some(A));
    d.router.page_focus(PageFocus::Own);
    d.router.in_use(Some(B));
    assert_eq!(d.router.focused(), Some(PAGE), "the talk line keeps them");
    // An overlay drawn outside every window (the palette) keeps them while it shows.
    let root = d.scene.root();
    quad(
        &mut d.scene,
        &mut d.router,
        root,
        "main.desk-palette",
        Rect::new(800.0, 800.0, 400.0, 200.0),
        Vec2::ZERO,
    );
    d.router
        .page_focus(PageFocus::Place("main.desk-palette".into()));
    d.router.in_use(Some(A));
    assert_eq!(d.router.focused(), Some("main.desk-palette"));
    // Once it shows no more the keys go along again.
    d.router.targets.forget("main.desk-palette");
    d.router.in_use(Some(B));
    assert_eq!(d.router.focused(), Some(B));
}

#[test]
fn a_press_on_the_page_leaves_the_keys_with_the_window_in_use() {
    let mut d = desk();
    windows(&mut d);
    d.click(150.0, 80.0);
    d.router.in_use(Some(A));
    // A title bar, a grip, a divider: the page hears the press, the window keeps the keys
    // (issue 159, finding 2, step 4: a title drag took them to the page).
    d.router.press_to(PAGE);
    let out = d.click(150.0, 80.0);
    assert!(kinds(&out).contains(&"pointer.down@desk".to_owned()));
    assert_eq!(d.router.focused(), Some(A));
    let out = d.click(10.0, 10.0);
    assert!(!kinds(&out).iter().any(|k| k.starts_with("focus.")));
    assert_eq!(d.router.focused(), Some(A));
    // With an element of the page's own focused, a press on the page is the page's.
    d.router.page_focus(PageFocus::Own);
    d.click(10.0, 10.0);
    assert_eq!(d.router.focused(), Some(PAGE));
    // A press on a surface is that surface's, as before.
    d.click(700.0, 100.0);
    assert_eq!(d.router.focused(), Some(B));
}

#[test]
fn a_window_covers_what_lies_under_it() {
    let mut d = desk();
    windows(&mut d);
    // b.two's window moved over a.one's right half, its surface drawn elsewhere in it: the strip
    // between them (a divider, its frame) is its own and the page's, never a.one's.
    let areas = vec![
        Area {
            rect: Rect::new(200.0, 100.0, 800.0, 600.0),
            surfaces: vec![A.into()],
        },
        Area {
            rect: Rect::new(600.0, 100.0, 1400.0, 600.0),
            surfaces: vec![B.into()],
        },
    ];
    d.router.targets.set_areas(PAGE, areas);
    let out = d.to(400.0, 200.0);
    assert_eq!(kinds(&out), ["pointer.move@desk"]);
    let down = d.press(true);
    assert_eq!(kinds(&down)[..1], ["pointer.down@desk".to_owned()]);
    assert_ne!(d.router.focused(), Some(A), "issue 159, finding 5");
    d.press(false);
    // Outside b.two's window a.one is a.one's, and b.two's own surface its own.
    assert_eq!(kinds(&d.to(200.0, 200.0))[0], "pointer.move@a.one");
    assert!(kinds(&d.to(700.0, 100.0)).contains(&"pointer.move@b.two".to_owned()));
    // The page's own parts over a window, and a surface of no window, are not covered.
    assert!(d.router.targets.in_window(A) && !d.router.targets.in_window(PAGE));
    // Laid out again with no windows (the spread's cards): nothing covers anything.
    d.router.targets.clear();
    let root = d.scene.root();
    let node = d.scene.children(root)[1];
    let target = Target {
        surface: A.into(),
        origin: Vec2::ZERO,
        per_unit: Vec2::splat(0.5),
    };
    d.router.targets.surface(&d.scene, node, target);
    assert!(kinds(&d.to(400.0, 200.0)).contains(&"pointer.move@a.one".to_owned()));
}
