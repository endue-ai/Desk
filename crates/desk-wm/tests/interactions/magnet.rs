//! Magnetic edges on the compositor's input (`magnet.rs`): a window dragged or resized with an edge
//! close to a neighbour's lands flush with it; one dropped farther off stays where it was dropped.

use desk_wm::interact::{Grip, Kind};
use desk_wm::{Desk, MAGNET, Rect};

use super::support::*;

fn two() -> Desk {
    let mut desk = windows(2);
    desk.place("window-1", Rect::new(100.0, 200.0, 400.0, 300.0));
    desk.place("window-2", Rect::new(800.0, 260.0, 300.0, 240.0));
    desk
}

#[test]
fn dragged_close_beside_a_neighbour_a_window_lands_flush_against_it() {
    let mut wm = wm_of(&two());
    let win = rect_of(&wm, "window-2");
    let left = rect_of(&wm, "window-1").right();
    let from = title_of(win);
    // Its left edge 6 px right of window-1's right edge.
    let to = pt(from.x - (win.x - left) + 6.0, from.y + 30.0);
    drag(&mut wm, moving("window-2"), from, to);
    let r = rect_of(&wm, "window-2");
    assert_eq!(r.x, left);
    assert_eq!(r.y, win.y + 30.0);
}

#[test]
fn dropped_out_of_reach_a_window_stays_where_it_was_dropped() {
    let mut wm = wm_of(&two());
    let win = rect_of(&wm, "window-2");
    let left = rect_of(&wm, "window-1").right();
    let from = title_of(win);
    let to = pt(from.x - (win.x - left) + MAGNET + 20.0, from.y + 30.0);
    drag(&mut wm, moving("window-2"), from, to);
    assert_eq!(rect_of(&wm, "window-2").x, left + MAGNET + 20.0);
}

#[test]
fn resized_close_to_a_neighbour_an_edge_lands_flush_against_it() {
    let mut wm = wm_of(&two());
    let win = rect_of(&wm, "window-1");
    let target = rect_of(&wm, "window-2").x;
    let from = pt(win.right() - 2.0, win.y + win.h / 2.0);
    let kind = Kind::Resize {
        window: "window-1".into(),
        grip: Grip::E,
    };
    drag(&mut wm, kind, from, pt(target - 7.0, from.y));
    let r = rect_of(&wm, "window-1");
    assert_eq!((r.x, r.right()), (win.x, target));
}
