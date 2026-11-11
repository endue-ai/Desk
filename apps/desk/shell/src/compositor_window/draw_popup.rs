//! A surface's popup widget (#156, `web_host/popup.rs`): a select's list, a date, time or colour
//! picker, drawn from its own texture where its page puts it in the surface's view, whole (B6b).
//! The web host tells each page its screen is the app window, the view at its place in it
//! (`web_host/popup_screen.rs`), so Chromium places a popup as on a desktop: under its field, or
//! above it where the app window has no room below, past the pane where it is larger. The
//! compositor keeps it inside the app window, shifted in where it would reach past an edge (a
//! screen told late), cut only where it is larger than the app window. A plugin window's popup is
//! drawn above every window and under the system layer (`flush` after the windows; the page's
//! pieces over it let the pointer through, `system.rs`); a system surface's (the dock's, an
//! overlay's) over that surface's layer; the desk's page's over everything it lays out. The pointer
//! on it goes to its surface at the popup's own point, where CEF hands it to the popup, outside the
//! pane too; keys go to the surface with the focus, whose engine hands them to its open popup.

use desk_compositor::glam::Vec2;
use desk_compositor::{NodeId, Rect, Scene, SceneError, SurfaceNode};

use super::draw::{Drawn, Shown, Sources, Texture, target};

/// A popup: where it is in its surface's view (CSS px), and its texture.
pub type Popup = (Rect, Texture);

/// `at` moved the least so that `len` from it lies within `span` from `lo`.
fn fit(at: f32, len: f32, lo: f32, span: f32) -> f32 {
    at.clamp(lo, lo + (span - len).max(0.0))
}

/// The node that shows `popup` of a surface drawn at `to`, `scale` texture pixels to a CSS pixel,
/// inside `bounds` (the app window), and the surface's own point at its top left: whole where it
/// fits, moved in where it would leave `bounds`, cut only where it is larger, and only what the
/// texture holds (never stretched); none when nothing of it is left.
pub fn node(
    to: Rect,
    bounds: Rect,
    (place, (id, (tw, th))): Popup,
    scale: f32,
) -> Option<(SurfaceNode, Vec2)> {
    let (s, tw, th) = (scale.max(0.25), tw.max(1) as f32, th.max(1) as f32);
    let w = place.width.min(tw / s).min(bounds.width);
    let h = place.height.min(th / s).min(bounds.height);
    if w <= 0.0 || h <= 0.0 {
        return None;
    }
    let x = fit(to.x + place.x, w, bounds.x, bounds.width);
    let y = fit(to.y + place.y, h, bounds.y, bounds.height);
    let node = SurfaceNode {
        uv: Rect::new(0.0, 0.0, w * s / tw, h * s / th),
        ..SurfaceNode::new(Rect::new(x, y, w, h), id)
    };
    Some((node, Vec2::new(place.x, place.y)))
}

/// Draw `host`'s popup, if it has one open, over its surface drawn at `to` in `parent`, inside
/// `bounds`: where it is drawn.
pub fn over(
    scene: &mut Scene,
    parent: NodeId,
    (to, bounds): (Rect, Rect),
    host: &str,
    from: &Sources,
    shown: &mut Shown,
) -> Result<Option<Rect>, SceneError> {
    let Some((made, origin)) = (from.popup)(host).and_then(|p| node(to, bounds, p, from.scale))
    else {
        return Ok(None);
    };
    let at = made.rect;
    let node = scene.insert(parent, made)?;
    shown.push((node, target(host, origin)));
    Ok(Some(at))
}

/// Draw into `parent`, above all drawn so far, the popups of the surfaces drawn since the last
/// flush (`Drawn::placed`), inside `bounds`; their surfaces and boxes join `Drawn::popups`.
pub fn flush(
    scene: &mut Scene,
    parent: NodeId,
    bounds: Rect,
    from: &Sources,
    drawn: &mut Drawn,
) -> Result<(), SceneError> {
    let fresh = drawn.placed[drawn.flushed.min(drawn.placed.len())..].to_vec();
    drawn.flushed = drawn.placed.len();
    for (host, to) in fresh {
        if let Some(at) = over(scene, parent, (to, bounds), &host, from, &mut drawn.shown)? {
            let r = |v: f32| f64::from(v);
            let at = desk_wm::Rect::new(r(at.x), r(at.y), r(at.width), r(at.height));
            drawn.popups.push((host, at));
        }
    }
    Ok(())
}

/// No surface has a popup open (checks of the rest of the scene).
#[cfg(test)]
pub fn none(_: &str) -> Option<Popup> {
    None
}

#[cfg(test)]
#[path = "draw_popup_tests.rs"]
mod tests;
