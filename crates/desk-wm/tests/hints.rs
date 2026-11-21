//! A window's hints (ADR 0226): what a plugin's manifest asks of its window (`SurfaceWindow` in
//! `specs/plugin/v0`) on the canvas. The first size at the window's slot, the smallest the person
//! can make it, and a window that keeps its size; a window of several panes follows its panes.

use desk_wm::edits::{Edit, Kept, apply};
use desk_wm::host::{BORDER, TITLE};
use desk_wm::interact::{Op, Wm};
use desk_wm::{Desk, FREE, MIN, Offset, Size, WindowHints, screen_rect, slot_windows};
use serde_json::json;

const APP: Size = Size {
    w: 1440.0,
    h: 900.0,
};

fn hinted(hints: serde_json::Value) -> Edit {
    let edit = json!({ "op": "adopt", "id": "p.app", "title": "App", "window": hints });
    serde_json::from_value(edit).expect("an adopt edit")
}

fn desk_with(hints: serde_json::Value) -> Desk {
    let mut desk = Desk::default();
    apply(&mut desk, &mut Kept::default(), &hinted(hints), APP);
    desk
}

#[test]
fn a_window_opens_as_large_as_its_plugins_page_asks_at_its_slot() {
    let desk = desk_with(json!({ "size": { "w": 480.0, "h": 360.0 } }));
    let p = desk.window("p.app").expect("its window");
    assert_eq!(
        (p.w, p.h),
        (480.0 + 2.0 * BORDER, 360.0 + 2.0 * BORDER + TITLE)
    );
    let area = desk.adopted[0].area.expect("the area it arrived in");
    assert_eq!((p.x, p.y), (area.x, area.y));
}

#[test]
fn a_window_without_hints_keeps_its_slots_size() {
    let mut desk = Desk::default();
    let plain = json!({ "op": "adopt", "id": "p.app", "title": "App" });
    let edit: Edit = serde_json::from_value(plain).expect("an adopt edit");
    apply(&mut desk, &mut Kept::default(), &edit, APP);
    let slot = slot_windows(&desk.adopted, |_| false)[0].rect();
    let area = desk.adopted[0].area.expect("the area it arrived in");
    assert_eq!(slot, desk_wm::slot_rect_in(0, area));
    assert_eq!(desk.adopted[0].hints, None);
}

#[test]
fn a_first_size_larger_than_the_slot_stays_inside_the_free_area() {
    let hints = WindowHints {
        size: Some(Size { w: 900.0, h: 400.0 }),
        ..WindowHints::default()
    };
    let slot = desk_wm::slot_rect_in(2, FREE);
    let r = hints.first(slot, FREE, MIN);
    assert_eq!(r.w, 902.0);
    assert_eq!(r.right(), FREE.right());
    assert!(r.x >= FREE.x && r.y >= FREE.y);
}

#[test]
fn a_first_size_under_the_minimum_asked_opens_at_the_minimum() {
    let desk = desk_with(json!({
        "size": { "w": 300.0, "h": 200.0 },
        "min": { "w": 400.0, "h": 300.0 },
    }));
    let p = desk.window("p.app").expect("its window");
    assert_eq!((p.w, p.h), (402.0, 338.0));
}

#[test]
fn a_resize_stops_at_the_smallest_page_the_plugin_asks() {
    let desk = desk_with(json!({ "min": { "w": 400.0, "h": 300.0 } }));
    let p = desk.window("p.app").expect("its window");
    assert_eq!(desk.least_of(&p), Size { w: 402.0, h: 338.0 });
    let mut wm = Wm::new();
    wm.start(desk, APP);
    wm.run(
        &Op::Resize {
            dw: -2000.0,
            dh: -2000.0,
        },
        Some("p.app"),
    );
    let p = wm.desk().window("p.app").expect("its window");
    assert_eq!((p.w, p.h), (402.0, 338.0));
}

#[test]
fn a_window_that_keeps_its_size_is_not_resized_and_shows_no_grip() {
    let desk = desk_with(json!({ "size": { "w": 480.0, "h": 360.0 }, "fixed": true }));
    let before = desk.window("p.app").expect("its window");
    assert!(!desk.resizable(&before));
    let mut wm = Wm::new();
    wm.start(desk, APP);
    wm.run(
        &Op::Resize {
            dw: 100.0,
            dh: 100.0,
        },
        Some("p.app"),
    );
    let after = wm.desk().window("p.app").expect("its window");
    assert_eq!((after.w, after.h), (before.w, before.h));
    let r = screen_rect(&after, wm.desk().pan_of(&wm.desk().here()), APP.w, APP.h);
    let corner = Offset::new(r.right() - 2.0, r.bottom() - 2.0);
    assert_eq!(wm.cursor_at(corner, 0.0), None);
}

#[test]
fn a_window_of_several_tabs_follows_the_hints_of_the_tab_it_shows() {
    let mut desk = desk_with(json!({ "min": { "w": 400.0, "h": 300.0 }, "fixed": true }));
    desk.focus_tab("p.app", None);
    // Another window of the plugin, which asks for nothing, as a tab: shown, the window resizes.
    desk.adopt("p.app@2", "App", desk_wm::FREE);
    let added = desk
        .add_tab("p.app", "plugin:p.app@2")
        .expect("a tab of its own kind");
    let p = desk.window("p.app").expect("its window");
    assert!(desk.resizable(&p));
    assert_eq!(desk.least_of(&p), desk_wm::MIN);
    // Back on its first tab it keeps to that one's hints.
    desk.step_tab(1);
    let p = desk.window("p.app").expect("its window");
    assert_ne!(p.shown().id, added);
    assert!(!desk.resizable(&p));
    // Its 400 × 300 of content, in the window's frame.
    assert_eq!((desk.least_of(&p).w, desk.least_of(&p).h), (402.0, 338.0));
}
