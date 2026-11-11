//! A window of panes resized (#159 finding 19): a grip, or the step command, stops where each pane
//! keeps room for its header, and the drop moves the splits' ratios as little as that takes.

use desk_wm::host::{Cell, body_of, cells};
use desk_wm::interact::{Grip, Kind, Op};
use desk_wm::{PANE_MIN, Rect, SplitDir, window_min};

use super::support::*;

/// A window of three panes side by side, 500 px wide.
fn three_panes() -> desk_wm::interact::Wm {
    let mut desk = windows(1);
    desk.place("window-1", Rect::new(300.0, 200.0, 500.0, 300.0));
    desk.split(SplitDir::Row);
    desk.split(SplitDir::Row);
    wm_of(&desk)
}

fn pane_widths(wm: &desk_wm::interact::Wm) -> Vec<f64> {
    let p = wm.desk().window("window-1").unwrap();
    (cells(&p.panes(), body_of(rect_of(wm, "window-1"))).into_iter())
        .filter_map(|c| match c {
            Cell::Pane { rect, .. } => Some(rect.w),
            Cell::Divider { .. } => None,
        })
        .collect()
}

#[test]
fn a_grip_stops_where_every_pane_keeps_its_header() {
    let mut wm = three_panes();
    let least = window_min(&wm.desk().window("window-1").unwrap().panes());
    assert!(least.w > 240.0);
    let edge = Kind::Resize {
        window: "window-1".into(),
        grip: Grip::Se,
    };
    let corner = Grip::Se.rect_in(rect_of(&wm, "window-1"));
    let from = pt(corner.x + 8.0, corner.y + 8.0);
    drag(&mut wm, edge, from, pt(100.0, 100.0));
    let r = rect_of(&wm, "window-1");
    assert_eq!((r.w, r.h), (least.w, least.h));
    let widths = pane_widths(&wm);
    assert!(widths.iter().all(|w| *w >= PANE_MIN.w - 1e-6), "{widths:?}");
}

#[test]
fn the_step_command_stops_there_too() {
    let mut wm = three_panes();
    for _ in 0..20 {
        wm.run(
            &Op::Resize {
                dw: -32.0,
                dh: -32.0,
            },
            None,
        );
    }
    let least = window_min(&wm.desk().window("window-1").unwrap().panes());
    let r = rect_of(&wm, "window-1");
    assert_eq!((r.w, r.h), (least.w, least.h));
    assert!(pane_widths(&wm).iter().all(|w| *w >= PANE_MIN.w - 1e-6));
}
