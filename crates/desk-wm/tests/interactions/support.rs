//! What `tests/interactions.rs` drives the window manager with: a 1440×900 app (the reference
//! frame, so a floating window stores the rect it is drawn at), a desk of new windows as ⌘N opens
//! them, the compositor's pointer in app pixels, and what came out.

#![allow(dead_code)]

use desk_wm::interact::{Kind, Motion, Out, Published, Wm};
use desk_wm::{Desk, Fill, Offset, Placement, Point, Rect, Size};

pub const W: f64 = 1440.0;
pub const H: f64 = 900.0;
pub const SCREEN: Size = Size { w: W, h: H };

pub fn pt(x: f64, y: f64) -> Point {
    Point::new(x, y)
}

/// A desk with `n` new windows (`window-1`, ...), the last one in use.
pub fn windows(n: usize) -> Desk {
    let mut desk = Desk::default();
    for _ in 0..n {
        desk.new_window();
    }
    desk
}

/// The window manager holding `desk`, with `motion`.
pub fn wm_over(desk: &Desk, motion: Motion) -> Wm {
    let mut wm = Wm::new();
    wm.set_motion(motion);
    wm.start(desk.clone(), SCREEN);
    wm
}

/// The same with no motion: everything arrives at once.
pub fn wm_of(desk: &Desk) -> Wm {
    wm_over(desk, Motion::none())
}

/// Window `id` on screen as the window manager draws it.
pub fn rect_of(wm: &Wm, id: &str) -> Rect {
    wm.drawn_rect(id, 0.0).expect("the window is on the desk")
}

/// Where a title bar is grabbed: `dx` in from the window's left, in the middle of its 40 px.
pub fn title_of(r: Rect) -> Point {
    pt(r.x + 80.0, r.y + 20.0)
}

pub fn moving(id: &str) -> Kind {
    Kind::Move { window: id.into() }
}

/// Press at `from`, the page's grab for `kind`, `steps` moves to `to`; the button stays down.
pub fn hold(wm: &mut Wm, kind: Kind, from: Point, to: Point, steps: usize) -> Vec<Out> {
    let mut out = wm.pressed(from);
    out.extend(wm.grab(kind, from, 0.0));
    for i in 1..=steps {
        let k = i as f64 / steps as f64;
        let at = pt(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
        out.extend(wm.moved(at, 0.0));
    }
    out
}

/// The same, let go at `to`.
pub fn drag(wm: &mut Wm, kind: Kind, from: Point, to: Point) -> Vec<Out> {
    let mut out = hold(wm, kind, from, to, 8);
    out.extend(wm.released(to, 0.0));
    out
}

/// What the runtime heard.
pub fn published(out: &[Out]) -> Vec<Published> {
    out.iter()
        .filter_map(|o| match o {
            Out::Publish(p) => Some((**p).clone()),
            _ => None,
        })
        .collect()
}

/// Window `id` as a published desk places it on the desktop in front.
pub fn placed(p: &Published, id: &str) -> Placement {
    p.desk
        .window(id)
        .expect("the window is on the published desk")
}

/// The pan of the desktop in front, as a published desk has it.
pub fn pan_of(p: &Published) -> Offset {
    p.desk.pan_of(&p.desk.here())
}

/// Where the page was last told to lay a held window out (`Some(None)`: let go).
pub fn last_held(out: &[Out]) -> Option<Option<(String, Rect)>> {
    out.iter().rev().find_map(|o| match o {
        Out::Held(h) => Some(h.clone()),
        _ => None,
    })
}

/// The page takes everything published so far.
pub fn taken(wm: &mut Wm) {
    let rev = wm.rev();
    wm.took(rev, SCREEN);
}

/// Where each pointer goes for each part, 3 px inside the app's edges (2 at the top), as the
/// windows-snap spec aims.
pub fn aim(fill: Fill) -> Point {
    match fill {
        Fill::Left => pt(3.0, H / 2.0),
        Fill::Right => pt(W - 3.0, H / 2.0),
        Fill::Top => pt(W / 2.0, 2.0),
        Fill::Bottom => pt(W / 2.0, H - 3.0),
        Fill::TopLeft => pt(3.0, 3.0),
        Fill::TopRight => pt(W - 3.0, 3.0),
        Fill::BottomLeft => pt(3.0, H - 3.0),
        Fill::BottomRight => pt(W - 3.0, H - 3.0),
        Fill::Full => pt(W / 2.0, H / 2.0),
    }
}

pub const PARTS: [Fill; 8] = [
    Fill::Left,
    Fill::Right,
    Fill::Top,
    Fill::Bottom,
    Fill::TopLeft,
    Fill::TopRight,
    Fill::BottomLeft,
    Fill::BottomRight,
];
