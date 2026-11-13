//! Where windows come to rest (#250, ADR 0209): on whole device pixels at every display scale,
//! wherever the pointer, a pan or a glide left them, while a window under the pointer follows it
//! to the fraction.

use desk_wm::interact::{Kind, Motion, Wm};
use desk_wm::{Fill, Rect, SplitDir};

use super::support::*;

const SCALES: [f64; 4] = [1.0, 1.25, 1.5, 2.0];
/// Long after any glide.
const LATER: f64 = 10_000.0;

fn whole(v: f64, scale: f64) -> bool {
    let device = v * scale;
    (device - device.round()).abs() < 1e-6
}

fn on_grid(r: Rect, scale: f64) -> bool {
    [r.x, r.y, r.w, r.h, r.right(), r.bottom()]
        .iter()
        .all(|v| whole(*v, scale))
}

fn wm_at(scale: f64, desk: &desk_wm::Desk) -> Wm {
    let mut wm = wm_over(desk, Motion::default());
    wm.set_scale(scale);
    wm
}

/// Where window `id` rests once whatever glides has arrived.
fn rests(wm: &mut Wm, id: &str) -> Rect {
    wm.frame(LATER);
    wm.drawn_rect(id, LATER).expect("the window is on the desk")
}

#[test]
fn a_window_dropped_at_a_fraction_rests_on_whole_device_pixels() {
    for scale in SCALES {
        let mut wm = wm_at(scale, &windows(1));
        let win = rect_of(&wm, "window-1");
        let from = title_of(win);
        let to = pt(from.x + 100.4, from.y + 50.6);
        let mut out = hold(&mut wm, moving("window-1"), from, to, 8);
        // Under the pointer it is where the pointer is, to the fraction.
        let held = last_held(&out).flatten().expect("held").1;
        assert!((held.x - (win.x + 100.4)).abs() < 1e-9, "{scale}: {held:?}");
        out.extend(wm.released(to, 0.0));
        let stored = placed(published(&out).last().unwrap(), "window-1");
        assert!(on_grid(stored.rect(), scale), "{scale}: stored {stored:?}");
        let at = rests(&mut wm, "window-1");
        assert!(on_grid(at, scale), "{scale}: drawn at {at:?}");
        assert!(
            (at.x - held.x).abs() <= 0.5 / scale + 1e-9,
            "within half a pixel"
        );
        assert!(!wm.frame(0.0).moving, "less than a pixel: nothing glides");
    }
}

#[test]
fn a_window_resized_to_a_fraction_rests_on_whole_device_pixels() {
    for scale in SCALES {
        let mut wm = wm_at(scale, &windows(1));
        let win = rect_of(&wm, "window-1");
        let grip = desk_wm::interact::Grip::Se;
        let corner = grip.rect_in(win);
        let from = pt(corner.x + 4.0, corner.y + 4.0);
        let kind = Kind::Resize {
            window: "window-1".into(),
            grip,
        };
        drag(&mut wm, kind, from, pt(from.x + 30.3, from.y + 20.7));
        let at = rests(&mut wm, "window-1");
        assert!(on_grid(at, scale), "{scale}: {at:?}");
    }
}

#[test]
fn a_canvas_panned_to_a_fraction_rests_on_whole_device_pixels() {
    for scale in SCALES {
        let mut wm = wm_at(scale, &windows(2));
        let from = pt(20.0, 600.0);
        let out = drag(&mut wm, Kind::Pan, from, pt(from.x + 33.3, from.y - 17.7));
        let pan = pan_of(published(&out).last().unwrap());
        assert!(
            whole(pan.x, scale) && whole(pan.y, scale),
            "{scale}: {pan:?}"
        );
        assert!((pan.x - 33.3).abs() <= 0.5 / scale + 1e-9);
        for id in ["window-1", "window-2"] {
            let at = rests(&mut wm, id);
            assert!(on_grid(at, scale), "{scale}: {id} at {at:?}");
        }
    }
}

#[test]
fn a_glide_into_a_part_ends_on_whole_device_pixels() {
    for scale in SCALES {
        for fill in [Fill::Right, Fill::BottomLeft, Fill::Bottom] {
            let mut wm = wm_at(scale, &windows(1));
            let from = title_of(rect_of(&wm, "window-1"));
            drag(&mut wm, moving("window-1"), from, aim(fill));
            assert!(wm.frame(30.0).moving, "{scale} {fill:?}: it glides");
            let at = rests(&mut wm, "window-1");
            assert!(on_grid(at, scale), "{scale} {fill:?}: {at:?}");
        }
    }
}

#[test]
fn a_split_puts_its_divider_on_whole_pixels() {
    let mut desk = windows(1);
    desk.place("window-1", Rect::new(300.0, 200.0, 401.0, 300.0));
    desk.split(SplitDir::Row);
    let mut p = desk.window("window-1").unwrap();
    // A ratio the page's divider drag leaves: 0.337 of 399 px is 134.463.
    if let Some(desk_wm::PaneNode::Split { ratio, .. }) = p.panes.as_mut() {
        *ratio = 0.337;
    }
    let cells = desk_wm::host::cells(&p.panes(), desk_wm::host::body_of(p.rect()));
    for cell in cells {
        let r = match cell {
            desk_wm::host::Cell::Pane { rect, .. } | desk_wm::host::Cell::Divider { rect, .. } => {
                rect
            }
        };
        assert!(on_grid(r, 1.0) && on_grid(r, 2.0), "{r:?}");
    }
}
