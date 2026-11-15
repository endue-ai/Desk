//! What the compositor draws over the surfaces for input (#56): above everything, the drag image
//! under the pointer with the effect its target answered (`+` copy, `↗` link, `⊘` refused). It
//! takes no pointer: hit testing passes through it, and during a drag the broker owns the pointer
//! anyway. Its colours are fixed until the compositor draws the chrome from the token table (#53).
//! No ring marks the surface with the keys: the frame of the window in use says it.

use desk_compositor::input::DragOverlay;
use desk_compositor::{Color, Node, Rect, RectNode, Scene, Shadow, Stroke, TextNode, TextStyle};
use desk_surface::generated::SurfaceDropAnswer;

/// The text the drag image shows: the effect's mark, the label, how many; for files from the OS
/// that no surface takes there, that a drop opens them (#162).
pub fn caption(overlay: &DragOverlay) -> String {
    let mark = match overlay.effect {
        _ if overlay.opens => "Open ",
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
    // Below and right of the pointer; near the window's right or bottom edge, on the other side.
    let (w, h) = scene.viewport();
    let gap = 12.0 * scale;
    let side = |at: f32, size: f32, room: u32| {
        if at + gap + size > room as f32 && at - gap - size >= 0.0 {
            at - gap - size
        } else {
            at + gap
        }
    };
    let rect = Rect::new(
        side(overlay.at.x, width, w),
        side(overlay.at.y, height, h),
        width,
        height,
    );
    let refused = overlay.effect == SurfaceDropAnswer::None && !overlay.opens;
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
        // A multiple of the size, as CSS's unitless line-height.
        line_height: 1.35,
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
    use desk_compositor::Scene;
    use desk_surface::generated::SurfaceDropAnswer;

    use super::{caption, drag_image};

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
            opens: false,
        }
    }

    #[test]
    fn the_drag_image_says_the_effect_and_how_many() {
        assert_eq!(caption(&overlay(SurfaceDropAnswer::Copy, 1)), "+ a.md");
        assert_eq!(caption(&overlay(SurfaceDropAnswer::Link, 3)), "↗ a.md  (3)");
        assert_eq!(caption(&overlay(SurfaceDropAnswer::None, 1)), "⊘ a.md");
    }

    #[test]
    fn files_from_the_os_that_no_window_takes_say_a_drop_opens_them() {
        // #162 finding 14: the OS draws the files' image; the desk says where they go.
        let opens = |effect, count| DragOverlay {
            opens: true,
            ..overlay(effect, count)
        };
        assert_eq!(caption(&opens(SurfaceDropAnswer::None, 1)), "Open a.md");
        assert_eq!(
            caption(&opens(SurfaceDropAnswer::None, 4)),
            "Open a.md  (4)"
        );
    }

    #[test]
    fn near_the_right_and_bottom_edges_the_drag_image_goes_to_the_other_side() {
        let pill = |at: Vec2| {
            let mut scene = Scene::new(400, 300);
            drag_image(
                &mut scene,
                &DragOverlay {
                    at,
                    ..overlay(SurfaceDropAnswer::Copy, 1)
                },
                1.0,
            );
            let first = scene.children(scene.root())[0];
            scene.node(first).and_then(|n| n.rect()).unwrap()
        };
        let free = pill(Vec2::new(100.0, 100.0));
        assert_eq!((free.x, free.y), (112.0, 112.0));
        let corner = pill(Vec2::new(390.0, 290.0));
        assert!(corner.x + corner.width <= 390.0 && corner.y + corner.height <= 290.0);
    }

    #[test]
    fn the_drag_image_takes_no_pointer() {
        let mut scene = Scene::new(400, 300);
        let root = scene.root();
        drag_image(&mut scene, &overlay(SurfaceDropAnswer::Copy, 1), 2.0);
        assert_eq!(scene.children(root).len(), 2);
        assert!(
            scene
                .children(root)
                .iter()
                .all(|n| !scene.node(*n).unwrap().hit)
        );
        // Inside the pill, below and right of the pointer at (100, 100).
        assert_eq!(
            desk_compositor::hit_test(&scene, Vec2::new(150.0, 140.0)),
            None
        );
    }

    #[test]
    fn the_drag_images_caption_is_drawn_on_its_pill() {
        let Ok(gpu) = desk_compositor::headless::headless_device() else {
            return;
        };
        let format = desk_compositor::wgpu::TextureFormat::Rgba8Unorm;
        let mut compositor = desk_compositor::Compositor::new(&gpu.device, &gpu.queue, format);
        let mut scene = Scene::new(300, 200);
        drag_image(&mut scene, &overlay(SurfaceDropAnswer::Copy, 1), 1.0);
        let target = desk_compositor::headless::Target::new(&gpu.device, (300, 200), format);
        let stats = compositor.render(&scene, &target.view, target.size);
        let rgba = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
        let light = rgba
            .chunks(4)
            .filter(|p| p[0] > 180 && p[1] > 180 && p[2] > 180)
            .count();
        assert!(stats.glyphs >= 6, "{stats:?}");
        assert!(
            light > 20,
            "the caption's glyphs show white on the pill: {light}"
        );
    }
}
