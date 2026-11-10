//! Ported from `packages/runtime/src/surface/snap.test.ts` and `settle.test.ts`, case by case.
//!
//! `settle.test.ts` drives a DOM element's classes, `transitionend` events and fake timers; here
//! the same rules drive a `Settle`, told which property arrived and how much time passed. The
//! compositor's glide (#80) reads `gliding()` where the DOM read the class.

use desk_wm::{
    Aim, CORNER, Fill, Glided, Point, Rect, SNAP, SNAP_TOP, Settle, SettleKind, fill_rect, halves,
    rows, snap_for,
};

const AREA: Rect = Rect::new(0.0, 0.0, 1440.0, 900.0);
const RIGHT: f64 = AREA.x + AREA.w;
const BOTTOM: f64 = AREA.y + AREA.h;

fn at(x: f64, y: f64) -> Point {
    Point::new(x, y)
}

mod snap_for {
    use super::*;

    fn snap(x: f64, y: f64) -> Option<Fill> {
        snap_for(at(x, y), AREA)
    }

    #[test]
    fn each_of_the_four_edges_snaps_to_its_half() {
        assert_eq!(snap(10.0, 450.0), Some(Fill::Left));
        assert_eq!(snap(RIGHT - 5.0, 450.0), Some(Fill::Right));
        assert_eq!(snap(720.0, 4.0), Some(Fill::Top));
        assert_eq!(snap(720.0, BOTTOM - 10.0), Some(Fill::Bottom));
    }

    #[test]
    fn each_of_the_four_corners_snaps_to_its_quarter() {
        assert_eq!(snap(2.0, 2.0), Some(Fill::TopLeft));
        assert_eq!(snap(RIGHT - 2.0, 2.0), Some(Fill::TopRight));
        assert_eq!(snap(2.0, BOTTOM - 2.0), Some(Fill::BottomLeft));
        assert_eq!(snap(RIGHT - 2.0, BOTTOM - 2.0), Some(Fill::BottomRight));
    }

    #[test]
    fn an_edges_last_stretch_before_a_corner_is_the_corners_from_either_edge() {
        // Down the left edge: within CORNER of the top or the bottom.
        assert_eq!(snap(10.0, CORNER), Some(Fill::TopLeft));
        assert_eq!(snap(10.0, CORNER + 1.0), Some(Fill::Left));
        assert_eq!(snap(10.0, BOTTOM - CORNER), Some(Fill::BottomLeft));
        // Along the top and the bottom: within CORNER of the left or the right.
        assert_eq!(snap(RIGHT - CORNER, 4.0), Some(Fill::TopRight));
        assert_eq!(snap(RIGHT - CORNER - 1.0, 4.0), Some(Fill::Top));
        assert_eq!(snap(CORNER, BOTTOM - 10.0), Some(Fill::BottomLeft));
        assert_eq!(snap(RIGHT - 10.0, BOTTOM - CORNER), Some(Fill::BottomRight));
    }

    #[test]
    fn a_small_apps_corners_take_a_quarter_of_an_edge_at_most() {
        let small = Rect::new(0.0, 0.0, 400.0, 300.0);
        assert_eq!(snap_for(at(5.0, 75.0), small), Some(Fill::TopLeft));
        assert_eq!(snap_for(at(5.0, 76.0), small), Some(Fill::Left));
    }

    #[test]
    fn the_pointer_has_to_reach_an_edges_band_24_px_at_the_sides_and_the_bottom_8_at_the_top() {
        assert_eq!(SNAP, 24.0);
        assert_eq!(SNAP_TOP, 8.0);
        assert_eq!(snap(SNAP, 450.0), Some(Fill::Left));
        assert_eq!(snap(SNAP + 1.0, 450.0), None);
        assert_eq!(snap(RIGHT - SNAP - 1.0, 450.0), None);
        assert_eq!(snap(720.0, BOTTOM - SNAP), Some(Fill::Bottom));
        assert_eq!(snap(720.0, BOTTOM - SNAP - 1.0), None);
        // A window moved up under the bars, not at them, keeps its place.
        assert_eq!(snap(720.0, SNAP_TOP), Some(Fill::Top));
        assert_eq!(snap(720.0, 20.0), None);
    }

    #[test]
    fn a_pointer_past_the_edge_outside_a_windowed_app_is_at_the_edge() {
        assert_eq!(snap(-40.0, 450.0), Some(Fill::Left));
        assert_eq!(snap(720.0, -12.0), Some(Fill::Top));
        assert_eq!(snap(RIGHT + 30.0, BOTTOM + 30.0), Some(Fill::BottomRight));
    }

    #[test]
    fn elsewhere_it_stays_where_it_was_dropped() {
        assert_eq!(snap(700.0, 400.0), None);
        assert_eq!(snap(100.0, 100.0), None);
    }
}

mod aim_snap {
    use super::*;

    #[test]
    fn a_drag_from_inside_the_app_aims_at_the_zone_the_pointer_is_in() {
        let mut aim = Aim::new(at(700.0, 400.0), AREA);
        assert_eq!(aim.at(at(600.0, 400.0)), None);
        assert_eq!(aim.at(at(4.0, 400.0)), Some(Fill::Left));
        assert_eq!(aim.at(at(4.0, 4.0)), Some(Fill::TopLeft));
        assert_eq!(aim.at(at(300.0, 400.0)), None);
    }

    #[test]
    fn one_that_starts_in_a_zone_aims_at_nothing_until_the_pointer_has_left_every_zone() {
        // A title bar grabbed on a window sitting at the top, dragged along it and into the corner.
        let mut aim = Aim::new(at(700.0, 5.0), AREA);
        assert_eq!(aim.at(at(600.0, 6.0)), None);
        assert_eq!(aim.at(at(3.0, 3.0)), None);
        assert_eq!(aim.at(at(300.0, 300.0)), None);
        assert_eq!(aim.at(at(720.0, 2.0)), Some(Fill::Top));
    }

    #[test]
    fn follows_the_apps_size_as_it_is_now() {
        let mut aim = Aim::new(at(500.0, 400.0), AREA);
        assert_eq!(
            aim.at_in(at(1000.0, 400.0), Rect::new(0.0, 0.0, 1010.0, 800.0)),
            Some(Fill::Right)
        );
    }
}

mod fill_rects {
    use super::*;

    #[test]
    fn halves_share_the_width_with_a_gap_between_them() {
        let h = halves(AREA);
        assert_eq!(h.left.x, AREA.x);
        assert_eq!(h.right.x + h.right.w, AREA.x + AREA.w);
        assert!(h.left.x + h.left.w < h.right.x);
        assert_eq!(h.left.h, AREA.h);
    }

    #[test]
    fn rows_share_the_height_the_bottom_one_a_gap_below_the_top_one_one_height() {
        let r = rows(AREA);
        assert_eq!(r.top, Rect::new(0.0, 0.0, 1440.0, 444.0));
        assert_eq!(r.bottom, Rect::new(0.0, 456.0, 1440.0, 444.0));
    }

    #[test]
    fn a_fill_is_the_whole_area_one_of_its_halves_or_one_of_its_quarters() {
        let free = Rect::new(104.0, 190.0, 1232.0, 622.0);
        let cases = [
            (Fill::Full, free),
            (Fill::Left, Rect::new(104.0, 190.0, 610.0, 622.0)),
            (Fill::Right, Rect::new(726.0, 190.0, 610.0, 622.0)),
            (Fill::Top, Rect::new(104.0, 190.0, 1232.0, 305.0)),
            (Fill::Bottom, Rect::new(104.0, 507.0, 1232.0, 305.0)),
            (Fill::TopLeft, Rect::new(104.0, 190.0, 610.0, 305.0)),
            (Fill::TopRight, Rect::new(726.0, 190.0, 610.0, 305.0)),
            (Fill::BottomLeft, Rect::new(104.0, 507.0, 610.0, 305.0)),
            (Fill::BottomRight, Rect::new(726.0, 507.0, 610.0, 305.0)),
        ];
        for (fill, rect) in cases {
            assert_eq!(fill_rect(fill, free), rect, "{fill:?}");
        }
    }
}

mod settle {
    use super::*;

    #[test]
    fn glides_a_window_to_its_next_place_until_its_size_has_arrived() {
        let mut settle = Settle::new(SettleKind::Place);
        assert!(settle.gliding());
        // Its left arriving is not the end: the width and height still move.
        settle.transition_end(Glided::Left);
        assert!(settle.gliding());
        settle.transition_end(Glided::Width);
        assert!(!settle.gliding());
    }

    #[test]
    fn stops_gliding_on_its_own_when_no_transition_ends_reduced_motion_nothing_moved() {
        let mut settle = Settle::new(SettleKind::Size);
        assert_eq!(settle.kind(), SettleKind::Size);
        assert!(settle.gliding());
        settle.advance(399.0);
        assert!(settle.gliding());
        settle.advance(1.0);
        assert!(!settle.gliding());
    }
}
