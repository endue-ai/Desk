//! A window's own page is the page's (ADR 0201): the runtime's script lays each window out in a
//! page of its own, which a texture of its own draws, and the keys treat that page as they treat
//! the page under everything. A press on it waits for the page's answer and leaves the keys where
//! the page's focus rests until then; a key the desk binds goes to it, whose keymap runs it; and
//! the keys follow the window in use away from it. The desk: the page under everything, window
//! page `window:w` over logical (100, 50) 400 x 300, and plugin surface a.one in its pane below its
//! title bar.

use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::input::keymap::Platform;
use desk_compositor::input::*;
use desk_compositor::*;

mod input_desk;
use input_desk::*;

const OWN: &str = "window:w";

fn paged() -> Desk {
    let mut scene = Scene::new(2560, 1600);
    let settings = PointerSettings {
        underlay: Some(PAGE.into()),
        pages: Some("window:".into()),
        ..PointerSettings::default()
    };
    let mut router = InputRouter::new(Platform::Mac, settings);
    let root = scene.root();
    let whole = Rect::new(0.0, 0.0, 2560.0, 1600.0);
    quad(&mut scene, &mut router, root, PAGE, whole, Vec2::ZERO);
    let window = Rect::new(200.0, 100.0, 800.0, 600.0);
    quad(&mut scene, &mut router, root, OWN, window, Vec2::ZERO);
    let pane = Rect::new(200.0, 180.0, 800.0, 520.0);
    quad(&mut scene, &mut router, root, A, pane, Vec2::ZERO);
    for (s, owner) in [(PAGE, "desk"), (A, "a")] {
        router.targets.set_owner(s, owner);
    }
    router.targets.set_page_of(A, OWN);
    router.targets.set_areas(
        PAGE,
        vec![Area {
            rect: window,
            surfaces: vec![OWN.into(), A.into()],
        }],
    );
    Desk {
        scene,
        router,
        now: Instant::now(),
    }
}

fn typed(d: &mut Desk) -> Vec<String> {
    kinds(&d.key("a", "KeyA", Some("a"), NO_MODS))
}

#[test]
fn a_press_on_a_windows_own_page_waits_for_the_pages_answer_as_one_on_the_page_does() {
    let mut d = paged();
    d.router.in_use(Some(A));
    // Its title bar: a press on the window's own page, where the page decides what it does.
    d.click(150.0, 60.0);
    assert!(d.router.holding(), "what is typed next waits for the page");
    assert_eq!(
        d.router.focused(),
        Some(A),
        "where the page's focus rests until then"
    );
    assert!(typed(&mut d).is_empty());
    // A field of the window's own took the focus there: the page says so, then answers.
    d.router.page_focus(PageFocus::Place(OWN.into()));
    let out = d.answer();
    assert_eq!(
        kinds(&out),
        ["key.down@window:w", "key.char@window:w", "key.up@window:w"]
    );
    assert_eq!(typed(&mut d)[0], "key.down@window:w");
}

#[test]
fn a_key_the_desk_binds_reaches_a_windows_own_page_whose_keymap_runs_it() {
    let mut d = paged();
    d.router
        .keymap
        .apply(&[entry("Mod+K", "desk.palette.open", "desk")], None);
    d.router.page_focus(PageFocus::Place(OWN.into()));
    assert_eq!(d.router.focused(), Some(OWN));
    let out = d.key("k", "KeyK", Some("k"), META);
    assert!(
        !out.iter().any(|o| matches!(o, Out::DeskKey { .. })),
        "the page's keymap runs it, as on the page under everything"
    );
    assert_eq!(kinds(&out)[0], "key.down@window:w");
}

#[test]
fn the_keys_follow_the_window_in_use_away_from_a_windows_own_page() {
    let mut d = paged();
    d.router.page_focus(PageFocus::Place(OWN.into()));
    d.router.page_focus(PageFocus::Rest);
    d.router.in_use(Some(OWN));
    assert_eq!(
        d.router.focused(),
        Some(OWN),
        "its own view in use: its page has them"
    );
    let out = d.router.in_use(Some(A));
    assert_eq!(kinds(&out), ["focus.out@window:w", "focus.in@a.one"]);
}

#[test]
fn a_press_on_a_plugin_in_a_window_reaches_the_windows_own_page_too_at_its_own_point() {
    let mut d = paged();
    d.to(300.0, 200.0);
    let out = d.press(true);
    let pressed: Vec<(String, (f64, f64))> = sent(&out)
        .iter()
        .filter(|m| m["type"] == "pointer.down")
        .map(|m| {
            (
                m["surface"].as_str().unwrap_or_default().to_owned(),
                point(m),
            )
        })
        .collect();
    let at = |s: &str| pressed.iter().find(|(p, _)| p == s).map(|(_, at)| *at);
    // The plugin's pane: the plugin, its window's page (whose DOM finds the pane and focuses its
    // window), and the page under everything, each at its own point.
    assert_eq!(at(A), Some((200.0, 110.0)));
    assert_eq!(
        at(OWN),
        Some((200.0, 150.0)),
        "the window's page from its top left"
    );
    assert_eq!(at(PAGE), Some((300.0, 200.0)));
    assert_eq!(d.router.focused(), Some(A), "the plugin takes the keys");
}

#[test]
fn a_right_press_on_a_plugin_in_a_window_is_the_plugins_and_never_its_windows_page() {
    let mut d = paged();
    d.to(300.0, 200.0);
    let right = |pressed| Input::PointerButton {
        button: Button::Right,
        pressed,
    };
    let mut out = d.feed(right(true));
    out.extend(d.feed(right(false)));
    let buttons: Vec<String> = kinds(&out)
        .into_iter()
        .filter(|k| k.starts_with("pointer.down") || k.starts_with("pointer.up"))
        .collect();
    // Its context menu (a field's menu) is the plugin's alone: the window's page would open its own.
    assert_eq!(
        buttons,
        [
            format!("pointer.down@{A}"),
            format!("pointer.down@{PAGE}"),
            format!("pointer.up@{A}"),
            format!("pointer.up@{PAGE}"),
        ]
    );
}

#[test]
fn a_surface_is_the_pages_own_by_the_start_of_its_id() {
    let settings = PointerSettings {
        underlay: Some(PAGE.into()),
        pages: Some("window:".into()),
        ..PointerSettings::default()
    };
    assert!(settings.page_owned(PAGE));
    assert!(settings.page_owned("window:local:claude"));
    assert!(!settings.page_owned(A));
    assert!(
        !PointerSettings::default().page_owned(PAGE),
        "no underlay, no page"
    );
}
