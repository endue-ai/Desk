//! A press on a window mid-glide (#124): the window manager hit-tests the rectangle being drawn,
//! not the one the glide ends at, and the press starts the gesture its point means there, the
//! glide ending at once. No grab from the page counts for it: the page lays the window out where
//! the glide ends, so what its DOM finds under the press is not what the person pressed.

use desk_wm::interact::{Grip, Kind, Motion, Wm};
use desk_wm::{Fill, Rect, snap_rect};

use super::support::*;

/// The frame the press follows: 60 ms into the glide's 220.
const HALF: f64 = 60.0;

/// A window dragged to the top-left corner and dropped at 0 ms, gliding into its quarter: the
/// window manager, the window's own rect before, and where it is drawn at `HALF`.
fn gliding() -> (Wm, Rect, Rect) {
    let desk = windows(1);
    let mut wm = wm_over(&desk, Motion::default());
    let win = rect_of(&wm, "window-1");
    drag(&mut wm, moving("window-1"), title_of(win), pt(3.0, 3.0));
    taken(&mut wm);
    let frame = wm.frame(HALF);
    let mid = frame.drawn["window-1"];
    assert!(
        frame.moving && mid != snap_rect(Fill::TopLeft, W, H),
        "it glides"
    );
    (wm, win, mid)
}

/// The pointer from `from` to `to` in eight moves from `now`, let go there.
fn drag_on(wm: &mut Wm, from: desk_wm::Point, to: desk_wm::Point, now: f64) {
    for i in 1..=8 {
        let k = f64::from(i) / 8.0;
        let at = pt(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
        wm.moved(at, now + f64::from(i));
    }
    wm.released(to, now + 10.0);
}

/// Out of its snap, its own size again (once that has glided back), under the pointer at `drop`.
fn out_of_its_snap(wm: &Wm, win: Rect, drop: desk_wm::Point) {
    let p = wm.desk().window("window-1").unwrap();
    assert_eq!((p.fill, p.restore, p.floating), (None, None, None));
    let back = wm.drawn_rect("window-1", 1.0e6).unwrap();
    assert_eq!((back.w, back.h), (win.w, win.h));
    assert!(back.x < drop.x && back.right() > drop.x, "{back:?}");
    assert!(back.y < drop.y && back.y + 40.0 > drop.y, "{back:?}");
}

#[test]
fn a_press_on_the_title_bar_mid_glide_moves_the_window_from_where_it_is_drawn() {
    let (mut wm, win, mid) = gliding();
    let from = title_of(mid);
    wm.pressed(from);
    assert!(wm.holds(), "the window manager took the press");
    // The glide ended: the window stays where it was drawn while the press holds it.
    let held = wm.frame(HALF + 40.0);
    assert_eq!(held.drawn.get("window-1"), Some(&mid));
    assert!(!held.moving);
    let drop = pt(700.0, 500.0);
    drag_on(&mut wm, from, drop, HALF + 40.0);
    out_of_its_snap(&wm, win, drop);
}

#[test]
fn a_press_on_a_grip_mid_glide_resizes_the_window_from_where_it_is_drawn() {
    let (mut wm, _, mid) = gliding();
    let grip = Grip::Se.rect_in(mid);
    let from = pt(grip.x + grip.w / 2.0, grip.y + grip.h / 2.0);
    wm.pressed(from);
    drag_on(&mut wm, from, pt(from.x - 40.0, from.y - 30.0), HALF);
    let p = wm.desk().window("window-1").unwrap();
    assert_eq!(p.fill, None, "a resize ends the fill where it is");
    let r = rect_of(&wm, "window-1");
    assert_eq!(
        (r.x, r.y),
        (mid.x, mid.y),
        "the opposite edges stay where they were drawn"
    );
    assert_eq!(
        (r.right(), r.bottom()),
        (mid.right() - 40.0, mid.bottom() - 30.0)
    );
}

#[test]
fn the_pages_grab_for_that_press_is_not_heard() {
    let (mut wm, win, mid) = gliding();
    let from = title_of(mid);
    wm.pressed(from);
    // Where the page lays the window out, its DOM found a grip under the press.
    let stale = Kind::Resize {
        window: "window-1".into(),
        grip: Grip::Nw,
    };
    wm.grab(stale, from, HALF);
    let drop = pt(700.0, 500.0);
    drag_on(&mut wm, from, drop, HALF);
    out_of_its_snap(&wm, win, drop);
}

#[test]
fn a_press_mid_glide_that_never_drags_lets_the_window_glide_on_from_there() {
    let (mut wm, _, mid) = gliding();
    let from = title_of(mid);
    wm.pressed(from);
    wm.released(from, HALF + 30.0);
    let on = wm.frame(HALF + 30.0);
    assert_eq!(
        on.drawn.get("window-1"),
        Some(&mid),
        "on from where it stopped"
    );
    assert!(on.moving);
    assert!(
        wm.frame(HALF + 30.0 + Motion::default().base)
            .drawn
            .is_empty()
    );
    assert_eq!(rect_of(&wm, "window-1"), snap_rect(Fill::TopLeft, W, H));
    let p = wm.desk().window("window-1").unwrap();
    assert_eq!(p.fill, Some(Fill::TopLeft));
}

#[test]
fn a_press_on_its_body_or_its_tools_mid_glide_is_the_pages_and_the_glide_goes_on() {
    let (mut wm, _, mid) = gliding();
    let body = pt(mid.x + mid.w / 2.0, mid.y + mid.h / 2.0);
    let tools = pt(mid.right() - 30.0, mid.y + 20.0);
    for at in [body, tools] {
        wm.pressed(at);
        assert!(!wm.holds(), "{at:?}");
        assert!(wm.frame(HALF + 1.0).moving, "{at:?}: it still glides");
        wm.released(at, HALF + 1.0);
    }
}

#[test]
fn once_it_has_arrived_a_press_waits_for_the_pages_grab_as_before() {
    let (mut wm, _, _) = gliding();
    assert!(!wm.frame(HALF + 1000.0).moving);
    let from = title_of(rect_of(&wm, "window-1"));
    wm.pressed(from);
    assert!(!wm.holds(), "the page says what the press starts");
    wm.grab(moving("window-1"), from, HALF + 1000.0);
    assert!(wm.holds());
}
