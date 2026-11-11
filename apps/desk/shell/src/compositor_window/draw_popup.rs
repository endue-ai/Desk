//! A surface's popup widget over it (#156, `web_host/popup.rs`): a select's list, a date, time or
//! colour picker, drawn from its own texture at its place in the surface's view, above what the
//! surface shows there and cut to where the surface is drawn. The pointer on it goes to the
//! surface at that point, and the engine hands it to the popup there; keys go to the surface with
//! the focus, whose engine hands them to its open popup. The desk's own page draws its popups above
//! everything it lays out (a list may reach past the dialog it opens from).

use desk_compositor::glam::Vec2;
use desk_compositor::{NodeId, Rect, Scene, SceneError, SurfaceNode};

use super::draw::{Shown, Sources, Texture, target};

/// A popup: where it is in its surface's view (CSS px), and its texture.
pub type Popup = (Rect, Texture);

/// The node that shows `popup` over a surface drawn at `to`, `scale` texture pixels to a CSS pixel,
/// and the surface's own point at its top left: only what lies inside `to` and what the texture
/// holds (never stretched); none when nothing of it is left.
pub fn node(to: Rect, (place, (id, (tw, th))): Popup, scale: f32) -> Option<(SurfaceNode, Vec2)> {
    let (s, tw, th) = (scale.max(0.25), tw.max(1) as f32, th.max(1) as f32);
    let at = Rect::new(to.x + place.x, to.y + place.y, place.width, place.height);
    let (x0, y0) = (at.x.max(to.x), at.y.max(to.y));
    let x1 = (at.x + at.width.min(tw / s)).min(to.x + to.width);
    let y1 = (at.y + at.height.min(th / s)).min(to.y + to.height);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let cut = Vec2::new(x0 - at.x, y0 - at.y);
    let (w, h) = (x1 - x0, y1 - y0);
    let uv = Rect::new(cut.x * s / tw, cut.y * s / th, w * s / tw, h * s / th);
    let node = SurfaceNode {
        uv,
        ..SurfaceNode::new(Rect::new(x0, y0, w, h), id)
    };
    Some((node, Vec2::new(place.x, place.y) + cut))
}

/// Draw `host`'s popup, if it has one open, over the surface drawn at `to` in `parent`.
pub fn over(
    scene: &mut Scene,
    parent: NodeId,
    to: Rect,
    host: &str,
    from: &Sources,
    shown: &mut Shown,
) -> Result<(), SceneError> {
    let Some((made, origin)) = (from.popup)(host).and_then(|p| node(to, p, from.scale)) else {
        return Ok(());
    };
    let node = scene.insert(parent, made)?;
    shown.push((node, target(host, origin)));
    Ok(())
}

/// No surface has a popup open (checks of the rest of the scene).
#[cfg(test)]
pub fn none(_: &str) -> Option<Popup> {
    None
}

#[cfg(test)]
mod tests {
    use desk_compositor::glam::Vec2;
    use desk_compositor::{Rect, TextureId};

    use super::node;

    #[test]
    fn a_popup_lies_at_its_place_in_the_surface_and_is_heard_there() {
        let pane = Rect::new(100.0, 200.0, 400.0, 300.0);
        let list = (
            Rect::new(10.0, 34.0, 140.0, 100.0),
            (TextureId(9), (280, 200)),
        );
        let (made, origin) = node(pane, list, 2.0).unwrap();
        assert_eq!(made.rect, Rect::new(110.0, 234.0, 140.0, 100.0));
        assert_eq!(made.uv, Rect::new(0.0, 0.0, 1.0, 1.0));
        assert_eq!(made.texture, TextureId(9));
        assert_eq!(origin, Vec2::new(10.0, 34.0), "the surface's own point");
    }

    #[test]
    fn a_popup_is_cut_to_its_surface_and_to_its_texture_never_stretched() {
        let pane = Rect::new(0.0, 0.0, 200.0, 100.0);
        // Past the pane's bottom right: only the part inside it, from the texture's top left.
        let low = (
            Rect::new(150.0, 60.0, 100.0, 80.0),
            (TextureId(2), (100, 80)),
        );
        let (made, origin) = node(pane, low, 1.0).unwrap();
        assert_eq!(made.rect, Rect::new(150.0, 60.0, 50.0, 40.0));
        assert_eq!(made.uv, Rect::new(0.0, 0.0, 0.5, 0.5));
        assert_eq!(origin, Vec2::new(150.0, 60.0));
        // Above the pane's top: cut there, the texture sampled from the cut down.
        let high = (
            Rect::new(20.0, -20.0, 100.0, 80.0),
            (TextureId(2), (100, 80)),
        );
        let (made, origin) = node(pane, high, 1.0).unwrap();
        assert_eq!(made.rect, Rect::new(20.0, 0.0, 100.0, 60.0));
        assert_eq!(made.uv, Rect::new(0.0, 0.25, 1.0, 0.75));
        assert_eq!(origin, Vec2::new(20.0, 0.0));
        // A texture not grown to a new size yet: only what it holds.
        let older = (Rect::new(0.0, 0.0, 100.0, 80.0), (TextureId(2), (50, 80)));
        assert_eq!(node(pane, older, 1.0).unwrap().0.rect.width, 50.0);
        // Wholly outside: nothing.
        let away = (
            Rect::new(300.0, 0.0, 100.0, 80.0),
            (TextureId(2), (100, 80)),
        );
        assert!(node(pane, away, 1.0).is_none());
    }
}
