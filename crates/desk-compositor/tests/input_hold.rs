//! What is typed after a press on the page, or after a key the desk runs, waits for the page's
//! answer (`input/hold.rs`): the talk pill opens its line and focuses it, ⌘K opens the palette,
//! a moment after the router heard the press or the key, and what the person typed in between
//! went to the window in use (the terminal ran it). The desk is `input_desk`'s: a.one and b.two,
//! each in a window of its own.

use std::time::Duration;

use desk_compositor::glam::Vec2;
use desk_compositor::input::hold::HOLD;
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

/// "a" pressed and let go, as the person types it.
fn typed(d: &mut Desk) -> Vec<String> {
    kinds(&d.key("a", "KeyA", Some("a"), NO_MODS))
}

#[test]
fn what_is_typed_right_after_a_press_on_the_page_waits_for_its_answer() {
    let mut d = desk();
    windows(&mut d);
    d.router.in_use(Some(A));
    // The talk pill: the page hears the press, a.one keeps the keys for now (ADR 0192).
    d.click(10.0, 10.0);
    assert_eq!(d.router.focused(), Some(A));
    assert!(d.router.holding());
    assert!(typed(&mut d).is_empty(), "nothing reaches a.one");
    assert!(typed(&mut d).is_empty());
    // The line took the page's focus, then the page answers the press.
    let moved = d.router.page_focus(PageFocus::Own);
    assert!(!kinds(&moved).iter().any(|k| k.starts_with("key.")));
    let out = d.answer();
    assert_eq!(
        kinds(&out),
        ["key.down@desk", "key.char@desk", "key.up@desk"].repeat(2),
        "both, in order, where the press left the keys"
    );
    assert!(!d.router.holding());
    assert_eq!(
        typed(&mut d)[0],
        "key.down@desk",
        "and nothing waits after it"
    );
}

#[test]
fn a_press_that_leaves_the_keys_where_they_were_sends_them_on_there() {
    let mut d = desk();
    windows(&mut d);
    d.router.in_use(Some(A));
    // A title bar: the window in use keeps the keys; the page's answer says nothing moved.
    d.click(10.0, 10.0);
    assert!(typed(&mut d).is_empty());
    d.router.page_focus(PageFocus::Rest);
    assert_eq!(
        kinds(&d.answer()),
        ["key.down@a.one", "key.char@a.one", "key.up@a.one"]
    );
    // A press on a surface is the surface's: nothing waits.
    d.click(700.0, 100.0);
    assert!(!d.router.holding());
    assert_eq!(typed(&mut d)[0], "key.down@b.two");
}

#[test]
fn a_key_the_desk_runs_holds_what_is_typed_after_it_until_the_page_answers() {
    let mut d = desk();
    windows(&mut d);
    d.router
        .keymap
        .apply(&[entry("Mod+K", "desk.palette.open", "desk")], None);
    d.click(300.0, 200.0);
    assert_eq!(d.router.focused(), Some(A));
    // ⌘K then "zq" at once: the palette is not shown yet, and the terminal must not get them.
    let palette = d.key("k", "KeyK", Some("k"), META);
    assert!(matches!(palette.first(), Some(Out::DeskKey { .. })));
    assert!(d.router.holding());
    assert!(d.key("z", "KeyZ", Some("z"), NO_MODS).is_empty());
    assert!(d.key("q", "KeyQ", Some("q"), NO_MODS).is_empty());
    // The palette's place takes the page's focus, and the page answers the key; its browser is
    // still hidden, where every key is dropped, until the compositor draws it.
    d.router.page_focus(PageFocus::Place(PALETTE.into()));
    assert!(d.answer().is_empty(), "not drawn yet");
    assert!(d.key("x", "KeyX", Some("x"), NO_MODS).is_empty());
    let root = d.scene.root();
    let at = Rect::new(800.0, 300.0, 960.0, 600.0);
    quad(&mut d.scene, &mut d.router, root, PALETTE, at, Vec2::ZERO);
    let now = d.now;
    let out = kinds(&d.router.tick(&d.scene, now));
    let keys: Vec<&String> = out.iter().filter(|k| k.starts_with("key.")).collect();
    assert!(
        keys.iter().all(|k| k.ends_with(PALETTE)),
        "none to a.one: {out:?}"
    );
    assert_eq!(
        keys.iter().filter(|k| k.starts_with("key.char")).count(),
        3,
        "z, q and x, once each: {out:?}"
    );
    assert!(d.answer().is_empty(), "nothing is sent twice");
    assert_eq!(typed(&mut d)[0], format!("key.down@{PALETTE}"));
}

#[test]
fn the_modifiers_wait_with_the_keys_so_a_chord_typed_in_the_wait_stays_one() {
    let mut d = desk();
    windows(&mut d);
    d.router.in_use(Some(A));
    d.click(10.0, 10.0);
    // ⌘B typed while the page has yet to answer: the plugin's own chord, with its ⌘.
    assert!(d.key("b", "KeyB", Some("b"), META).is_empty());
    d.feed(Input::Modifiers(NO_MODS));
    d.router.page_focus(PageFocus::Rest);
    let out = sent(&d.answer());
    let down = out.iter().find(|m| m["type"] == "key.down").unwrap();
    assert_eq!(down["surface"], A);
    assert!(
        down["modifiers"]
            .as_array()
            .unwrap()
            .contains(&"meta".into()),
        "{down}"
    );
    assert!(
        !out.iter().any(|m| m["type"] == "key.char"),
        "a chord types nothing"
    );
}

#[test]
fn without_an_answer_what_waited_goes_on_after_the_hold() {
    let mut d = desk();
    windows(&mut d);
    d.router.in_use(Some(A));
    d.click(10.0, 10.0);
    assert!(typed(&mut d).is_empty());
    let before = d.now;
    assert!(d.router.tick(&d.scene, before).is_empty(), "not yet");
    let out = d
        .router
        .tick(&d.scene, before + HOLD + Duration::from_millis(1));
    assert_eq!(
        kinds(&out),
        ["key.down@a.one", "key.char@a.one", "key.up@a.one"]
    );
    assert!(!d.router.holding());
}

#[test]
fn the_window_losing_the_os_focus_sends_on_what_waited_first() {
    let mut d = desk();
    windows(&mut d);
    d.router.in_use(Some(A));
    d.click(10.0, 10.0);
    assert!(typed(&mut d).is_empty());
    let out = kinds(&d.feed(Input::WindowFocused { focused: false }));
    assert_eq!(
        out,
        [
            "key.down@a.one",
            "key.char@a.one",
            "key.up@a.one",
            "focus.out@a.one"
        ]
    );
}
