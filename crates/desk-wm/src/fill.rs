//! Filling and coming back (`filled`, `snapRect`, `unfilled`, `fillWith`, `toggleMaximize` and
//! `toggleFloating` in `packages/runtime/src/shell/windows.ts`). A fill takes the whole app or a
//! half or quarter of it, stored in the reference frame (ADR 0132), and floats the window
//! (ADR 0128): it stays in its part whatever the pan and keeps filling it after the app is resized.
//! Every fill keeps the place and the mode to come back to. Each function takes a placement and
//! gives the changed one; the desk state applies it as a session edit (#79).

use crate::coordinates::{is_floating, screen_rect, stored_rect};
use crate::geometry::{REF, clamp_rect, screen_area};
use crate::snap::fill_rect;
use crate::types::{Fill, Offset, Placement, Rect, Restore};

/// Where a fill puts a window on a `vw`×`vh` app: what a drag's snap preview shows.
pub fn snap_rect(fill: Fill, vw: f64, vh: f64) -> Rect {
    fill_rect(fill, screen_area(vw, vh))
}

/// `p` taking `fill`: its part of the reference frame, floating.
fn filled(p: Placement, fill: Fill) -> Placement {
    let mut p = p;
    p.set_rect(fill_rect(fill, screen_area(REF.w, REF.h)));
    p.floating = Some(true);
    p.fill = Some(fill);
    p
}

/// The place to come back to: where the window is now, and in which mode.
fn place_of(p: &Placement) -> Restore {
    Restore {
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        floating: Some(is_floating(p)),
        fill: None,
    }
}

/// The window out of its fill, back at its restore, in the mode it had before it filled. A restore
/// saved before fills floated names no mode: the window keeps its own.
pub fn unfilled(p: &Placement) -> Placement {
    let back = p.restore.map_or_else(|| p.rect(), |r| r.rect());
    unfilled_at(p, back)
}

/// The same, at `back`: where a drag dropped it.
pub fn unfilled_at(p: &Placement, back: Rect) -> Placement {
    let floating = p
        .restore
        .and_then(|r| r.floating)
        .unwrap_or_else(|| is_floating(p));
    let mut out = Placement {
        restore: None,
        fill: None,
        floating: floating.then_some(true),
        ..p.clone()
    };
    out.set_rect(back);
    out
}

/// The window filling `fill` (`snapTo`). Its own place and mode stay the one to come back to;
/// filling the whole app from a half or a quarter also keeps that part, which the next restore
/// comes back to.
pub fn fill_with(p: &Placement, fill: Fill) -> Placement {
    let own = Restore {
        fill: None,
        ..p.restore.unwrap_or_else(|| place_of(p))
    };
    let part = match (fill, p.fill) {
        (Fill::Full, Some(from)) if from != Fill::Full => Some(from),
        _ => None,
    };
    let restore = Restore { fill: part, ..own };
    filled(
        Placement {
            restore: Some(restore),
            ..p.clone()
        },
        fill,
    )
}

/// Fill the whole app, keeping the place to come back to; a second call comes back: to the half
/// or quarter it filled from, or to its own place and mode.
pub fn toggle_maximize(p: &Placement) -> Placement {
    match p.restore {
        // Filled (one saved before fills has a restore but no fill): come back.
        Some(restore) if matches!(p.fill, None | Some(Fill::Full)) => match restore.fill {
            Some(part) => fill_with(p, part),
            None => unfilled(p),
        },
        _ => fill_with(p, Fill::Full),
    }
}

/// Switch coordinate spaces while keeping the rect on screen: the title bar's Floating button,
/// which also takes a window out of its fill.
pub fn toggle_floating(p: &Placement, pan: Offset, vw: f64, vh: f64) -> Placement {
    let floating = !is_floating(p);
    let screen = screen_rect(p, pan, vw, vh);
    let rect = if floating {
        clamp_rect(screen, vw, vh)
    } else {
        screen
    };
    let mut out = Placement {
        floating: Some(floating),
        restore: None,
        fill: None,
        ..p.clone()
    };
    out.set_rect(stored_rect(rect, floating, pan, vw, vh));
    out
}
