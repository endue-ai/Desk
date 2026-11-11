use std::time::{Duration, Instant};

use desk_compositor::glam::Vec2;
use desk_compositor::{ChromeTheme, Rect, Scene};

use super::super::tooltip_draw::{Placed, boxes, draw};
use super::{DELAY, Tips, shown};

const MS: Duration = Duration::from_millis(1);

fn hearing(surface: &str) -> Vec<String> {
    vec![surface.to_owned()]
}

/// A desk where the pointer came to rest at 100,100 on the page at `t0`, and the page said
/// `title` there.
fn resting(title: &str) -> (Tips, Instant) {
    let t0 = Instant::now();
    let mut tips = Tips::default();
    tips.moved(Vec2::new(100.0, 100.0), 1.0, t0);
    tips.said("desk", title, t0 + 20 * MS);
    (tips, t0)
}

#[test]
fn a_title_shows_once_the_pointer_has_rested_on_its_surface() {
    let (mut tips, t0) = resting("Open settings");
    let at = t0 + 20 * MS;
    assert!(!tips.look(at, &hearing("desk")));
    assert_eq!(tips.due(), Some(at + DELAY), "the loop wakes for it");
    assert!(!tips.look(at + DELAY - MS, &hearing("desk")));
    assert!(tips.look(at + DELAY, &hearing("desk")));
    let tip = tips.shown().expect("shown");
    assert_eq!(
        (tip.surface.as_str(), tip.text.as_str()),
        ("desk", "Open settings")
    );
    assert_eq!(tip.at, Vec2::new(100.0, 100.0));
    assert!(!tips.look(at + DELAY * 4, &hearing("desk")), "it stays");
}

#[test]
fn only_the_surface_the_pointer_is_in_shows_its_title() {
    let (mut tips, t0) = resting("Open settings");
    let late = t0 + DELAY * 2;
    assert!(!tips.look(late, &hearing("main.endue-notes")));
    assert_eq!(tips.due(), None, "nothing to wake for");
    assert!(tips.look(late, &hearing("desk")));
    assert!(
        tips.look(late, &hearing("main.endue-notes")),
        "it goes with the pointer"
    );
    assert!(tips.shown().is_none());
    // Over a plugin's page the desk's page hears the pointer too, under it: its title is not
    // the plugin's.
    let over_notes = ["main.endue-notes".to_owned(), "desk".to_owned()];
    assert!(!tips.look(late + DELAY, &over_notes));
    tips.said("main.endue-notes", "Bold (⌘B)", late + DELAY);
    assert!(tips.look(late + DELAY * 2, &over_notes));
    assert_eq!(tips.shown().map(|t| t.text.as_str()), Some("Bold (⌘B)"));
}

#[test]
fn a_move_past_the_slop_puts_it_away_until_the_pointer_rests_again() {
    let (mut tips, t0) = resting("Split right (⌘D)");
    let t1 = t0 + DELAY * 2;
    assert!(tips.look(t1, &hearing("desk")));
    assert!(
        !tips.moved(Vec2::new(106.0, 101.0), 2.0, t1),
        "within 4 CSS px at 2x"
    );
    assert!(tips.shown().is_some());
    assert!(tips.moved(Vec2::new(110.0, 101.0), 2.0, t1 + MS));
    assert!(!tips.look(t1 + MS, &hearing("desk")));
    assert_eq!(tips.due(), Some(t1 + MS + DELAY));
    assert!(tips.look(t1 + MS + DELAY, &hearing("desk")));
    assert_eq!(tips.shown().map(|t| t.at), Some(Vec2::new(110.0, 101.0)));
}

#[test]
fn a_press_puts_it_away_until_the_pointer_let_go_moves_on() {
    let (mut tips, t0) = resting("Open settings");
    let t1 = t0 + DELAY * 2;
    assert!(tips.look(t1, &hearing("desk")));
    assert!(tips.pressed(Some(true), t1));
    assert!(!tips.pressed(Some(false), t1 + 30 * MS));
    assert!(!tips.look(t1 + DELAY * 3, &hearing("desk")), "quiet");
    assert_eq!(tips.due(), None, "nothing to wake for");
    // The page said none, then the title again: still the pressed button's.
    tips.said("desk", "", t1 + DELAY * 3);
    tips.said("desk", "Open settings", t1 + DELAY * 3 + MS);
    assert!(!tips.look(t1 + DELAY * 5, &hearing("desk")));
    // A move within the slop is the hand at rest; past it, the pointer moved on.
    tips.moved(Vec2::new(103.0, 100.0), 1.0, t1 + DELAY * 5);
    assert!(!tips.look(t1 + DELAY * 7, &hearing("desk")));
    tips.moved(Vec2::new(110.0, 100.0), 1.0, t1 + DELAY * 7);
    assert!(!tips.look(t1 + DELAY * 7, &hearing("desk")));
    assert!(tips.look(t1 + DELAY * 8, &hearing("desk")));
}

#[test]
fn a_title_said_late_for_a_pressed_or_dragged_window_never_shows_at_its_drop() {
    // The pointer comes to a title bar and presses at once: the page says its title only after.
    let t0 = Instant::now();
    let mut tips = Tips::default();
    tips.moved(Vec2::new(300.0, 274.0), 1.0, t0);
    tips.pressed(Some(true), t0 + MS);
    tips.said(
        "desk",
        "Maximize or restore (double-click the title)",
        t0 + 30 * MS,
    );
    // The window follows the pointer; its page catches up, past a grip and the body.
    for i in 1..=10 {
        let at = Vec2::new(300.0 + 16.0 * i as f32, 274.0 + 10.0 * i as f32);
        tips.moved(at, 1.0, t0 + 30 * i * MS);
        assert!(
            !tips.look(t0 + 30 * i * MS + DELAY, &hearing("desk")),
            "held"
        );
    }
    tips.said("desk", "Resize", t0 + 310 * MS);
    tips.said(
        "desk",
        "Maximize or restore (double-click the title)",
        t0 + 330 * MS,
    );
    tips.pressed(Some(false), t0 + 340 * MS);
    assert!(
        !tips.look(t0 + DELAY * 4, &hearing("desk")),
        "at rest at the drop"
    );
    assert_eq!(tips.due(), None);
}

#[test]
fn a_key_puts_it_away_until_the_pointer_moves_on() {
    let (mut tips, t0) = resting("Pin");
    let t1 = t0 + DELAY * 2;
    assert!(tips.look(t1, &hearing("desk")));
    assert!(tips.pressed(None, t1));
    assert!(!tips.look(t1 + DELAY * 3, &hearing("desk")));
    tips.moved(Vec2::new(90.0, 100.0), 1.0, t1 + DELAY * 3);
    assert!(tips.look(t1 + DELAY * 4, &hearing("desk")));
}

#[test]
fn the_wheel_puts_it_away_for_a_rest_and_leaving_the_window_ends_the_rest() {
    let (mut tips, t0) = resting("Pin");
    let t1 = t0 + DELAY * 2;
    assert!(tips.look(t1, &hearing("desk")));
    assert!(tips.wheel(t1));
    assert!(
        tips.look(t1 + DELAY, &hearing("desk")),
        "after another rest"
    );
    assert!(tips.left());
    assert!(!tips.look(t1 + DELAY * 9, &hearing("desk")));
    assert_eq!(tips.due(), None);
    // A press held while the pointer is out stays held when it comes back; losing the focus ends it.
    tips.pressed(Some(true), t1 + DELAY * 9);
    tips.left();
    tips.moved(Vec2::new(200.0, 200.0), 1.0, t1 + DELAY * 10);
    assert!(!tips.look(t1 + DELAY * 12, &hearing("desk")), "held");
    tips.blurred();
    tips.moved(Vec2::new(210.0, 200.0), 1.0, t1 + DELAY * 12);
    assert!(tips.look(t1 + DELAY * 13, &hearing("desk")));
}

#[test]
fn a_new_title_replaces_the_one_showing_after_its_own_rest() {
    let (mut tips, t0) = resting("Inbox · 0");
    let t1 = t0 + DELAY * 2;
    assert!(tips.look(t1, &hearing("desk")));
    assert!(tips.said("desk", "Inbox · 1", t1));
    assert!(!tips.look(t1, &hearing("desk")));
    assert!(tips.look(t1 + DELAY, &hearing("desk")));
    assert_eq!(tips.shown().map(|t| t.text.as_str()), Some("Inbox · 1"));
    assert!(
        !tips.said("main.endue-notes", "Bold", t1 + DELAY),
        "another page's"
    );
    assert!(tips.said("desk", "", t1 + DELAY), "the pointer left it");
    assert!(tips.shown().is_none());
}

#[test]
fn a_surface_that_leaves_the_desk_takes_its_title_along() {
    let (mut tips, t0) = resting("Open settings");
    assert!(tips.look(t0 + DELAY * 2, &hearing("desk")));
    assert!(tips.forget("desk"));
    assert!(!tips.look(t0 + DELAY * 4, &hearing("desk")));
    assert_eq!(tips.due(), None);
}

#[test]
fn a_title_keeps_its_lines_without_blank_ends_or_tabs() {
    assert_eq!(shown("Split right (⌘D)"), "Split right (⌘D)");
    assert_eq!(shown("  Inbox\r\n\t2 new  \r\n"), "Inbox\n 2 new");
    assert_eq!(shown("a\rb"), "a\nb");
    assert_eq!(shown("   \n "), "");
    let many = (0..40)
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    let cut = shown(&many);
    assert_eq!(cut.lines().count(), 16);
    assert!(cut.ends_with("15…"), "{cut}");
    let cut = shown(&"가".repeat(1030));
    assert_eq!(cut.chars().count(), 1025);
}

fn near(a: Rect, b: Rect) -> bool {
    let d = [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height];
    d.iter().all(|d| d.abs() < 0.01)
}

#[test]
fn the_box_sits_under_the_pointer_inside_the_window() {
    let style = ChromeTheme::default().tooltip;
    // 100 px of text on one line at 1x: 8 px padding across, 4 down, a 20 px line.
    let (pill, inner) = boxes(
        Vec2::new(300.0, 200.0),
        (100.0, 1),
        &style,
        1.0,
        (1280, 800),
    );
    assert!(near(pill, Rect::new(300.0, 220.0, 116.0, 28.0)), "{pill:?}");
    assert!(
        near(inner, Rect::new(308.0, 224.0, 100.0, 20.0)),
        "{inner:?}"
    );
    // At the right edge it moves left; at the bottom it goes above the pointer.
    let (pill, _) = boxes(
        Vec2::new(1270.0, 790.0),
        (100.0, 2),
        &style,
        1.0,
        (1280, 800),
    );
    assert!(
        near(pill, Rect::new(1160.0, 736.0, 116.0, 48.0)),
        "{pill:?}"
    );
    // At 2x every length doubles.
    let (pill, _) = boxes(
        Vec2::new(600.0, 400.0),
        (200.0, 1),
        &style,
        2.0,
        (2560, 1600),
    );
    assert!(near(pill, Rect::new(600.0, 440.0, 232.0, 56.0)), "{pill:?}");
}

#[test]
fn the_title_is_drawn_in_the_theme_and_takes_no_pointer() {
    let style = ChromeTheme::default().tooltip;
    let placed = Placed {
        pill: Rect::new(20.0, 20.0, 140.0, 28.0),
        inner: Rect::new(28.0, 24.0, 124.0, 20.0),
        text: "Open settings".into(),
    };
    let mut scene = Scene::new(200, 80);
    draw(&mut scene, &placed, &style, 1.0);
    let root = scene.root();
    assert_eq!(scene.children(root).len(), 2);
    assert_eq!(
        desk_compositor::hit_test(&scene, Vec2::new(40.0, 30.0)),
        None
    );
    let Ok(gpu) = desk_compositor::headless::headless_device() else {
        return;
    };
    let format = desk_compositor::wgpu::TextureFormat::Rgba8Unorm;
    let mut compositor = desk_compositor::Compositor::new(&gpu.device, &gpu.queue, format);
    let target = desk_compositor::headless::Target::new(&gpu.device, (200, 80), format);
    let stats = compositor.render(&scene, &target.view, target.size);
    let rgba = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    let at = |x: usize, y: usize| &rgba[(y * 200 + x) * 4..(y * 200 + x) * 4 + 3];
    // The box's fill is the theme's tooltip colour, #403a49; the text is light on it.
    let fill = at(40, 21);
    let want = [0x40, 0x3a, 0x49];
    assert!(
        fill.iter().zip(want).all(|(c, w)| c.abs_diff(w) <= 2),
        "{fill:?}"
    );
    let light = (24..44)
        .flat_map(|y| (28..152).map(move |x| (x, y)))
        .filter(|&(x, y)| at(x, y).iter().all(|c| *c > 180))
        .count();
    assert!(stats.glyphs >= 10, "{stats:?}");
    assert!(
        light > 20,
        "the title's glyphs show light on the box: {light}"
    );
}
