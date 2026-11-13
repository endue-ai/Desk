//! Interactions on the compositor's input (#80): ported from `surface/resize.test.ts`,
//! `shell/drag.test.ts` and the gestures `surface/interactions.ts` and `shell/Pan.ts` run, as
//! `packages/runtime/e2e/shell-{interactions,snap,canvas}.spec.ts` check them on the DOM window
//! manager, case by case. The DOM cases read elements, classes and pointer events; here the same
//! rules run on the window manager the compositor drives (`desk_wm::interact::Wm`): a press, the
//! page's grab (what its DOM found under the press), the pointer's moves and the release, in app
//! pixels, and what it publishes, draws and holds. `interactions/wm.rs` has the seam to the
//! runtime and the window commands, `interactions/mid_glide.rs` a press on a window mid-glide.

mod common;
#[path = "interactions/cursor.rs"]
mod cursor;
#[path = "interactions/mid_glide.rs"]
mod mid_glide;
#[path = "interactions/panes.rs"]
mod panes;
#[path = "interactions/reach.rs"]
mod reach;
#[path = "interactions/snap.rs"]
mod snap;
#[path = "interactions/support.rs"]
mod support;
#[path = "interactions/whole_pixels.rs"]
mod whole_pixels;
#[path = "interactions/wm.rs"]
mod wm;

use desk_wm::interact::{DRAG_THRESHOLD, Drag, Grip, Kind, Step, grip_at, resize_rect};
use desk_wm::{MIN, Rect};
use support::*;

mod resize {
    use super::*;

    const START: Rect = Rect::new(300.0, 250.0, 400.0, 300.0);

    #[test]
    fn each_grip_changes_only_the_grabbed_edges() {
        let cases = [
            (Grip::Nw, Rect::new(260.0, 220.0, 440.0, 330.0)),
            (Grip::Ne, Rect::new(300.0, 220.0, 360.0, 330.0)),
            (Grip::Sw, Rect::new(260.0, 250.0, 440.0, 270.0)),
            (Grip::Se, Rect::new(300.0, 250.0, 360.0, 270.0)),
            (Grip::N, Rect::new(300.0, 220.0, 400.0, 330.0)),
            (Grip::E, Rect::new(300.0, 250.0, 360.0, 300.0)),
            (Grip::S, Rect::new(300.0, 250.0, 400.0, 270.0)),
            (Grip::W, Rect::new(260.0, 250.0, 440.0, 300.0)),
        ];
        for (grip, want) in cases {
            assert_eq!(
                resize_rect(START, grip, -40.0, -30.0, None),
                want,
                "{grip:?}"
            );
        }
    }

    #[test]
    fn shrinking_from_the_top_left_stops_at_the_minimum_without_moving_the_opposite_corner() {
        let r = resize_rect(START, Grip::Nw, 1000.0, 1000.0, None);
        assert_eq!(r, Rect::new(700.0 - MIN.w, 550.0 - MIN.h, MIN.w, MIN.h));
    }

    #[test]
    fn floating_edges_stop_at_the_viewport_canvas_edges_may_extend_beyond_it() {
        let bounds = Some(Rect::new(104.0, 72.0, 816.0, 608.0));
        let nw = resize_rect(START, Grip::Nw, -600.0, -600.0, bounds);
        assert_eq!(nw, Rect::new(104.0, 72.0, 596.0, 478.0));
        let se = resize_rect(START, Grip::Se, 1000.0, 1000.0, bounds);
        assert_eq!(se, Rect::new(300.0, 250.0, 620.0, 430.0));
        let free = resize_rect(START, Grip::Nw, -600.0, -600.0, None);
        assert_eq!(free, Rect::new(-300.0, -350.0, 1000.0, 900.0));
    }

    #[test]
    fn the_grips_lie_inside_the_border_six_px_along_the_edges_and_sixteen_in_the_corners() {
        let w = Rect::new(100.0, 100.0, 400.0, 300.0);
        // Where the windows specs grab them (e2e/support/gestures.ts `gripAt`).
        assert_eq!(grip_at(w, pt(104.0, 109.0)), Some(Grip::Nw));
        assert_eq!(grip_at(w, pt(300.0, 104.0)), Some(Grip::N));
        assert_eq!(grip_at(w, pt(491.0, 109.0)), Some(Grip::Ne));
        assert_eq!(grip_at(w, pt(496.0, 250.0)), Some(Grip::E));
        assert_eq!(grip_at(w, pt(491.0, 391.0)), Some(Grip::Se));
        assert_eq!(grip_at(w, pt(300.0, 396.0)), Some(Grip::S));
        assert_eq!(grip_at(w, pt(109.0, 391.0)), Some(Grip::Sw));
        assert_eq!(grip_at(w, pt(104.0, 250.0)), Some(Grip::W));
        // The border, the title bar's middle and the body are no grip.
        assert_eq!(grip_at(w, pt(100.5, 250.0)), None);
        assert_eq!(grip_at(w, pt(300.0, 120.0)), None);
        assert_eq!(grip_at(w, pt(300.0, 250.0)), None);
        assert_eq!(Grip::Se.cursor(), "nwse-resize");
        assert_eq!(Grip::Ne.cursor(), "nesw-resize");
        assert_eq!(Grip::N.cursor(), "ns-resize");
        assert_eq!(Grip::W.cursor(), "ew-resize");
    }

    #[test]
    fn resizes_from_each_grip_with_the_opposite_edges_anchored() {
        for grip in desk_wm::interact::GRIPS {
            let desk = windows(1);
            let mut wm = wm_of(&desk);
            let win = rect_of(&wm, "window-1");
            let at = grip.rect_in(win);
            let from = pt(at.x + at.w / 2.0, at.y + at.h / 2.0);
            let kind = Kind::Resize {
                window: "window-1".into(),
                grip,
            };
            drag(&mut wm, kind, from, pt(from.x - 40.0, from.y - 30.0));
            let w = if grip.west() {
                40.0
            } else if grip.east() {
                -40.0
            } else {
                0.0
            };
            let h = if grip.north() {
                30.0
            } else if grip.south() {
                -30.0
            } else {
                0.0
            };
            let x = win.x - if grip.west() { 40.0 } else { 0.0 };
            let y = win.y - if grip.north() { 30.0 } else { 0.0 };
            let want = Rect::new(x, y, win.w + w, win.h + h);
            assert_eq!(rect_of(&wm, "window-1"), want, "{grip:?}");
            let p = wm.desk().window("window-1").unwrap();
            assert_eq!((p.floating, p.fill), (None, None), "{grip:?} stays normal");
        }
    }
}

mod pointer_drags {
    use super::*;

    #[test]
    fn a_press_alone_starts_nothing_and_a_click_below_the_threshold_stays_a_click() {
        let mut d = Drag::new(pt(10.0, 20.0));
        assert_eq!(d.moved(pt(15.0, 20.0)), Step::Nothing);
        assert_eq!(d.moved(pt(10.0, 20.0 + DRAG_THRESHOLD)), Step::Nothing);
        assert_eq!(d.released(pt(15.0, 20.0)), None);
        // In the window manager: no window moves and nothing is published.
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        let out = drag(
            &mut wm,
            moving("window-1"),
            from,
            pt(from.x + 5.0, from.y + 5.0),
        );
        assert!(published(&out).is_empty());
        assert_eq!(rect_of(&wm, "window-1"), win);
    }

    #[test]
    fn a_press_becomes_a_drag_once_the_pointer_has_gone_past_8_px() {
        let mut d = Drag::new(pt(10.0, 20.0));
        assert_eq!(d.moved(pt(18.0, 20.0)), Step::Nothing);
        assert_eq!(d.moved(pt(30.0, 20.0)), Step::Started { dx: 20.0, dy: 0.0 });
        assert_eq!(d.moved(pt(40.0, 20.0)), Step::Moved { dx: 30.0, dy: 0.0 });
        assert_eq!(d.released(pt(40.0, 20.0)), Some((30.0, 0.0)));
    }

    #[test]
    fn ignores_a_grab_for_another_press_until_the_one_it_names() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        wm.pressed(from);
        // The page names a press elsewhere: nothing runs.
        assert!(
            wm.grab(moving("window-1"), pt(from.x + 60.0, from.y), 0.0)
                .is_empty()
        );
        wm.moved(pt(from.x + 30.0, from.y), 0.0);
        assert!(!wm.holds());
        assert_eq!(rect_of(&wm, "window-1"), win);
    }

    #[test]
    fn cancels_on_escape_the_focus_lost_or_the_window_gone_and_never_commits_stale_coordinates() {
        for reason in ["Escape", "blur", "gone"] {
            let desk = windows(1);
            let mut wm = wm_of(&desk);
            let win = rect_of(&wm, "window-1");
            let from = title_of(win);
            let out = hold(
                &mut wm,
                moving("window-1"),
                from,
                pt(from.x + 30.0, from.y),
                4,
            );
            assert!(wm.holds());
            assert_eq!(
                last_held(&out),
                Some(Some((
                    "window-1".into(),
                    Rect {
                        x: win.x + 30.0,
                        ..win
                    }
                )))
            );
            let out = match reason {
                "Escape" => {
                    let (taken, out) = wm.escape();
                    assert!(taken, "Escape is the drag's");
                    out
                }
                "blur" => wm.cancel(),
                _ => wm.edit(
                    1,
                    &[desk_wm::edits::Edit::CloseWindow {
                        id: "window-1".into(),
                    }],
                ),
            };
            assert_eq!(last_held(&out), Some(None), "{reason} lets the page go");
            assert!(!wm.holds());
            let later = [
                wm.moved(pt(from.x + 100.0, from.y), 0.0),
                wm.released(pt(from.x + 100.0, from.y), 0.0),
            ];
            assert!(later.iter().all(|o| published(o).is_empty()), "{reason}");
            if reason != "gone" {
                assert_eq!(rect_of(&wm, "window-1"), win, "{reason}");
            }
        }
    }

    #[test]
    fn escape_with_no_drag_is_not_the_window_managers() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        assert!(!wm.escape().0);
        let from = title_of(rect_of(&wm, "window-1"));
        wm.pressed(from);
        wm.grab(moving("window-1"), from, 0.0);
        // A press not yet a drag: Escape goes on to whoever has the keys.
        assert!(!wm.escape().0);
    }
}

mod moving_windows {
    use super::*;

    #[test]
    fn a_drag_moves_the_window_with_the_pointer_and_the_drop_stores_it() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        let out = drag(
            &mut wm,
            moving("window-1"),
            from,
            pt(from.x + 60.0, from.y + 40.0),
        );
        let moved = Rect::new(win.x + 60.0, win.y + 40.0, win.w, win.h);
        assert_eq!(rect_of(&wm, "window-1"), moved);
        let sent = published(&out);
        assert_eq!(sent.len(), 1);
        let p = placed(&sent[0], "window-1");
        assert_eq!((p.x, p.y), (moved.x, moved.y));
        assert_eq!(last_held(&out), Some(None));
    }

    #[test]
    fn a_canvas_drag_stores_world_coordinates() {
        let mut desk = windows(1);
        desk.pan
            .insert("1".into(), desk_wm::Offset::new(-100.0, -50.0));
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = pt(win.x + 5.0, win.y + 5.0);
        drag(
            &mut wm,
            moving("window-1"),
            from,
            pt(from.x + 80.0, from.y + 40.0),
        );
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.x, p.y, p.floating), (560.0, 280.0, None));
    }

    #[test]
    fn a_floating_window_stays_inside_the_app_and_a_pinned_one_does_not_move() {
        let mut desk = windows(1);
        desk.toggle_floating("window-1", W, H);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        // Grabbed far along its title bar and dragged left past the app's edge, the pointer short
        // of the snap zone: it stops at the edge.
        let from = pt(win.x + 400.0, win.y + 20.0);
        drag(&mut wm, moving("window-1"), from, pt(200.0, 12.0));
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                x: 0.0,
                y: 0.0,
                ..win
            }
        );
        let mut desk = windows(1);
        desk.toggle_pin("window-1");
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        let out = drag(&mut wm, moving("window-1"), from, pt(from.x + 90.0, from.y));
        assert!(published(&out).is_empty());
        assert_eq!(rect_of(&wm, "window-1"), win);
    }

    #[test]
    fn a_held_drag_survives_a_redraw_and_escape_restores_the_saved_position() {
        let desk = windows(2);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-2");
        let from = title_of(win);
        hold(
            &mut wm,
            moving("window-2"),
            from,
            pt(from.x + 80.0, from.y + 50.0),
            6,
        );
        // The runtime edits the desk meanwhile and the page reports: the drag holds.
        wm.edit(1, &[desk_wm::edits::Edit::MoveEris { at: None }]);
        taken(&mut wm);
        let held = Rect::new(win.x + 80.0, win.y + 50.0, win.w, win.h);
        assert_eq!(wm.drawn_rect("window-2", 0.0), Some(held));
        assert_eq!(wm.frame(0.0).drawn.get("window-2"), Some(&held));
        let (taken, out) = wm.escape();
        assert!(taken && published(&out).is_empty());
        assert_eq!(rect_of(&wm, "window-2"), win);
        assert!(wm.frame(0.0).drawn.is_empty());
    }

    #[test]
    fn closing_a_window_during_a_drag_lets_the_pointer_go_and_the_next_window_works() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let from = title_of(rect_of(&wm, "window-1"));
        hold(
            &mut wm,
            moving("window-1"),
            from,
            pt(from.x + 40.0, from.y + 30.0),
            4,
        );
        let close = desk_wm::edits::Edit::CloseWindow {
            id: "window-1".into(),
        };
        let out = wm.edit(1, &[close]);
        assert_eq!(last_held(&out), Some(None));
        wm.released(pt(from.x + 40.0, from.y + 30.0), 0.0);
        let out = wm.edit(2, &[desk_wm::edits::Edit::NewWindow]);
        let id = published(&out)[0].answered.as_ref().unwrap().values[0]
            .as_str()
            .unwrap()
            .to_owned();
        let notes = rect_of(&wm, &id);
        let from = title_of(notes);
        drag(&mut wm, moving(&id), from, pt(from.x + 60.0, from.y + 40.0));
        assert_eq!(
            rect_of(&wm, &id),
            Rect {
                x: notes.x + 60.0,
                y: notes.y + 40.0,
                ..notes
            }
        );
    }

    #[test]
    fn losing_the_app_focus_cancels_a_resize() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let kind = Kind::Resize {
            window: "window-1".into(),
            grip: Grip::Se,
        };
        let from = pt(win.right() - 9.0, win.bottom() - 9.0);
        hold(&mut wm, kind, from, pt(from.x + 48.0, from.y + 48.0), 4);
        assert_eq!(
            wm.drawn_rect("window-1", 0.0).map(|r| r.w),
            Some(win.w + 48.0)
        );
        wm.cancel();
        assert_eq!(rect_of(&wm, "window-1"), win);
    }
}
