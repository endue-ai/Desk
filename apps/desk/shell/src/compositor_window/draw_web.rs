//! A pane's web view (#273, ADR 0216): the live web page a plugin shows in its window, drawn over
//! the plugin's own surface at the box the plugin gave (`web.place`), in the plugin surface's CSS
//! pixels from its top left. A fixed box is clipped to the pane and to the available pixels.
//! A view that fills its pane uses the pane as drawn. While CEF repaints, its last picture
//! fits that box and the pointer is mapped back to the picture's CSS pixels.

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
    let Some(place) = (from.web)(host) else {
        return Ok(());
    };
    let surface = surface_of(host);
    let Some(texture) = (from.surface)(&surface) else {
        return Ok(());
    };
    let place = place.in_pane(f64::from(into.to.width), f64::from(into.to.height));
    let full = Rect::new(
        into.to.x + place.x as f32,
        into.to.y + place.y as f32,
        place.width as f32,
        place.height as f32,
    );
    let Some((node, origin, per_unit)) = cut(full, into.to, texture, from.scale, place.fill) else {
        return Ok(());
    };
    let node = scene.insert(into.group, node)?;
    let mut input = target(&surface, origin);
    input.per_unit = per_unit;
    shown.push((node, input));
    // Its whole box on the desk: the screen its page's popups are placed in (#156).
    placed.push((surface, full.translate(into.at)));
    Ok(())
}

/// The clipped node and its mapping from scene coordinates to the painted view's CSS pixels.
pub fn cut(
    full: Rect,
    pane: Rect,
    (id, (tw, th)): Texture,
    scale: f32,
    fill: bool,
) -> Option<(SurfaceNode, Vec2, Vec2)> {
    let picture = Vec2::new(tw.max(1) as f32, th.max(1) as f32) / scale;
    let size = Vec2::new(full.width, full.height);
    let extent = if fill { size } else { size.min(picture) };
    let start = full.min().max(pane.min());
    let end = (full.min() + extent).min(pane.min() + Vec2::new(pane.width, pane.height));
    let visible = end - start;
    if visible.x <= 0.0 || visible.y <= 0.0 {
        return None;
    }
    let per_unit = if fill { picture / size } else { Vec2::ONE };
    let origin = (start - full.min()) * per_unit;
    let uv_start = origin / picture;
    let uv_size = visible * per_unit / picture;
    let node = SurfaceNode {
        uv: Rect::new(uv_start.x, uv_start.y, uv_size.x, uv_size.y),
        ..SurfaceNode::new(Rect::new(start.x, start.y, visible.x, visible.y), id)
    };
    Some((node, origin, per_unit))
}

/// No surface has a web view (checks of the rest of the scene).
#[cfg(test)]
pub fn none(_: &str) -> Option<desk_core::WebPlace> {
    None
}
