//! A pane's web view (#273, ADR 0216): the live web page a plugin shows in its window, drawn over
//! the plugin's own surface at the box the plugin gave (`web.place`), in the plugin surface's CSS
//! pixels from its top left. Only what lies inside the pane is drawn, and of that only what the
//! view's texture holds: a page not yet painted at a new size shows the picture it has from its
//! top left, never stretched, as a plugin's surface does. The pointer on it is the view's, at the
//! view's own point; the plugin's surface shows through wherever the view does not cover it, and
//! until the view first paints.

use desk_compositor::glam::Vec2;
use desk_compositor::{Rect, Scene, SceneError, SurfaceNode};

use super::draw::{Shown, Sources, Texture, target};
use super::draw_pane::Into;
use crate::web_host::web_rules::surface_of;

/// Draw the view of the plugin surface with host `host`, if it has one that shows, over that
/// surface's pane; `shown` and `placed` are the scene's (`Drawn`).
pub fn web_view(
    scene: &mut Scene,
    into: &Into,
    host: &str,
    from: &Sources,
    shown: &mut Shown,
    placed: &mut Vec<(String, Rect)>,
) -> Result<(), SceneError> {
    let Some([x, y, width, height]) = (from.web)(host) else {
        return Ok(());
    };
    let surface = surface_of(host);
    let Some(texture) = (from.surface)(&surface) else {
        return Ok(());
    };
    let full = Rect::new(into.to.x + x, into.to.y + y, width, height);
    let Some((node, from_corner)) = cut(full, into.to, texture, from.scale) else {
        return Ok(());
    };
    let node = scene.insert(into.group, node)?;
    shown.push((node, target(&surface, from_corner)));
    // Its whole box on the desk: the screen its page's popups are placed in (#156).
    placed.push((surface, full.translate(into.at)));
    Ok(())
}

/// What is drawn of a view laid out at `full` in a pane at `pane`, from `texture` at `scale`
/// pixels a CSS pixel: the node, and how far its top left lies from the view's own. `None` when
/// nothing of the view lies in the pane.
pub fn cut(
    full: Rect,
    pane: Rect,
    (id, (tw, th)): Texture,
    scale: f32,
) -> Option<(SurfaceNode, Vec2)> {
    let (tw, th) = (tw.max(1) as f32, th.max(1) as f32);
    let (x0, y0) = (full.x.max(pane.x), full.y.max(pane.y));
    let x1 = (full.x + full.width)
        .min(pane.x + pane.width)
        .min(full.x + tw / scale);
    let y1 = (full.y + full.height)
        .min(pane.y + pane.height)
        .min(full.y + th / scale);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let off = Vec2::new(x0 - full.x, y0 - full.y);
    let uv = Rect::new(
        off.x * scale / tw,
        off.y * scale / th,
        (x1 - x0) * scale / tw,
        (y1 - y0) * scale / th,
    );
    let node = SurfaceNode {
        uv,
        ..SurfaceNode::new(Rect::new(x0, y0, x1 - x0, y1 - y0), id)
    };
    Some((node, off))
}

/// No surface has a web view (checks of the rest of the scene).
#[cfg(test)]
pub fn none(_: &str) -> Option<[f32; 4]> {
    None
}
