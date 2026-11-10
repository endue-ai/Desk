//! Ported from `packages/runtime/src/surface/geometry.test.ts` and `coordinates.test.ts`, case by
//! case; the title clearance (`surface/clearance.ts`) had no unit test and gains one here.

use desk_wm::{
    Fill, MIN, Offset, Placement, Rect, TopChrome, clamp_rect, from_screen, is_floating,
    screen_rect, stored_rect, title_clearance, to_screen,
};

mod geometry {
    use super::*;

    #[test]
    fn at_1440x900_the_reference_frame_is_the_screen() {
        assert_eq!(
            to_screen(Rect::new(120.0, 240.0, 560.0, 400.0), 1440.0, 900.0),
            Rect::new(120.0, 240.0, 560.0, 400.0)
        );
    }

    #[test]
    fn at_1024_wide_surfaces_shrink_and_stay_on_the_screen() {
        let r = to_screen(Rect::new(1000.0, 220.0, 320.0, 360.0), 1024.0, 768.0);
        assert!(r.w < 320.0);
        assert!(r.x >= 0.0);
        assert!(r.x + r.w <= 1024.0);
        assert!(r.y + r.h <= 768.0);
    }

    #[test]
    fn a_shorter_app_shrinks_windows_heights_only_a_narrower_one_their_widths_only() {
        let reference = Rect::new(400.0, 240.0, 640.0, 480.0);
        let shorter = to_screen(reference, 1440.0, 700.0);
        assert_eq!(shorter.w, 640.0);
        assert!(shorter.h < 480.0);
        let narrower = to_screen(reference, 1100.0, 900.0);
        assert_eq!(narrower.h, 480.0);
        assert!(narrower.w < 640.0);
        // And a window resized there keeps its other side when the app grows back.
        let back = to_screen(from_screen(shorter, 1440.0, 700.0), 1440.0, 900.0);
        assert_eq!((back.w, back.h), (640.0, 480.0));
    }

    #[test]
    fn screen_and_reference_positions_round_trip() {
        let reference = Rect::new(300.0, 300.0, 400.0, 300.0);
        let back = from_screen(to_screen(reference, 1280.0, 800.0), 1280.0, 800.0);
        assert!((back.x - reference.x).abs() <= 1.0);
        assert!((back.w - reference.w).abs() <= 2.0);
    }

    #[test]
    fn a_dragged_rect_stays_on_the_screen_and_keeps_its_minimum_size() {
        assert_eq!(
            clamp_rect(Rect::new(-50.0, 2000.0, 10.0, 10.0), 1440.0, 900.0),
            Rect::new(0.0, 900.0 - MIN.h, MIN.w, MIN.h)
        );
    }

    #[test]
    fn a_window_can_grow_to_the_whole_screen_under_the_bars_and_no_further() {
        let screen = Rect::new(0.0, 0.0, 1440.0, 900.0);
        assert_eq!(clamp_rect(screen, 1440.0, 900.0), screen);
        assert_eq!(
            clamp_rect(Rect::new(-10.0, -10.0, 2000.0, 1200.0), 1440.0, 900.0),
            screen
        );
    }

    #[test]
    fn a_window_resized_on_a_small_screen_still_fits_when_the_screen_grows() {
        let saved = from_screen(Rect::new(104.0, 72.0, 800.0, 608.0), 1024.0, 768.0);
        let shown = to_screen(saved, 1440.0, 900.0);
        assert!(shown.x + shown.w <= 1440.0);
        assert!(shown.y + shown.h <= 900.0);
    }
}

mod window_coordinate_systems {
    use super::*;

    fn placement() -> Placement {
        let mut p = Placement::new("notes", "notes", Rect::new(400.0, 240.0, 400.0, 280.0));
        p.floating = Some(true);
        p
    }

    #[test]
    fn puts_a_window_in_normal_mode_unless_it_says_floating() {
        let saved = Placement {
            floating: None,
            ..placement()
        };
        assert!(!is_floating(&saved));
        assert!(!is_floating(&Placement {
            floating: Some(false),
            ..saved.clone()
        }));
        assert!(is_floating(&placement()));
        // A normal window moves with the pan.
        let r = screen_rect(&saved, Offset::new(300.0, -200.0), 1440.0, 900.0);
        assert_eq!((r.x, r.y), (700.0, 40.0));
    }

    #[test]
    fn keeps_floating_windows_independent_of_pan_and_responsive_to_app_size() {
        let p = placement();
        let full = screen_rect(&p, Offset::new(0.0, 0.0), 1440.0, 900.0);
        assert_eq!(
            screen_rect(&p, Offset::new(300.0, -200.0), 1440.0, 900.0),
            full
        );
        let smaller = screen_rect(&p, Offset::new(300.0, -200.0), 1024.0, 768.0);
        assert!(smaller.x < full.x);
        assert!(smaller.w < full.w);
    }

    #[test]
    fn keeps_canvas_world_size_and_coordinates_unchanged_on_viewport_resize() {
        let p = Placement {
            floating: Some(false),
            ..placement()
        };
        let pan = Offset::new(-800.0, 200.0);
        let rect = screen_rect(&p, pan, 1440.0, 900.0);
        assert_eq!(rect, Rect::new(-400.0, 440.0, 400.0, 280.0));
        assert_eq!(screen_rect(&p, pan, 1024.0, 768.0), rect);
        assert_eq!(stored_rect(rect, false, pan, 1024.0, 768.0), p.rect());
    }

    #[test]
    fn converts_between_modes_at_the_current_screen_location_including_a_panned_canvas() {
        let p = placement();
        let pan = Offset::new(120.0, -80.0);
        let rect = screen_rect(&p, pan, 1440.0, 900.0);
        let mut canvas = Placement {
            floating: Some(false),
            ..p.clone()
        };
        canvas.set_rect(stored_rect(rect, false, pan, 1440.0, 900.0));
        assert_eq!(screen_rect(&canvas, pan, 1440.0, 900.0), rect);
        assert_eq!(stored_rect(rect, true, pan, 1440.0, 900.0), p.rect());
    }

    #[test]
    fn fills_the_whole_app_or_a_half_of_it_at_any_app_size_wherever_its_stored_rect_says_adr_0132()
    {
        let origin = Offset::new(0.0, 0.0);
        let full = Placement {
            y: 72.0,
            fill: Some(Fill::Full),
            ..placement()
        };
        assert_eq!(
            screen_rect(&full, origin, 1440.0, 900.0),
            Rect::new(0.0, 0.0, 1440.0, 900.0)
        );
        assert_eq!(
            screen_rect(&full, origin, 2560.0, 1440.0),
            Rect::new(0.0, 0.0, 2560.0, 1440.0)
        );
        // Filled under Eris's place when fills stayed between the bars: the whole app now.
        let under_eris = Placement {
            y: 190.0,
            fill: Some(Fill::Full),
            ..placement()
        };
        assert_eq!(
            screen_rect(&under_eris, origin, 1280.0, 800.0),
            Rect::new(0.0, 0.0, 1280.0, 800.0)
        );
        let right = Placement {
            y: 72.0,
            fill: Some(Fill::Right),
            ..placement()
        };
        assert_eq!(
            screen_rect(&right, origin, 2000.0, 1000.0),
            Rect::new(1006.0, 0.0, 994.0, 1000.0)
        );
        // A normal window keeps the world rect it was filled to, so it moves with the pan.
        let canvas = Placement {
            floating: Some(false),
            fill: Some(Fill::Full),
            ..placement()
        };
        assert_eq!(
            screen_rect(&canvas, origin, 1440.0, 900.0),
            Rect::new(400.0, 240.0, 400.0, 280.0)
        );
    }
}

mod title_clearance {
    use super::*;

    /// The profile switcher ends at 311.6 px and the desktops start at 1180.2 px in a 1440 app.
    fn chrome() -> TopChrome {
        TopChrome::measure(1440.0, Some(311.6), Some(1180.2))
    }

    #[test]
    fn measures_the_top_chips_a_gap_beyond_their_edges() {
        assert_eq!(
            chrome(),
            TopChrome {
                left: Some(324.0),
                right: Some(272.0)
            }
        );
        assert_eq!(TopChrome::measure(1440.0, None, None), TopChrome::default());
    }

    #[test]
    fn a_window_filling_the_app_or_its_top_keeps_its_title_clear_of_both_sides() {
        for fill in [Fill::Full, Fill::Top] {
            let c = title_clearance(Some(fill), chrome());
            assert_eq!((c.left, c.right), (Some(324.0), Some(272.0)), "{fill:?}");
        }
    }

    #[test]
    fn a_left_or_right_part_clears_its_own_side_only_and_a_bottom_part_neither() {
        for fill in [Fill::Left, Fill::TopLeft] {
            let c = title_clearance(Some(fill), chrome());
            assert_eq!((c.left, c.right), (Some(324.0), None), "{fill:?}");
        }
        for fill in [Fill::Right, Fill::TopRight] {
            let c = title_clearance(Some(fill), chrome());
            assert_eq!((c.left, c.right), (None, Some(272.0)), "{fill:?}");
        }
        for fill in [
            None,
            Some(Fill::Bottom),
            Some(Fill::BottomLeft),
            Some(Fill::BottomRight),
        ] {
            let c = title_clearance(fill, chrome());
            assert_eq!((c.left, c.right), (None, None), "{fill:?}");
        }
    }
}
