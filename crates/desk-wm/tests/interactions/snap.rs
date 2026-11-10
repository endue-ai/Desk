//! Snapping (ADR 0128) and what glides (ADR 0132) on the compositor's input: each of the eight
//! parts, the intent rule, coming out of a snap, the preview growing out of the window and
//! gliding from part to part, the window gliding into its part, reduced motion and the theme's
//! motion.

use desk_wm::interact::{Motion, Op};
use desk_wm::{Fill, Rect, snap_rect};

use super::support::*;

mod snapping {
    use super::*;

    #[test]
    fn dragged_to_each_edge_and_corner_a_window_snaps_there_floating() {
        for part in PARTS {
            let desk = windows(1);
            let mut wm = wm_of(&desk);
            let from = title_of(rect_of(&wm, "window-1"));
            let out = drag(&mut wm, moving("window-1"), from, aim(part));
            let p = wm.desk().window("window-1").unwrap();
            assert_eq!((p.fill, p.floating), (Some(part), Some(true)), "{part:?}");
            assert_eq!(rect_of(&wm, "window-1"), snap_rect(part, W, H), "{part:?}");
            assert_eq!(published(&out)[0].windows[0].fill, Some(part));
        }
    }

    #[test]
    fn dropped_short_of_an_edge_a_window_stays_where_it_was_dropped() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        drag(&mut wm, moving("window-1"), from, pt(60.0, 450.0));
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.fill, p.floating), (None, None));
        assert_eq!((p.x, p.y), (win.x + 60.0 - from.x, win.y + 450.0 - from.y));
    }

    #[test]
    fn a_drag_that_starts_in_a_zone_aims_at_nothing_until_it_left_every_zone() {
        let mut desk = windows(1);
        desk.place("window-1", Rect::new(400.0, -15.0, 480.0, 320.0));
        let mut wm = wm_of(&desk);
        // Grabbed 5 px from the app's top, dragged along it: no snap, no preview.
        let from = pt(480.0, 5.0);
        hold(&mut wm, moving("window-1"), from, pt(640.0, 4.0), 4);
        assert_eq!(wm.frame(0.0).preview, None);
        wm.released(pt(640.0, 4.0), 0.0);
        assert_eq!(wm.desk().window("window-1").unwrap().fill, None);
        // Down into the desk and back up to the top: now it aims at the top half.
        let from = pt(640.0, 5.0);
        let mut out = hold(&mut wm, moving("window-1"), from, pt(640.0, 300.0), 4);
        out.extend(wm.moved(pt(640.0, 2.0), 0.0));
        assert_eq!(
            wm.frame(0.0).preview.map(|(r, _)| r),
            Some(snap_rect(Fill::Top, W, H))
        );
        wm.released(pt(640.0, 2.0), 0.0);
        assert_eq!(wm.desk().window("window-1").unwrap().fill, Some(Fill::Top));
    }

    #[test]
    fn dragged_out_of_its_snap_a_window_takes_back_its_size_and_mode_under_the_pointer() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        drag(&mut wm, moving("window-1"), title_of(win), pt(3.0, 3.0));
        taken(&mut wm);
        let snapped = rect_of(&wm, "window-1");
        assert_eq!(snapped, snap_rect(Fill::TopLeft, W, H));
        let drop = pt(700.0, 500.0);
        drag(&mut wm, moving("window-1"), title_of(snapped), drop);
        let back = rect_of(&wm, "window-1");
        assert_eq!((back.w, back.h), (win.w, win.h));
        assert!(back.x < drop.x && back.right() > drop.x);
        assert!(back.y < drop.y && back.y + 40.0 > drop.y);
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.fill, p.restore, p.floating), (None, None, None));
    }

    #[test]
    fn escape_while_it_aims_leaves_the_window_where_it_was_and_the_preview_goes() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        hold(
            &mut wm,
            moving("window-1"),
            title_of(win),
            aim(Fill::Left),
            6,
        );
        assert!(wm.frame(0.0).preview.is_some());
        wm.escape();
        assert_eq!(wm.frame(0.0).preview, None);
        assert_eq!(rect_of(&wm, "window-1"), win);
        assert_eq!(wm.desk().window("window-1").unwrap().fill, None);
    }
}

mod the_preview_and_the_glide {
    use super::*;

    #[test]
    fn the_preview_grows_out_of_the_window_and_the_window_glides_into_its_part() {
        let desk = windows(1);
        let motion = Motion::default();
        let mut wm = wm_over(&desk, motion);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        let to = aim(Fill::Left);
        wm.pressed(from);
        wm.grab(moving("window-1"), from, 0.0);
        wm.moved(to, 1000.0);
        let held = wm.drawn_rect("window-1", 1000.0).unwrap();
        let part = snap_rect(Fill::Left, W, H);
        // Shown where the window is, then moving to the half: a glide, not a jump.
        assert_eq!(wm.frame(1000.0).preview, Some((held, "window-1".into())));
        let half = wm.frame(1000.0 + motion.base / 2.0);
        let (mid, under) = half.preview.unwrap();
        assert!(mid != held && mid != part && under == "window-1" && half.moving);
        assert_eq!(wm.frame(1000.0 + motion.base).preview.unwrap().0, part);
        wm.released(to, 2000.0);
        let start = wm.frame(2000.0);
        assert_eq!(start.drawn.get("window-1"), Some(&held));
        assert!(start.moving && start.preview.is_none());
        let end = wm.frame(2000.0 + motion.base);
        assert!(end.drawn.is_empty() && !end.moving);
        assert_eq!(rect_of(&wm, "window-1"), part);
    }

    #[test]
    fn the_preview_follows_the_pointer_from_zone_to_zone_and_goes_where_nothing_is_aimed_at() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let from = title_of(rect_of(&wm, "window-1"));
        let mut seen = Vec::new();
        wm.pressed(from);
        wm.grab(moving("window-1"), from, 0.0);
        for at in [
            aim(Fill::Left),
            pt(3.0, 60.0),
            pt(792.0, 337.0),
            pt(W - 3.0, H - 3.0),
        ] {
            wm.moved(at, 0.0);
            seen.push(wm.frame(0.0).preview.map(|(r, _)| r));
        }
        let parts = [Fill::Left, Fill::TopLeft].map(|f| Some(snap_rect(f, W, H)));
        assert_eq!(
            seen,
            [
                parts[0],
                parts[1],
                None,
                Some(snap_rect(Fill::BottomRight, W, H))
            ]
        );
    }

    #[test]
    fn a_window_whose_fill_changes_glides_and_reduced_motion_moves_it_at_once() {
        let desk = windows(1);
        let mut wm = wm_over(&desk, Motion::default());
        let win = rect_of(&wm, "window-1");
        wm.frame(0.0);
        let out = wm.run(&Op::Maximize, None);
        assert_eq!(published(&out)[0].windows[0].fill, Some(Fill::Full));
        let start = wm.frame(100.0);
        assert_eq!(start.drawn.get("window-1"), Some(&win));
        assert!(start.moving);
        assert!(wm.frame(100.0 + Motion::default().base).drawn.is_empty());
        // Reduced motion: no glide at all.
        let mut wm = wm_over(&desk, Motion::from_tokens(|_| None, true));
        wm.frame(0.0);
        wm.run(&Op::Maximize, None);
        let now = wm.frame(1.0);
        assert!(now.drawn.is_empty() && !now.moving);
    }

    #[test]
    fn a_filled_window_dragged_away_follows_the_pointer_at_once_and_glides_only_its_size() {
        let mut desk = windows(1);
        desk.snap_to("window-1", Fill::Left);
        let motion = Motion::default();
        let mut wm = wm_over(&desk, motion);
        let filled = rect_of(&wm, "window-1");
        let from = title_of(filled);
        wm.pressed(from);
        wm.grab(moving("window-1"), from, 0.0);
        wm.moved(pt(from.x + 200.0, from.y + 100.0), 0.0);
        let at_once = wm.drawn_rect("window-1", 0.0).unwrap();
        assert_eq!(
            (at_once.w, at_once.h),
            (filled.w, filled.h),
            "its size has not moved yet"
        );
        let later = wm.drawn_rect("window-1", motion.fast).unwrap();
        assert_eq!((later.w, later.h), (480.0, 320.0));
        assert_eq!(
            (later.x, later.y),
            (at_once.x, at_once.y),
            "the place never lags"
        );
    }

    #[test]
    fn the_desks_motion_comes_from_its_tokens() {
        let token = |name: &str| match name {
            "motionBase" => Some("320ms".to_owned()),
            "motionFast" => Some("0.2s".to_owned()),
            "easing" => Some("cubic-bezier(0.4, 0, 0.2, 1)".to_owned()),
            _ => None,
        };
        let m = Motion::from_tokens(token, false);
        assert_eq!((m.base, m.fast), (320.0, 200.0));
        assert_eq!(m.easing, desk_wm::interact::Easing::new(0.4, 0.0, 0.2, 1.0));
        assert!((m.easing.at(0.5) - 0.5).abs() < 0.5);
        assert_eq!((m.easing.at(0.0), m.easing.at(1.0)), (0.0, 1.0));
        let reduced = Motion::from_tokens(token, true);
        assert_eq!((reduced.base, reduced.fast), (0.0, 0.0));
    }
}
