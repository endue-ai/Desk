//! What the pointer can always take again (#159 findings 4, 7, 10 and 11): a window's title bar
//! within reach after a drop and after the move commands, clear of the dock; a snapped window
//! resized by a grip in the mode it had before it snapped; and a drag that is never the second
//! click of a double-click.

use desk_wm::host::TITLE_END;
use desk_wm::interact::{Grip, Kind, Op};
use desk_wm::{Fill, GRAB, Rect, snap_rect};

use super::support::*;

/// The dock on a 1440 × 900 app, as the page lays it out at the bottom edge.
const DOCK: Rect = Rect::new(13.0, 801.0, 1414.0, 58.0);
/// A title bar's top to its bottom line.
const BAR: f64 = 41.0;

/// Whether a window drawn at `r` has its title bar where the pointer can take it.
fn reachable(r: Rect) -> bool {
    let stretch = r.w - TITLE_END - 1.0;
    r.y >= 0.0 && r.y + BAR <= H && r.x + stretch >= GRAB.min(stretch) && r.x <= W - GRAB
}

mod a_drop {
    use super::*;

    #[test]
    fn with_the_title_bar_under_the_dock_puts_it_above_the_dock() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        wm.set_edge_bars(vec![DOCK]);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        // Dropped with the pointer on the dock's tiles, its title bar under them.
        let to = pt(from.x, 826.0);
        drag(&mut wm, moving("window-1"), from, to);
        let dropped = rect_of(&wm, "window-1");
        assert_eq!(dropped.y + BAR, DOCK.y, "{dropped:?}");
        assert_eq!(dropped.x, win.x);
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.fill, p.floating), (None, None));
    }

    #[test]
    fn from_inside_each_edge_band_to_far_outside_the_app_leaves_the_title_bar_in_reach() {
        // A window grabbed in an edge's snap band aims at no snap (ADR 0128's intent rule).
        let cases = [
            (
                Rect::new(400.0, -15.0, 480.0, 320.0),
                pt(480.0, 5.0),
                pt(480.0, -600.0),
            ),
            (
                Rect::new(-300.0, 300.0, 480.0, 320.0),
                pt(10.0, 320.0),
                pt(-800.0, 320.0),
            ),
            (
                Rect::new(1300.0, 300.0, 480.0, 320.0),
                pt(1430.0, 320.0),
                pt(2100.0, 320.0),
            ),
            (
                Rect::new(500.0, 870.0, 480.0, 320.0),
                pt(600.0, 890.0),
                pt(600.0, 1500.0),
            ),
        ];
        for (at, from, to) in cases {
            let mut desk = windows(1);
            desk.place("window-1", at);
            let mut wm = wm_of(&desk);
            drag(&mut wm, moving("window-1"), from, to);
            let dropped = rect_of(&wm, "window-1");
            assert!(reachable(dropped), "{to:?}: {dropped:?}");
            assert_eq!(wm.desk().window("window-1").unwrap().fill, None);
        }
    }

    #[test]
    fn glides_back_into_reach_from_where_it_was_let_go() {
        let mut desk = windows(1);
        desk.place("window-1", Rect::new(400.0, -15.0, 480.0, 320.0));
        let mut wm = wm_over(&desk, desk_wm::interact::Motion::default());
        // Grabbed in the top band, so it aims at no snap, and let go far above the app.
        let (from, to) = (pt(480.0, 5.0), pt(480.0, -300.0));
        hold(&mut wm, moving("window-1"), from, to, 8);
        wm.released(to, 1000.0);
        let start = wm.frame(1000.0).drawn["window-1"];
        assert_eq!(start.y, -15.0 + to.y - from.y);
        assert!(wm.frame(3000.0).drawn.is_empty());
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.y, p.fill), (0.0, None));
    }

    #[test]
    fn of_a_resize_leaves_the_window_where_its_edges_are() {
        let mut desk = windows(1);
        desk.place("window-1", Rect::new(300.0, 810.0, 480.0, 320.0));
        let mut wm = wm_of(&desk);
        wm.set_edge_bars(vec![DOCK]);
        let grip = Kind::Resize {
            window: "window-1".into(),
            grip: Grip::E,
        };
        drag(&mut wm, grip, pt(776.0, 900.0), pt(876.0, 900.0));
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect::new(300.0, 810.0, 580.0, 320.0)
        );
    }
}

mod the_move_commands {
    use super::*;

    #[test]
    fn thirty_steps_up_or_left_stop_with_the_title_bar_in_the_app() {
        for (dx, dy) in [(0.0, -32.0), (-32.0, 0.0), (32.0, 0.0), (0.0, 32.0)] {
            let desk = windows(1);
            let mut wm = wm_of(&desk);
            wm.set_edge_bars(vec![DOCK]);
            for _ in 0..30 {
                wm.run(&Op::Move { dx, dy }, None);
            }
            let r = rect_of(&wm, "window-1");
            assert!(reachable(r), "({dx}, {dy}): {r:?}");
            if dy > 0.0 {
                assert_eq!(r.y + BAR, DOCK.y, "down to the dock, not under it");
            }
        }
    }
}

mod leaving_a_snap_by_a_grip {
    use super::*;

    #[test]
    fn a_snapped_window_resized_is_back_in_its_own_mode_at_its_new_size() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        wm.run(&Op::Snap { fill: Fill::Left }, None);
        let half = snap_rect(Fill::Left, W, H);
        assert_eq!(rect_of(&wm, "window-1"), half);
        let edge = Kind::Resize {
            window: "window-1".into(),
            grip: Grip::E,
        };
        let from = pt(half.right() - 3.0, 450.0);
        drag(&mut wm, edge, from, pt(from.x - 131.0, 450.0));
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.fill, p.restore, p.floating), (None, None, None));
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                w: half.w - 131.0,
                ..half
            }
        );
        // On the canvas again: a drag by its title takes it down too.
        let r = rect_of(&wm, "window-1");
        drag(
            &mut wm,
            moving("window-1"),
            title_of(r),
            pt(r.x + 250.0, 300.0),
        );
        assert_eq!(rect_of(&wm, "window-1").y, 300.0 - 20.0);
    }

    #[test]
    fn a_floating_window_snapped_and_resized_floats_still() {
        let mut desk = windows(1);
        desk.toggle_floating("window-1", W, H);
        let mut wm = wm_of(&desk);
        wm.run(&Op::Snap { fill: Fill::Right }, None);
        let half = snap_rect(Fill::Right, W, H);
        let edge = Kind::Resize {
            window: "window-1".into(),
            grip: Grip::W,
        };
        let from = pt(half.x + 3.0, 450.0);
        drag(&mut wm, edge, from, pt(from.x + 100.0, 450.0));
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.fill, p.floating), (None, Some(true)));
    }
}

mod a_drag {
    use super::*;

    #[test]
    fn right_after_a_click_is_no_double_click_and_leaves_the_window_where_it_was_dropped() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        // A click on the title, then at once a press there that drags 80 px.
        wm.pressed(from);
        wm.released(from, 100.0);
        let to = pt(from.x + 80.0, from.y + 30.0);
        hold(&mut wm, moving("window-1"), from, to, 8);
        wm.released(to, 400.0);
        // The page counts the release as a double-click on the title and asks to maximize.
        let out = wm.run_at(&Op::Maximize, Some("window-1"), 430.0);
        assert!(published(&out).is_empty());
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.fill, p.restore), (None, None));
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                x: win.x + 80.0,
                y: win.y + 30.0,
                ..win
            }
        );
    }

    #[test]
    fn leaves_a_real_double_click_and_the_commands_alone() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        drag(&mut wm, moving("window-1"), from, pt(from.x + 80.0, from.y));
        // The palette's maximize names no window; one asked long after the drop is the person's.
        wm.run_at(&Op::Maximize, None, 100.0);
        assert_eq!(wm.desk().window("window-1").unwrap().fill, Some(Fill::Full));
        wm.run_at(&Op::Maximize, None, 200.0);
        let moved = rect_of(&wm, "window-1");
        drag(
            &mut wm,
            moving("window-1"),
            title_of(moved),
            pt(700.0, 400.0),
        );
        wm.run_at(&Op::Maximize, Some("window-1"), 5000.0);
        assert_eq!(wm.desk().window("window-1").unwrap().fill, Some(Fill::Full));
        // Two clicks with no drag between them maximize.
        wm.run_at(&Op::Maximize, None, 5100.0);
        let r = rect_of(&wm, "window-1");
        let at = title_of(r);
        wm.pressed(at);
        wm.released(at, 6000.0);
        wm.pressed(at);
        wm.released(at, 6100.0);
        wm.run_at(&Op::Maximize, Some("window-1"), 6120.0);
        assert_eq!(wm.desk().window("window-1").unwrap().fill, Some(Fill::Full));
    }
}
