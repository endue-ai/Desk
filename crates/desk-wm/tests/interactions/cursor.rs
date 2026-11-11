//! The cursor of what the window manager runs (#159 finding 13): each grip's resize cursor, also
//! where it lies over a plugin's surface, a grab hand over a title bar, a grabbing one while a move
//! or a pan is dragged, and nothing of its own over the system layer, the tools or a body.

use desk_wm::Rect;
use desk_wm::host::TITLE_END;
use desk_wm::interact::{GRIPS, Grip, Kind, grip_at};

use super::support::*;

const WIN: Rect = Rect::new(168.0, 254.0, 402.0, 305.0);

fn one_window() -> desk_wm::interact::Wm {
    let mut desk = windows(1);
    desk.place("window-1", WIN);
    wm_of(&desk)
}

#[test]
fn over_each_grip_the_window_shows_its_resize_cursor() {
    let wm = one_window();
    for grip in GRIPS {
        let r = grip.rect_in(WIN);
        let at = pt(r.x + r.w / 2.0, r.y + r.h / 2.0);
        assert_eq!(grip_at(WIN, at), Some(grip));
        assert_eq!(wm.cursor_at(at, 0.0), Some(grip.cursor()), "{grip:?}");
    }
    // The east edge over the window's surface, where a terminal shows its text beam.
    let east = pt(WIN.right() - 3.0, 404.0);
    assert_eq!(wm.cursor_at(east, 0.0), Some("ew-resize"));
}

#[test]
fn over_the_title_a_grab_hand_and_over_the_tools_the_body_and_the_desk_nothing() {
    let wm = one_window();
    assert_eq!(
        wm.cursor_at(pt(WIN.x + 80.0, WIN.y + 20.0), 0.0),
        Some("grab")
    );
    let tools = pt(WIN.right() - TITLE_END / 2.0, WIN.y + 20.0);
    assert_eq!(wm.cursor_at(tools, 0.0), None);
    assert_eq!(wm.cursor_at(pt(300.0, 400.0), 0.0), None);
    assert_eq!(wm.cursor_at(pt(900.0, 100.0), 0.0), None);
    // A pinned window's title bar moves nothing.
    let mut desk = windows(1);
    desk.place("window-1", WIN);
    desk.toggle_pin("window-1");
    let pinned = wm_of(&desk);
    assert_eq!(pinned.cursor_at(pt(WIN.x + 80.0, WIN.y + 20.0), 0.0), None);
}

#[test]
fn the_system_layer_and_the_edge_bars_above_a_window_keep_their_own() {
    let mut wm = one_window();
    let at = pt(WIN.x + 80.0, WIN.y + 20.0);
    wm.set_system_parts(vec![Rect::new(200.0, 250.0, 100.0, 40.0)]);
    assert_eq!(wm.cursor_at(at, 0.0), None);
    wm.set_system_parts(Vec::new());
    wm.set_edge_bars(vec![Rect::new(0.0, 250.0, 1440.0, 58.0)]);
    assert_eq!(wm.cursor_at(at, 0.0), None);
}

#[test]
fn a_resize_held_keeps_its_cursor_and_a_drag_grabs() {
    let mut wm = one_window();
    let grip = Kind::Resize {
        window: "window-1".into(),
        grip: Grip::Se,
    };
    let corner = Grip::Se.rect_in(WIN);
    let from = pt(corner.x + 8.0, corner.y + 8.0);
    hold(&mut wm, grip, from, pt(from.x + 300.0, from.y + 200.0), 6);
    assert_eq!(wm.cursor_at(pt(900.0, 100.0), 0.0), Some("nwse-resize"));
    wm.released(pt(900.0, 100.0), 0.0);
    let r = rect_of(&wm, "window-1");
    let title = pt(r.x + 80.0, r.y + 20.0);
    hold(
        &mut wm,
        moving("window-1"),
        title,
        pt(title.x + 200.0, title.y + 100.0),
        6,
    );
    assert_eq!(
        wm.cursor_at(pt(title.x + 200.0, title.y + 100.0), 0.0),
        Some("grabbing")
    );
    wm.escape();
    hold(&mut wm, Kind::Pan, pt(900.0, 100.0), pt(800.0, 150.0), 6);
    assert_eq!(wm.cursor_at(pt(800.0, 150.0), 0.0), Some("grabbing"));
}
