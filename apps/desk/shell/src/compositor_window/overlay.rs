//! What the compositor draws above the surfaces for input (#56): the focus ring round the plugin
//! surface with the keyboard focus, and the drag image under the pointer with the effect its target
//! answered (`+` copy, `↗` link, `⊘` refused). Neither takes the pointer: hit testing passes
//! through them, and during a drag the broker owns the pointer anyway. The colours are fixed until
//! the compositor draws the chrome from the token table (#53).

use desk_compositor::input::DragOverlay;
use desk_compositor::{Color, Node, Rect, RectNode, Scene, Shadow, Stroke, TextNode, TextStyle};
use desk_surface::generated::SurfaceDropAnswer;

/// The ring's colour: the desk's accent.
const RING: u32 = 0x4c8dff;

/// The focus ring round `rect` (device pixels), two logical pixels wide inside it.
pub fn focus_ring(scene: &mut Scene, rect: Rect, scale: f32) {
    let ring = RectNode {
        rect,
        fill: Color::TRANSPARENT,
        stroke: Some(Stroke {
            width: 2.0 * scale,
            color: Color::hex(RING),
        }),
        radius: 0.0,
        shadow: None,
    };
    let root = scene.root();
    let _ = scene.insert(root, Node::from(ring).with_hit(false));
}

/// The text the drag image shows: the effect's mark, the label, how many.
pub fn caption(overlay: &DragOverlay) -> String {
    let mark = match overlay.effect {
        SurfaceDropAnswer::Copy => "+ ",
        SurfaceDropAnswer::Link => "↗ ",
        SurfaceDropAnswer::None => "⊘ ",
        SurfaceDropAnswer::Move => "",
    };
    let count = if overlay.look.count > 1 {
        format!("  ({})", overlay.look.count)
    } else {
        String::new()
    };
    format!("{mark}{}{count}", overlay.look.label)
}

/// The drag image at the pointer (device pixels).
pub fn drag_image(scene: &mut Scene, overlay: &DragOverlay, scale: f32) {
    let text = caption(overlay);
    let width = (16.0 + 7.5 * text.chars().count() as f32).clamp(48.0, 280.0) * scale;
    let height = 28.0 * scale;
    let rect = Rect::new(
        overlay.at.x + 12.0 * scale,
        overlay.at.y + 12.0 * scale,
        width,
        height,
    );
    let refused = overlay.effect == SurfaceDropAnswer::None;
    let pill = RectNode {
        rect,
        fill: if refused {
            Color::hex(0x5a2a2a)
        } else {
            Color::hex(0x1d2333)
        }
        .fade(0.92),
        stroke: Some(Stroke {
            width: scale,
            color: Color::WHITE.fade(0.25),
        }),
        radius: 8.0 * scale,
        shadow: Some(Shadow {
            offset: desk_compositor::glam::Vec2::new(0.0, 2.0 * scale),
            blur: 8.0 * scale,
            spread: 0.0,
            color: Color::rgba8(0, 0, 0, 90),
        }),
    };
    let root = scene.root();
    let _ = scene.insert(root, Node::from(pill).with_hit(false));
    let style = TextStyle {
        size: 13.0 * scale,
        color: Color::WHITE,
        line_height: 18.0 * scale,
        ..TextStyle::default()
    };
    let inner = Rect::new(
        rect.x + 8.0 * scale,
        rect.y + 5.0 * scale,
        width - 16.0 * scale,
        18.0 * scale,
    );
    let _ = scene.insert(
        root,
        Node::from(TextNode::new(inner, &text, style)).with_hit(false),
    );
}

#[cfg(test)]
mod tests {
    use desk_compositor::glam::Vec2;
    use desk_compositor::input::DragOverlay;
    use desk_compositor::input::dnd::DragLook;
    use desk_compositor::{Rect, Scene};
    use desk_surface::generated::SurfaceDropAnswer;

    use super::{caption, drag_image, focus_ring};

    fn overlay(effect: SurfaceDropAnswer, count: usize) -> DragOverlay {
        let look = DragLook {
            label: "a.md".into(),
            detail: None,
            src: None,
            count,
        };
        DragOverlay {
            look,
            at: Vec2::new(100.0, 100.0),
            effect,
        }
    }

    #[test]
    fn the_drag_image_says_the_effect_and_how_many() {
        assert_eq!(caption(&overlay(SurfaceDropAnswer::Copy, 1)), "+ a.md");
        assert_eq!(caption(&overlay(SurfaceDropAnswer::Link, 3)), "↗ a.md  (3)");
        assert_eq!(caption(&overlay(SurfaceDropAnswer::None, 1)), "⊘ a.md");
    }

    #[test]
    fn neither_mark_takes_the_pointer() {
        let mut scene = Scene::new(400, 300);
        focus_ring(&mut scene, Rect::new(10.0, 10.0, 100.0, 100.0), 2.0);
        drag_image(&mut scene, &overlay(SurfaceDropAnswer::Copy, 1), 2.0);
        let root = scene.root();
        assert_eq!(scene.children(root).len(), 3);
        assert!(
            scene
                .children(root)
                .iter()
                .all(|n| !scene.node(*n).unwrap().hit)
        );
        assert_eq!(
            desk_compositor::hit_test(&scene, Vec2::new(50.0, 50.0)),
            None
        );
    }
}
