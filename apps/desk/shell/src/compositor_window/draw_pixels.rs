//! A window drawn sharp at rest and inside its corners (#250, ADR 0209). At rest it is drawn on
//! whole device pixels, as the window manager places it (`desk_wm::pixels`): a fill or a floating
//! window scaled with the app lands between them, and so would a place stored at another scale.
//! Its surfaces are then drawn one texel to one pixel; a window under the pointer or gliding has
//! them filtered where they are, so it moves smoothly. A surface that reaches one of the window's
//! corners takes the frame's radius there, less how far in from the frame's edge it starts, so
//! its content never shows past the frame's rounded corner; so does the focus ring round it.

use desk_compositor::{Corners, NodeId, NodeKind, Rect, Scene, SceneError};

/// Window rect `r` (CSS pixels) where it is drawn at rest at `scale`: its corner and its size on
/// whole device pixels, as the window manager rounds them.
pub fn at_rest(r: desk_wm::Rect, scale: f32) -> desk_wm::Rect {
    desk_wm::pixels::on_pixels(r, f64::from(scale))
}

/// Every surface under `group` filtered where it is drawn: its window is on its way.
pub fn on_its_way(scene: &mut Scene, group: NodeId) -> Result<(), SceneError> {
    each_surface(scene, group, &mut |s| s.whole_pixels = false)
}

/// Every surface under `group` (a window's, `size` its CSS size) rounded where it reaches one of
/// the window's corners, concentric with the frame's `radius`.
pub fn inside_corners(
    scene: &mut Scene,
    group: NodeId,
    size: (f32, f32),
    radius: f32,
) -> Result<(), SceneError> {
    if radius <= 0.0 {
        return Ok(());
    }
    let window = Rect::new(0.0, 0.0, size.0, size.1);
    each_surface(scene, group, &mut |s| {
        if let Some((radius, corners)) = corners_of(window, s.rect, radius) {
            s.radius = radius;
            s.corners = corners;
        }
    })
}

/// The focus ring round the pane showing `plugin` in the frontmost window that has one (device
/// pixels, rounded out), where that window is drawn, with the radius (device pixels) and corners
/// it shares with the window's frame of `radius`.
pub fn ring_of(
    plan: &desk_wm::host::Plan,
    plugin: &str,
    (radius, scale): (f32, f32),
    on_its_way: impl Fn(&str) -> bool,
) -> Option<(Rect, (f32, Corners))> {
    let (w, pane) = plan.windows.iter().rev().find_map(|w| {
        let pane = w
            .panes
            .iter()
            .rev()
            .find(|p| p.plugin.as_deref() == Some(plugin))?;
        Some((w, pane))
    })?;
    let laid = super::rect(w.rect);
    let at = if on_its_way(&w.id) {
        laid
    } else {
        super::rect(at_rest(w.rect, scale))
    };
    let body = super::rect(pane.body).translate(at.min() - laid.min());
    let window = Rect::new(0.0, 0.0, at.width, at.height);
    let (r, corners) =
        corners_of(window, body.translate(-at.min()), radius).unwrap_or((0.0, Corners::NONE));
    let device = Rect::new(
        body.x * scale,
        body.y * scale,
        body.width * scale,
        body.height * scale,
    );
    Some((device.round_out(), (r * scale, corners)))
}

/// Which corners of `part` lie in `window`'s rounded corners (each within half the radius of one,
/// both ways), and the radius that keeps them concentric with the frame's.
fn corners_of(window: Rect, part: Rect, radius: f32) -> Option<(f32, Corners)> {
    let reach = radius / 2.0;
    let (w0, w1) = (window.min(), window.max());
    let (p0, p1) = (part.min(), part.max());
    let insets = [
        (p0.x - w0.x, p0.y - w0.y),
        (w1.x - p1.x, p0.y - w0.y),
        (w1.x - p1.x, w1.y - p1.y),
        (p0.x - w0.x, w1.y - p1.y),
    ];
    let reached = insets.map(|(dx, dy)| dx.abs() < reach && dy.abs() < reach);
    if !reached.contains(&true) {
        return None;
    }
    let inset = (insets.iter().zip(reached))
        .filter(|(_, r)| *r)
        .map(|((dx, dy), _)| dx.max(*dy).max(0.0))
        .fold(0.0, f32::max);
    let [a, b, c, d] = reached;
    Some(((radius - inset).max(0.0), Corners::new(a, b, c, d)))
}

fn each_surface(
    scene: &mut Scene,
    group: NodeId,
    change: &mut dyn FnMut(&mut desk_compositor::SurfaceNode),
) -> Result<(), SceneError> {
    for child in scene.children(group).to_vec() {
        let Some(node) = scene.node(child).cloned() else {
            continue;
        };
        match node.kind {
            NodeKind::Surface(mut surface) => {
                change(&mut surface);
                let hit = node.hit;
                scene.set(child, desk_compositor::Node::from(surface).with_hit(hit))?;
            }
            NodeKind::Group(_) => each_surface(scene, child, change)?,
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pane_under_the_title_bar_takes_the_frames_bottom_corners() {
        let window = Rect::new(0.0, 0.0, 400.0, 300.0);
        let body = Rect::new(1.0, 41.0, 398.0, 258.0);
        assert_eq!(
            corners_of(window, body, 12.0),
            Some((11.0, Corners::BOTTOM))
        );
    }

    #[test]
    fn the_windows_own_page_takes_all_four() {
        let window = Rect::new(0.0, 0.0, 400.0, 300.0);
        assert_eq!(corners_of(window, window, 12.0), Some((12.0, Corners::ALL)));
    }

    #[test]
    fn panes_side_by_side_take_their_own_corner_and_one_inside_takes_none() {
        let window = Rect::new(0.0, 0.0, 400.0, 300.0);
        let left = Rect::new(1.0, 41.0, 199.0, 258.0);
        let right = Rect::new(201.0, 41.0, 198.0, 258.0);
        let bl = Corners::new(false, false, false, true);
        let br = Corners::new(false, false, true, false);
        assert_eq!(corners_of(window, left, 12.0), Some((11.0, bl)));
        assert_eq!(corners_of(window, right, 12.0), Some((11.0, br)));
        let top = Rect::new(1.0, 41.0, 398.0, 100.0);
        assert_eq!(corners_of(window, top, 12.0), None);
    }

    #[test]
    fn a_window_at_rest_lands_on_whole_device_pixels() {
        let r = desk_wm::Rect::new(510.4, 450.6, 401.0, 300.0);
        assert_eq!(
            at_rest(r, 1.0),
            desk_wm::Rect::new(510.0, 451.0, 401.0, 300.0)
        );
        let at = at_rest(r, 1.25);
        assert!(((at.x * 1.25) - (at.x * 1.25).round()).abs() < 1e-9);
    }
}
