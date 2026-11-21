//! Where an app window goes when the desk moves it (ADR 0294): the frame a `desk.windows.*`
//! command's ask leads to, from where the OS window is and the displays' work areas, in points of
//! winit's global space (top left of the main display). A move keeps the title bar within reach
//! on a display, a resize keeps the app's smallest size and no more than the display's work area,
//! a fill takes a half, a quarter or all of that work area and remembers where the window was, and
//! `none` brings it back there. A fill the person has since moved away from is over. Pure, so its
//! tests run without a window (`frames_tests.rs`).

use desk_wm::{Fill, Rect};
use serde::Deserialize;

/// How much of the title bar stays on a display, in points: a grip's worth across, its height down.
pub const REACH: (f64, f64) = (80.0, 40.0);

/// What the desk asks of an app window (`OutAsk` in the runtime's `wm/host.ts`).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Ask {
    Look,
    Move {
        x: Option<f64>,
        y: Option<f64>,
        dx: Option<f64>,
        dy: Option<f64>,
    },
    Resize {
        w: Option<f64>,
        h: Option<f64>,
        dw: Option<f64>,
        dh: Option<f64>,
    },
    Fill {
        fill: Part,
    },
    Pin {
        pinned: bool,
    },
}

/// A fill asked for: a part of the work area, or back to before (`none`).
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum Part {
    Fill(Fill),
    None(NoneWord),
}

/// The word `none`.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NoneWord {
    None,
}

/// A fill an app window is in: the part, the frame it took and the frame it had before.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Filled {
    pub fill: Fill,
    pub at: Rect,
    pub before: Rect,
}

/// What the app's manifest allows its window (`hints.rs`): its smallest inside, and whether it
/// keeps its size.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    pub least: (f64, f64),
    pub fixed: bool,
}

/// Where the window goes, the fill it is in after, and the work area of the display it is on.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plan {
    pub frame: Rect,
    pub filled: Option<Filled>,
    pub screen: Rect,
}

/// Whether two frames are the same to the point (the OS rounds what it is given).
fn same(a: Rect, b: Rect) -> bool {
    [(a.x, b.x), (a.y, b.y), (a.w, b.w), (a.h, b.h)]
        .iter()
        .all(|(p, q)| (p - q).abs() <= 2.0)
}

/// The work area `r` is on: the one holding its title bar's middle, else the nearest.
pub fn area_of(r: Rect, areas: &[Rect]) -> Rect {
    if let Some(a) = holding(r, areas) {
        return a;
    }
    let (px, py) = (r.x + r.w / 2.0, r.y + REACH.1 / 2.0);
    let far = |a: &Rect| {
        let dx = (px - px.clamp(a.x, a.x + a.w)).abs();
        let dy = (py - py.clamp(a.y, a.y + a.h)).abs();
        dx * dx + dy * dy
    };
    (areas.iter().copied())
        .min_by(|a, b| far(a).total_cmp(&far(b)))
        .unwrap_or(r)
}

/// `fill`'s part of work area `a`.
pub fn part(a: Rect, fill: Fill) -> Rect {
    let (hw, hh) = (a.w / 2.0, a.h / 2.0);
    let (x, y, w, h) = match fill {
        Fill::Full => (a.x, a.y, a.w, a.h),
        Fill::Left => (a.x, a.y, hw, a.h),
        Fill::Right => (a.x + hw, a.y, a.w - hw, a.h),
        Fill::Top => (a.x, a.y, a.w, hh),
        Fill::Bottom => (a.x, a.y + hh, a.w, a.h - hh),
        Fill::TopLeft => (a.x, a.y, hw, hh),
        Fill::TopRight => (a.x + hw, a.y, a.w - hw, hh),
        Fill::BottomLeft => (a.x, a.y + hh, hw, a.h - hh),
        Fill::BottomRight => (a.x + hw, a.y + hh, a.w - hw, a.h - hh),
    };
    Rect::new(x, y, w, h)
}

/// The work area holding `r`'s title bar's middle, if one does.
fn holding(r: Rect, areas: &[Rect]) -> Option<Rect> {
    let (px, py) = (r.x + r.w / 2.0, r.y + REACH.1 / 2.0);
    (areas.iter().copied()).find(|a| px >= a.x && px < a.x + a.w && py >= a.y && py < a.y + a.h)
}

/// `r` moved so its title bar is within reach on the display it lands on; one moved past every
/// display stops at the edge of `from`, the display it was on.
fn in_reach(r: Rect, areas: &[Rect], from: Rect) -> Rect {
    let a = holding(r, areas).unwrap_or(from);
    let x =
        r.x.clamp(a.x - r.w + REACH.0, (a.x + a.w - REACH.0).max(a.x));
    let y = r.y.clamp(a.y, (a.y + a.h - REACH.1).max(a.y));
    Rect::new(x, y, r.w, r.h)
}

/// The one of `to` (where it goes) and `by` (how far) given, from `now`; both is refused.
fn axis(now: f64, to: Option<f64>, by: Option<f64>, name: &str) -> Result<f64, String> {
    match (to, by) {
        (Some(_), Some(_)) => Err(format!("{name} or d{name}, not both")),
        (Some(v), None) | (None, Some(v)) if !v.is_finite() => Err(format!("{name} is a number")),
        (Some(to), None) => Ok(to),
        (None, Some(by)) => Ok(now + by),
        (None, None) => Ok(now),
    }
}

/// Where `ask` puts an app window that is at `now`, in the fill `filled` was in, on `areas`.
pub fn plan(
    now: Rect,
    areas: &[Rect],
    ask: &Ask,
    limits: Limits,
    filled: Option<Filled>,
) -> Result<Plan, String> {
    let filled = filled.filter(|f| same(f.at, now));
    let here = area_of(now, areas);
    let (frame, filled) = match ask {
        Ask::Look | Ask::Pin { .. } => (now, filled),
        Ask::Move { x, y, dx, dy } => {
            let x = axis(now.x, *x, *dx, "x")?;
            let y = axis(now.y, *y, *dy, "y")?;
            (in_reach(Rect::new(x, y, now.w, now.h), areas, here), None)
        }
        Ask::Resize { .. } if limits.fixed => (now, filled),
        Ask::Resize { w, h, dw, dh } => {
            let w = axis(now.w, *w, *dw, "w")?.clamp(limits.least.0, here.w.max(limits.least.0));
            let h = axis(now.h, *h, *dh, "h")?.clamp(limits.least.1, here.h.max(limits.least.1));
            (Rect::new(now.x, now.y, w, h), None)
        }
        Ask::Fill {
            fill: Part::None(_),
        } => (filled.map_or(now, |f| f.before), None),
        Ask::Fill { .. } if limits.fixed => return Err("its app keeps its size".to_owned()),
        Ask::Fill {
            fill: Part::Fill(fill),
        } => {
            let at = part(here, *fill);
            let before = filled.map_or(now, |f| f.before);
            let at = Rect::new(
                at.x,
                at.y,
                at.w.max(limits.least.0),
                at.h.max(limits.least.1),
            );
            let filled = Filled {
                fill: *fill,
                at,
                before,
            };
            (at, Some(filled))
        }
    };
    Ok(Plan {
        frame,
        filled,
        screen: area_of(frame, areas),
    })
}

#[cfg(test)]
#[path = "frames_tests.rs"]
mod tests;
