//! The window manager's seam to the runtime (ADR 0153), the pan (`shell/Pan.ts`, ADR 0082) and the
//! window commands (`desk.display.*`): every change is published under a revision and kept until
//! the runtime has taken it; a grab that arrives late still lands; the page lays a held window out
//! where it follows and the compositor draws what the page draws of it from there.

use desk_wm::edits::Edit;
use desk_wm::interact::{Kind, Op, Published};
use desk_wm::{Fill, Offset, Places, Rect, TopChrome, Unseen, snap_rect};

use super::support::*;

mod the_pan {
    use super::*;

    #[test]
    fn shift_drag_pans_the_canvas_and_the_normal_windows_with_it_and_a_floating_one_stays() {
        let mut desk = windows(2);
        desk.toggle_floating("window-2", W, H);
        let mut wm = wm_of(&desk);
        let (normal, floating) = (rect_of(&wm, "window-1"), rect_of(&wm, "window-2"));
        let out = drag(&mut wm, Kind::Pan, pt(200.0, 700.0), pt(80.0, 760.0));
        // The canvas follows the pointer as it moves, as the runtime's pan did.
        let pans: Vec<Offset> = published(&out).iter().map(pan_of).collect();
        assert!(pans.len() > 1);
        assert_eq!(pans.last(), Some(&Offset::new(-120.0, 60.0)));
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                x: normal.x - 120.0,
                y: normal.y + 60.0,
                ..normal
            }
        );
        assert_eq!(rect_of(&wm, "window-2"), floating);
    }

    #[test]
    fn a_pan_holds_through_a_redraw_and_escape_puts_the_canvas_back() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        hold(&mut wm, Kind::Pan, pt(200.0, 700.0), pt(100.0, 650.0), 5);
        taken(&mut wm);
        assert_eq!(wm.desk().pan_of("1"), Offset::new(-100.0, -50.0));
        let (taken_by_wm, out) = wm.escape();
        assert!(taken_by_wm);
        assert_eq!(pan_of(&published(&out)[0]), Offset::new(0.0, 0.0));
        assert_eq!(wm.desk().pan_of("1"), Offset::new(0.0, 0.0));
    }

    #[test]
    fn a_desktop_switched_to_meanwhile_is_left_where_it_is() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        hold(&mut wm, Kind::Pan, pt(200.0, 700.0), pt(150.0, 700.0), 3);
        wm.edit(
            1,
            &[Edit::SwitchTo {
                desktop: "2".into(),
            }],
        );
        let out = wm.moved(pt(50.0, 700.0), 0.0);
        assert!(published(&out).is_empty());
        assert_eq!(wm.desk().pan_of("2"), Offset::new(0.0, 0.0));
    }
}

mod the_commands {
    use super::*;

    #[test]
    fn maximize_and_restore_take_the_whole_app_over_a_panned_canvas_and_come_back() {
        let mut desk = windows(1);
        desk.pan.insert("1".into(), Offset::new(-100.0, -50.0));
        let mut wm = wm_of(&desk);
        let before = rect_of(&wm, "window-1");
        wm.run(&Op::Maximize, None);
        assert_eq!(rect_of(&wm, "window-1"), Rect::new(0.0, 0.0, W, H));
        wm.run(&Op::Maximize, None);
        assert_eq!(rect_of(&wm, "window-1"), before);
        assert_eq!(wm.desk().window("window-1").unwrap().fill, None);
    }

    #[test]
    fn a_snap_command_takes_any_of_the_eight_parts_and_maximize_comes_back_to_it() {
        for part in PARTS {
            let desk = windows(1);
            let mut wm = wm_of(&desk);
            wm.run(&Op::Snap { fill: part }, Some("window-1"));
            assert_eq!(rect_of(&wm, "window-1"), snap_rect(part, W, H), "{part:?}");
            wm.run(&Op::Maximize, None);
            wm.run(&Op::Maximize, None);
            assert_eq!(wm.desk().window("window-1").unwrap().fill, Some(part));
        }
    }

    #[test]
    fn moving_by_a_step_moves_the_window_and_a_filled_one_ends_its_fill_where_it_is_in_its_mode() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        wm.run(
            &Op::Move {
                dx: 32.0,
                dy: -32.0,
            },
            None,
        );
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                x: win.x + 32.0,
                y: win.y - 32.0,
                ..win
            }
        );
        wm.run(&Op::Snap { fill: Fill::Right }, None);
        let part = snap_rect(Fill::Right, W, H);
        wm.run(&Op::Move { dx: -32.0, dy: 0.0 }, None);
        // A normal window before it snapped, a normal one again (#159 finding 10).
        let p = wm.desk().window("window-1").unwrap();
        assert_eq!((p.fill, p.restore, p.floating), (None, None, None));
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                x: part.x - 32.0,
                ..part
            }
        );
    }

    #[test]
    fn resizing_by_a_step_grows_from_the_corner_and_stops_at_the_minimum() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        wm.run(&Op::Resize { dw: 32.0, dh: 32.0 }, None);
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                w: win.w + 32.0,
                h: win.h + 32.0,
                ..win
            }
        );
        wm.run(
            &Op::Resize {
                dw: -2000.0,
                dh: -2000.0,
            },
            None,
        );
        let r = rect_of(&wm, "window-1");
        assert_eq!(
            (r.x, r.y, r.w, r.h),
            (win.x, win.y, desk_wm::MIN.w, desk_wm::MIN.h)
        );
    }

    #[test]
    fn a_command_names_its_window_or_takes_the_one_in_use_and_none_does_nothing() {
        let desk = windows(2);
        let mut wm = wm_of(&desk);
        let one = rect_of(&wm, "window-1");
        wm.run(&Op::Move { dx: 10.0, dy: 0.0 }, Some("window-1"));
        assert_eq!(rect_of(&wm, "window-1").x, one.x + 10.0);
        wm.run(&Op::Snap { fill: Fill::Left }, None);
        assert_eq!(wm.desk().window("window-2").unwrap().fill, Some(Fill::Left));
        assert!(wm.run(&Op::Maximize, Some("window-9")).is_empty());
    }
}

mod the_seam {
    use super::*;

    #[test]
    fn every_change_is_published_whole_under_a_revision_and_the_page_lays_out_what_it_took() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let out = wm.run(&Op::Snap { fill: Fill::Left }, None);
        let sent = published(&out);
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].rev, 1);
        assert_eq!(&sent[0].desk, wm.desk());
        assert_eq!(sent[0].view.front[0].rect, snap_rect(Fill::Left, W, H));
        // The page has not taken it yet: it still lays the window out where it was.
        assert_eq!(wm.page(), &desk);
        assert_eq!(rect_of(&wm, "window-1"), snap_rect(Fill::Left, W, H));
        // An edit of the runtime's publishes again; the page takes the snap, then the edit.
        let out = wm.edit(
            4,
            &[Edit::TogglePin {
                id: "window-1".into(),
            }],
        );
        let edited = published(&out);
        assert_eq!(
            (edited[0].rev, edited[0].answered.as_ref().unwrap().seq),
            (2, 4)
        );
        wm.took(1, SCREEN);
        assert_eq!(wm.page(), &sent[0].desk);
        wm.took(2, SCREEN);
        assert!(wm.page().window("window-1").unwrap().pinned);
    }

    #[test]
    fn a_grab_that_arrives_after_the_drop_still_lands() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        wm.pressed(from);
        for i in 1..=8 {
            wm.moved(pt(from.x + 10.0 * f64::from(i), from.y), 0.0);
        }
        wm.released(pt(from.x + 80.0, from.y), 0.0);
        assert!(wm.desk().window("window-1").unwrap().x == win.x);
        let out = wm.grab(moving("window-1"), from, 0.0);
        assert_eq!(published(&out).len(), 1);
        assert_eq!(
            rect_of(&wm, "window-1"),
            Rect {
                x: win.x + 80.0,
                ..win
            }
        );
        // The same press is not taken twice.
        assert!(wm.grab(moving("window-1"), from, 0.0).is_empty());
        // A drag to a corner the page answered after the drop snaps there.
        taken(&mut wm);
        let from = title_of(rect_of(&wm, "window-1"));
        wm.pressed(from);
        for i in 1..=8 {
            let k = f64::from(i) / 8.0;
            wm.moved(
                pt(from.x + (3.0 - from.x) * k, from.y + (3.0 - from.y) * k),
                0.0,
            );
        }
        wm.released(pt(3.0, 3.0), 0.0);
        wm.grab(moving("window-1"), from, 0.0);
        assert_eq!(
            wm.desk().window("window-1").unwrap().fill,
            Some(Fill::TopLeft)
        );
    }

    #[test]
    fn a_grab_names_the_press_where_the_page_heard_it_for_a_window_drawn_ahead_of_the_page() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let win = rect_of(&wm, "window-1");
        // The window glides: drawn 40 px left of where the page lays it out.
        let at = pt(win.x + 40.0, win.y + 20.0);
        let page = pt(at.x + 40.0, at.y);
        wm.pressed_at(at, page);
        wm.moved(pt(at.x + 100.0, at.y), 0.0);
        wm.released(pt(at.x + 100.0, at.y), 0.0);
        assert_eq!(published(&wm.grab(moving("window-1"), page, 0.0)).len(), 1);
        assert_eq!(rect_of(&wm, "window-1").x, win.x + 100.0);
    }

    #[test]
    fn a_grab_or_a_command_ahead_of_the_edit_that_brings_its_window_waits_for_it() {
        // The page's calls run on threads of their own: one may overtake the edit it follows.
        let mut wm = wm_of(&windows(0));
        let win = windows(1).window("window-1").unwrap().rect();
        let from = title_of(win);
        wm.pressed(from);
        wm.moved(pt(from.x + 60.0, from.y), 0.0);
        wm.released(pt(from.x + 60.0, from.y), 0.0);
        assert!(wm.grab(moving("window-1"), from, 0.0).is_empty());
        assert!(wm.run(&Op::Maximize, Some("window-1")).is_empty());
        let out = wm.edit(1, &[Edit::NewWindow]);
        assert_eq!(
            published(&out).len(),
            3,
            "the edit, the drop, then the maximize"
        );
        assert_eq!(rect_of(&wm, "window-1"), Rect::new(0.0, 0.0, W, H));
        // One whose window never comes is let go.
        wm.run(&Op::Maximize, Some("window-9"));
        for _ in 0..40 {
            taken(&mut wm);
        }
        let out = wm.edit(2, &[Edit::NewWindow, Edit::NewWindow, Edit::NewWindow]);
        assert_eq!(published(&out).len(), 1);
    }

    #[test]
    fn what_is_published_reads_as_the_runtime_writes_it() {
        let desk = windows(1);
        let mut wm = wm_of(&desk);
        let sent = published(&wm.run(
            &Op::Snap {
                fill: Fill::TopLeft,
            },
            None,
        ));
        let json = serde_json::to_value(&sent[0]).unwrap();
        assert_eq!(json["rev"], 1);
        let p = &json["desk"]["session"]["1"]["surfaces"][0];
        assert_eq!(p["id"], "window-1");
        assert_eq!(p["fill"], "top-left");
        assert_eq!(p["floating"], true);
        assert_eq!(p["restore"]["x"], 480.0);
        assert_eq!(json["view"]["here"], "1");
        let part = snap_rect(Fill::TopLeft, W, H);
        assert_eq!(json["view"]["front"][0]["rect"]["w"], part.w);
        assert!(json.get("answered").is_none());
        let back: Published = serde_json::from_value(json).unwrap();
        assert_eq!(back, sent[0]);
    }

    #[test]
    fn the_page_lays_a_held_window_out_where_it_follows_and_its_parts_are_drawn_from_there() {
        let desk = windows(2);
        let held = Rect::new(600.0, 300.0, 480.0, 320.0);
        let behind = Rect::new(560.0, 280.0, 480.0, 320.0);
        let mut places = Places::default();
        places.drawn.insert("window-2".into(), held);
        places.page.insert("window-2".into(), behind);
        let plan = desk.host_plan_at(W, H, TopChrome::default(), &Unseen, &places);
        let w = plan.window("window-2").unwrap();
        assert_eq!((w.rect, w.page), (held, behind));
        // A move: every part the page draws is the same size, taken from where the page has it.
        let offset = |(src, dst): &(Rect, Rect)| (dst.x - src.x, dst.y - src.y, src.w == dst.w);
        assert!(w.page_parts.iter().all(|p| offset(p) == (40.0, 20.0, true)));
        // What the page draws of it at its own place is drawn with the window, not above them all.
        let bar = w.page_parts[0].0;
        assert!(!plan.page.iter().any(|piece| piece.overlaps(&bar)));
        // Grown from its corner: the tools keep to the title bar's right end.
        places
            .drawn
            .insert("window-2".into(), Rect { w: 600.0, ..behind });
        let plan = desk.host_plan_at(W, H, TopChrome::default(), &Unseen, &places);
        let w = plan.window("window-2").unwrap();
        let (src, dst) = w.page_parts[1];
        assert_eq!(
            (src.right(), dst.right()),
            (behind.right() - 1.0, behind.x + 600.0 - 1.0)
        );
        let unmoved = plan.window("window-1").unwrap();
        assert!(unmoved.page_parts.iter().all(|(s, d)| s == d));
    }
}
