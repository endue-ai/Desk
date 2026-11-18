//! A press decides the window in use (#251, ADR 0230): the window manager puts the window drawn
//! topmost under a press in use, with the tab it shows, before the press is routed, and
//! publishes the desk so. No grab and no edit of the page's takes part.

use desk_wm::Rect;

#[path = "interactions/support.rs"]
mod support;
use support::*;

/// Two windows side by side, `window-2` (opened last) in use.
fn two() -> desk_wm::interact::Wm {
    let mut desk = windows(2);
    desk.place("window-1", Rect::new(100.0, 200.0, 400.0, 300.0));
    desk.place("window-2", Rect::new(700.0, 200.0, 400.0, 300.0));
    wm_of(&desk)
}

fn body_at(r: Rect) -> desk_wm::Point {
    pt(r.x + r.w / 2.0, r.y + r.h / 2.0)
}

#[test]
fn a_press_on_a_window_puts_it_in_use_at_once_and_publishes_the_desk() {
    let mut wm = two();
    assert_eq!(wm.in_use().0, Some("window-2"));
    let out = wm.pressed(body_at(rect_of(&wm, "window-1")));
    assert_eq!(wm.in_use().0, Some("window-1"), "before any grab or edit");
    let told = published(&out);
    assert_eq!(told.len(), 1);
    assert_eq!(told[0].desk.focused.as_deref(), Some("window-1"));
    // It is drawn in front from that frame on.
    assert_eq!(wm.window_at(pt(110.0, 210.0)).as_deref(), Some("window-1"));
}

#[test]
fn a_press_on_the_window_in_use_publishes_nothing() {
    let mut wm = two();
    let out = wm.pressed(title_of(rect_of(&wm, "window-2")));
    assert!(published(&out).is_empty());
    assert_eq!(wm.in_use().0, Some("window-2"));
}

#[test]
fn the_window_in_front_takes_a_press_where_two_overlap() {
    let mut desk = windows(2);
    desk.place("window-1", Rect::new(100.0, 200.0, 400.0, 300.0));
    desk.place("window-2", Rect::new(300.0, 250.0, 400.0, 300.0));
    let mut wm = wm_of(&desk);
    // Where both lie, the one in use is in front; left of it only window-1 is.
    wm.pressed(pt(350.0, 300.0));
    assert_eq!(wm.in_use().0, Some("window-2"));
    wm.pressed(pt(150.0, 300.0));
    assert_eq!(wm.in_use().0, Some("window-1"));
    // Now window-1 is in front where both lie.
    wm.pressed(pt(350.0, 300.0));
    assert_eq!(wm.in_use().0, Some("window-1"));
}

#[test]
fn a_press_on_the_empty_desk_leaves_the_window_in_use() {
    let mut wm = two();
    let out = wm.pressed(pt(600.0, 700.0));
    assert!(published(&out).is_empty());
    assert_eq!(wm.in_use().0, Some("window-2"));
    assert_eq!(wm.window_at(pt(600.0, 700.0)), None);
}

#[test]
fn a_press_on_a_part_of_the_system_layer_over_a_window_is_not_the_windows() {
    let mut wm = two();
    let r = rect_of(&wm, "window-1");
    // A bar of the page's lies over window-1's top left.
    wm.set_system_parts(vec![Rect::new(r.x, r.y, 120.0, 60.0)]);
    let out = wm.pressed(pt(r.x + 30.0, r.y + 30.0));
    assert!(published(&out).is_empty());
    assert_eq!(wm.in_use().0, Some("window-2"));
    assert_eq!(wm.window_at(pt(r.x + 30.0, r.y + 30.0)), None);
    // Beside the bar the window takes the press.
    wm.pressed(pt(r.x + 200.0, r.y + 100.0));
    assert_eq!(wm.in_use().0, Some("window-1"));
}

#[test]
fn a_press_puts_the_window_in_use_with_the_tab_it_shows() {
    let mut desk = windows(2);
    desk.place("window-1", Rect::new(100.0, 200.0, 400.0, 300.0));
    desk.place("window-2", Rect::new(700.0, 200.0, 400.0, 300.0));
    common_tabs(&mut desk, "window-1");
    desk.focus_tab("window-2", None);
    let mut wm = wm_of(&desk);
    let shown = wm.desk().window("window-1").unwrap().shown().id;
    let out = wm.pressed(body_at(rect_of(&wm, "window-1")));
    assert_eq!(wm.in_use(), (Some("window-1"), Some(shown.as_str())));
    assert_eq!(published(&out).len(), 1);
    // A press on its title bar keeps it so, and publishes nothing.
    let out = wm.pressed(title_of(rect_of(&wm, "window-1")));
    assert!(published(&out).is_empty());
    assert_eq!(wm.in_use().1, Some(shown.as_str()));
}

/// `window` showing a plugin, with a second tab of that plugin, which it shows.
fn common_tabs(desk: &mut desk_wm::Desk, window: &str) {
    for id in ["p.tabs", "p.tabs@2"] {
        desk.adopt(id, id, desk_wm::FREE);
    }
    desk.show_in_tab(window, "p1", "plugin:p.tabs");
    desk.add_tab(window, "plugin:p.tabs@2")
        .expect("a tab of its kind");
}

#[test]
fn a_secondary_buttons_press_decides_as_well() {
    let mut wm = two();
    let out = wm.press_focus(body_at(rect_of(&wm, "window-1")));
    assert_eq!(published(&out).len(), 1);
    assert_eq!(wm.in_use().0, Some("window-1"));
}
