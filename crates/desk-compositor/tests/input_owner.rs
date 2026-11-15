//! One owner of focus (#251, ADR 0230): the window manager decides which window is in use, on a
//! press before the press is routed and for a key, a command or an agent's call when it applies
//! them, and the router reads that for the keys at once. The page's focus on a window's surface is
//! no claim; a field of the page's own and a surface outside every window still are. The desk is
//! `input_desk`'s: a.one and b.two, each in a window of its own; the shell's part (asking the
//! window manager first) is played by `decided` and `window_pressed`.

use desk_compositor::glam::Vec2;
use desk_compositor::input::*;
use desk_compositor::*;

mod input_desk;
use input_desk::*;

const PALETTE: &str = "main.desk-palette";

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

/// A press at (x, y) as the shell feeds it: the window manager decided `surface` for it first.
fn press_on(d: &mut Desk, x: f32, y: f32, surface: &str) -> Vec<Out> {
    let mut out = d.router.decided(Some(surface));
    d.router.window_pressed();
    out.extend(d.click(x, y));
    out
}

#[test]
fn the_keys_go_where_the_window_manager_decided_at_once() {
    let mut d = desk();
    windows(&mut d);
    let out = d.router.decided(Some(A));
    assert_eq!(kinds(&out), ["focus.in@a.one"]);
    // Ctrl+Tab, a command, an agent's call: the window manager applied it, nothing else is heard.
    let out = d.router.decided(Some(B));
    assert_eq!(kinds(&out), ["focus.out@a.one", "focus.in@b.two"]);
    assert_eq!(d.router.focused(), Some(B));
    assert_eq!(d.router.surface_in_use(), Some(B));
    assert_eq!(typed(&mut d)[0], "key.down@b.two");
    assert!(!d.router.holding(), "nothing waits for the page");
}

#[test]
fn a_decision_takes_the_keys_from_a_field_of_the_pages_own() {
    let mut d = desk();
    windows(&mut d);
    d.router.decided(Some(A));
    // The talk line has the page's focus, and the keys.
    d.router.page_focus(PageFocus::Own);
    assert_eq!(d.router.focused(), Some(PAGE));
    // A window comes into use (an agent's call): the keys go there without the page saying so.
    d.router.decided(Some(B));
    assert_eq!(d.router.focused(), Some(B));
    assert_eq!(d.router.page_rests(), &PageFocus::Rest);
    // The surface in use changing under the same window (its page loaded again) takes nothing.
    d.router.page_focus(PageFocus::Own);
    d.router.in_use(Some(A));
    assert_eq!(d.router.focused(), Some(PAGE));
}

#[test]
fn an_overlay_keeps_the_keys_over_the_window_the_window_manager_puts_in_use() {
    let mut d = desk();
    windows(&mut d);
    d.router.decided(Some(A));
    let root = d.scene.root();
    quad(
        &mut d.scene,
        &mut d.router,
        root,
        PALETTE,
        Rect::new(800.0, 800.0, 400.0, 200.0),
        Vec2::ZERO,
    );
    d.router.page_focus(PageFocus::Place(PALETTE.into()));
    assert_eq!(d.router.focused(), Some(PALETTE));
    d.router.decided(Some(B));
    assert_eq!(d.router.focused(), Some(PALETTE), "a question stays asked");
    // It hides: the page's focus rests, and the keys are with the window in use now.
    d.router.targets.forget(PALETTE);
    d.router.page_focus(PageFocus::Rest);
    assert_eq!(d.router.focused(), Some(B));
}

#[test]
fn the_pages_focus_on_a_windows_surface_decides_nothing() {
    let mut d = desk();
    windows(&mut d);
    d.router.decided(Some(A));
    // The page's focus is on b.two's place (a Tab, a stale follow): the window manager has a.one.
    let out = d.router.page_focus(PageFocus::Place(B.into()));
    assert!(kinds(&out).is_empty());
    assert_eq!(d.router.focused(), Some(A));
    assert_eq!(d.router.page_rests(), &PageFocus::Rest);
    // Once the window manager took the page's request, the keys go.
    d.router.decided(Some(B));
    assert_eq!(d.router.focused(), Some(B));
}

#[test]
fn a_press_in_a_window_reads_the_window_manager_and_nothing_waits() {
    let mut d = desk();
    windows(&mut d);
    d.router.decided(Some(A));
    // On b.two's surface: the window manager decided b.two before the press was routed.
    let out = press_on(&mut d, 700.0, 100.0, B);
    assert!(kinds(&out).contains(&"pointer.down@b.two".to_owned()));
    assert_eq!(d.router.focused(), Some(B));
    assert!(!d.router.holding());
    // On a.one's title bar, which the page hears: the keys are a.one's at once, and what is typed
    // right after reaches it without the page's answer.
    d.router.press_to(PAGE);
    let out = press_on(&mut d, 150.0, 80.0, A);
    assert!(kinds(&out).contains(&"pointer.down@desk".to_owned()));
    assert_eq!(d.router.focused(), Some(A));
    assert!(!d.router.holding(), "the window manager decided it");
    assert_eq!(
        typed(&mut d),
        ["key.down@a.one", "key.char@a.one", "key.up@a.one"]
    );
}

#[test]
fn a_press_in_a_window_takes_the_keys_from_a_field_of_the_pages_own() {
    let mut d = desk();
    windows(&mut d);
    d.router.decided(Some(A));
    d.router.page_focus(PageFocus::Own);
    d.router.press_to(PAGE);
    press_on(&mut d, 150.0, 80.0, A);
    assert_eq!(
        d.router.focused(),
        Some(A),
        "its title bar, the talk line open"
    );
}

#[test]
fn a_press_on_a_windows_surface_follows_the_window_manager_not_the_surface() {
    let mut d = desk();
    windows(&mut d);
    d.router.decided(Some(A));
    // The window manager kept a.one in use for a press that reached b.two's surface (a part of
    // the system layer it knows lies there): the press is b.two's, the keys stay.
    let out = d.click(700.0, 100.0);
    assert!(kinds(&out).contains(&"pointer.down@b.two".to_owned()));
    assert_eq!(d.router.focused(), Some(A));
}

#[test]
fn a_press_on_the_desk_still_waits_for_the_page() {
    let mut d = desk();
    windows(&mut d);
    d.router.decided(Some(A));
    // The talk pill, a bar of the system layer: no window's, so the page says where the keys go.
    d.click(10.0, 10.0);
    assert!(d.router.holding());
    assert!(typed(&mut d).is_empty());
    d.router.page_focus(PageFocus::Own);
    assert_eq!(kinds(&d.answer())[0], "key.down@desk");
    // The flag is the next press's only: one decided for a window does not carry over.
    d.router.window_pressed();
    d.click(700.0, 100.0);
    d.click(10.0, 10.0);
    assert!(d.router.holding());
}
