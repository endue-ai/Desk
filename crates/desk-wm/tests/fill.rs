//! Ported from `packages/runtime/src/shell/windows.test.ts`, its "maximize" and "snapping to halves
//! and quarters" cases: a snapped window floats and comes back to its size (ADR 0128), and a fill
//! takes the whole app (ADR 0132). The TS cases edit the shell's store (`openSurface`, `snapTo`,
//! `toggleMaximize`, `toggleFloating`); here the same steps are the placement's own functions, from
//! the calendar's default place. Also its case of a floating window under a pan; the rest of that
//! file (slots, closing, new windows, desktops) is #79's.

use desk_wm::{
    Fill, Offset, Placement, Rect, Restore, fill_with, screen_rect, toggle_floating,
    toggle_maximize, unfilled, unfilled_at,
};

/// What a filled window takes at 1440×900: the whole app, the bars floating above it as they do
/// above every window. Halves and quarters keep a 12 px gap between them.
const APP: Rect = Rect::new(0.0, 0.0, 1440.0, 900.0);
const HALF_W: f64 = 714.0;
const HALF_H: f64 = 444.0;
const ORIGIN: Offset = Offset::new(0.0, 0.0);

/// `openSurface(c, "calendar")`: its default place, in sight of the canvas at `pan`.
fn calendar_at(pan: Offset) -> Placement {
    Placement::new(
        "calendar",
        "endue.calendar",
        Rect::new(120.0 - pan.x, 240.0 - pan.y, 560.0, 400.0),
    )
}

fn calendar() -> Placement {
    calendar_at(ORIGIN)
}

mod maximize {
    use super::*;

    #[test]
    fn fills_the_whole_app_and_keeps_the_place_to_restore_a_second_call_restores_it() {
        let before = calendar();
        let full = toggle_maximize(&before);
        assert_eq!(full.rect(), APP);
        assert_eq!(full.fill, Some(Fill::Full));
        assert_eq!(full.restore.map(|r| r.rect()), Some(before.rect()));
        let back = toggle_maximize(&full);
        assert_eq!(back.rect(), before.rect());
        assert_eq!(back.restore, None);
        assert_eq!(back.fill, None);
    }

    #[test]
    fn a_half_snapped_window_fills_its_half_of_the_app_maximized_from_there_it_comes_back_to_the_half()
     {
        let before = calendar();
        let half = fill_with(&before, Fill::Left);
        assert_eq!(half.rect(), Rect::new(0.0, 0.0, HALF_W, APP.h));
        assert_eq!(half.fill, Some(Fill::Left));
        let right = fill_with(&half, Fill::Right);
        assert_eq!(right.rect(), Rect::new(APP.w - HALF_W, 0.0, HALF_W, APP.h));
        assert_eq!(right.fill, Some(Fill::Right));
        let left = fill_with(&right, Fill::Left);
        let full = toggle_maximize(&left);
        assert_eq!((full.rect(), full.fill), (APP, Some(Fill::Full)));
        let again = toggle_maximize(&full);
        assert_eq!(again.rect(), Rect::new(0.0, 0.0, HALF_W, APP.h));
        assert_eq!(again.fill, Some(Fill::Left));
        // Its own place is still the one a drag out of the half comes back to.
        let own = before.rect();
        assert_eq!(
            again.restore,
            Some(Restore {
                x: own.x,
                y: own.y,
                w: own.w,
                h: own.h,
                floating: Some(false),
                fill: None,
            })
        );
        assert_eq!(unfilled(&again).rect(), own);
        assert_eq!(unfilled(&again).fill, None);
    }

    #[test]
    fn filling_the_whole_app_by_a_snap_can_be_restored_like_a_maximize() {
        let before = calendar();
        let full = fill_with(&before, Fill::Full);
        assert_eq!((full.rect(), full.fill), (APP, Some(Fill::Full)));
        let back = toggle_maximize(&full);
        assert_eq!((back.x, back.w), (before.x, before.w));
    }

    #[test]
    fn fills_the_same_place_on_screen_at_any_pan_and_a_floating_window_at_any_app_size() {
        let pan = Offset::new(-100.0, -50.0);
        let normal = toggle_maximize(&calendar_at(pan));
        assert_eq!(screen_rect(&normal, pan, 1440.0, 900.0), APP);
        let floating = toggle_floating(&toggle_maximize(&normal), pan, 1440.0, 900.0);
        let floating = toggle_maximize(&floating);
        assert_eq!(screen_rect(&floating, pan, 1440.0, 900.0), APP);
        assert_eq!(
            screen_rect(&floating, pan, 1280.0, 800.0),
            Rect::new(0.0, 0.0, 1280.0, 800.0)
        );
    }

    #[test]
    fn takes_the_whole_app_wherever_eris_sits_under_the_bars_as_every_window_is() {
        // Eris's place is no input of a fill: the same calls give the same parts wherever she sits.
        let full = toggle_maximize(&calendar());
        assert_eq!((full.rect(), full.fill), (APP, Some(Fill::Full)));
        let right = fill_with(&full, Fill::Right);
        assert_eq!(right.rect(), Rect::new(726.0, 0.0, HALF_W, 900.0));
    }

    #[test]
    fn a_fill_kept_from_when_fills_stayed_between_the_bars_draws_over_the_whole_app() {
        let old = Placement::new("a", "p", Rect::new(104.0, 507.0, 1232.0, 305.0));
        for (fill, rect) in [
            (Fill::Full, APP),
            (Fill::Bottom, Rect::new(0.0, 456.0, 1440.0, HALF_H)),
        ] {
            let p = Placement {
                floating: Some(true),
                fill: Some(fill),
                ..old.clone()
            };
            assert_eq!(screen_rect(&p, ORIGIN, 1440.0, 900.0), rect, "{fill:?}");
        }
    }
}

mod snapping_to_halves_and_quarters {
    use super::*;

    const TOP: Rect = Rect::new(0.0, 0.0, APP.w, HALF_H);

    /// `${fill} takes its part of the whole app, at any app size`
    fn takes_its_part_of_the_whole_app_at_any_app_size(fill: Fill, rect: Rect) {
        let p = fill_with(&calendar(), fill);
        assert_eq!(p.rect(), rect);
        assert_eq!((p.fill, p.floating), (Some(fill), Some(true)));
        assert_eq!(screen_rect(&p, ORIGIN, 1440.0, 900.0), rect);
        // A taller and wider app: the part grows with it.
        let big = screen_rect(&p, ORIGIN, 2000.0, 1200.0);
        assert_eq!(big.y, if fill.is_bottom() { 594.0 + 12.0 } else { 0.0 });
        assert_eq!(big.h, 594.0);
        assert_eq!(big.w, if fill.is_quarter() { 994.0 } else { 2000.0 });
    }

    #[test]
    fn top_takes_its_part_of_the_whole_app_at_any_app_size() {
        takes_its_part_of_the_whole_app_at_any_app_size(Fill::Top, TOP);
    }

    #[test]
    fn bottom_takes_its_part_of_the_whole_app_at_any_app_size() {
        let rect = Rect { y: 456.0, ..TOP };
        takes_its_part_of_the_whole_app_at_any_app_size(Fill::Bottom, rect);
    }

    #[test]
    fn top_left_takes_its_part_of_the_whole_app_at_any_app_size() {
        let rect = Rect::new(0.0, 0.0, HALF_W, HALF_H);
        takes_its_part_of_the_whole_app_at_any_app_size(Fill::TopLeft, rect);
    }

    #[test]
    fn top_right_takes_its_part_of_the_whole_app_at_any_app_size() {
        let rect = Rect::new(726.0, 0.0, HALF_W, HALF_H);
        takes_its_part_of_the_whole_app_at_any_app_size(Fill::TopRight, rect);
    }

    #[test]
    fn bottom_left_takes_its_part_of_the_whole_app_at_any_app_size() {
        let rect = Rect::new(0.0, 456.0, HALF_W, HALF_H);
        takes_its_part_of_the_whole_app_at_any_app_size(Fill::BottomLeft, rect);
    }

    #[test]
    fn bottom_right_takes_its_part_of_the_whole_app_at_any_app_size() {
        let rect = Rect::new(726.0, 456.0, HALF_W, HALF_H);
        takes_its_part_of_the_whole_app_at_any_app_size(Fill::BottomRight, rect);
    }

    #[test]
    fn a_snapped_normal_window_floats_so_a_pan_leaves_it_where_it_was_snapped() {
        let before = calendar();
        assert_ne!(before.floating, Some(true));
        let p = fill_with(&before, Fill::TopLeft);
        assert_eq!(p.floating, Some(true));
        let part = Rect::new(0.0, 0.0, HALF_W, HALF_H);
        assert_eq!(
            screen_rect(&p, Offset::new(-400.0, 250.0), 1440.0, 900.0),
            part
        );
        assert_eq!(screen_rect(&p, ORIGIN, 1440.0, 900.0), part);
    }

    #[test]
    fn keeps_the_place_and_the_mode_to_come_back_to_through_every_later_snap() {
        let before = calendar();
        let p = fill_with(&before, Fill::Bottom);
        let p = fill_with(&p, Fill::TopRight);
        let p = fill_with(&p, Fill::Left);
        let own = before.rect();
        assert_eq!(
            p.restore,
            Some(Restore {
                x: own.x,
                y: own.y,
                w: own.w,
                h: own.h,
                floating: Some(false),
                fill: None,
            })
        );
    }

    #[test]
    fn out_of_its_fill_a_window_is_back_at_its_place_in_the_mode_it_had_a_floating_one_stays_floating()
     {
        let before = calendar();
        let snapped = fill_with(&before, Fill::Right);
        let back = unfilled(&snapped);
        assert_eq!(back.rect(), before.rect());
        assert_eq!(back.floating, None);
        assert_eq!(back.fill, None);
        assert_eq!(back.restore, None);
        // Dropped elsewhere, it takes the drop's place in that mode.
        let dropped = unfilled_at(&snapped, Rect::new(9.0, 8.0, 300.0, 200.0));
        assert_eq!((dropped.x, dropped.w), (9.0, 300.0));
        // The title bar's Floating button takes it out of the snap as a normal window; again, it
        // floats.
        let normal = toggle_floating(&snapped, ORIGIN, 1440.0, 900.0);
        assert_eq!(normal.floating, Some(false));
        assert_eq!(normal.fill, None);
        let floating = toggle_floating(&normal, ORIGIN, 1440.0, 900.0);
        let floating = fill_with(&floating, Fill::BottomLeft);
        assert_eq!(unfilled(&floating).floating, Some(true));
    }

    #[test]
    fn a_window_maximized_before_snaps_floated_keeps_its_own_mode_when_it_comes_back() {
        let old = Placement {
            fill: Some(Fill::Full),
            restore: Some(Restore {
                x: 400.0,
                y: 300.0,
                w: 480.0,
                h: 320.0,
                floating: None,
                fill: None,
            }),
            ..Placement::new("calendar", "endue.calendar", APP)
        };
        let back = toggle_maximize(&old);
        assert_eq!(back.rect(), Rect::new(400.0, 300.0, 480.0, 320.0));
        assert_eq!(back.floating, None);
    }
}

mod normal_and_floating_windows {
    use super::*;

    #[test]
    fn a_floating_window_stays_where_it_is_on_screen_whatever_the_pan() {
        // `newWindow`'s first place, in normal mode at no pan; made floating there.
        let opened = Placement::new(
            "window-1",
            "endue.window",
            Rect::new(480.0, 240.0, 480.0, 320.0),
        );
        let p = toggle_floating(&opened, ORIGIN, 1440.0, 900.0);
        let before = screen_rect(&p, ORIGIN, 1440.0, 900.0);
        assert_eq!(before, opened.rect());
        let pan = Offset::new(-500.0, -300.0);
        assert_eq!(screen_rect(&p, pan, 1440.0, 900.0), before);
    }
}

mod saved_layouts {
    use super::*;

    #[test]
    fn a_snapped_window_reads_and_writes_the_runtimes_json() {
        let p = fill_with(&calendar(), Fill::TopRight);
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": "calendar", "plugin": "endue.calendar",
                "x": 726.0, "y": 0.0, "w": 714.0, "h": 444.0, "pinned": false,
                "floating": true, "fill": "top-right",
                "restore": { "x": 120.0, "y": 240.0, "w": 560.0, "h": 400.0, "floating": false }
            })
        );
        let back: Placement = serde_json::from_value(json).unwrap();
        assert_eq!(back, p);
    }
}
