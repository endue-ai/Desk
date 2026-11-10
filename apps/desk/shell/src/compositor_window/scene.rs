//! The compositor window's scene (compositor mode, #52): the shell page as one surface over the whole
//! window, and each plugin surface's visible parts above it, each part a quad sampling its piece of
//! the surface's texture. The shell page draws the windows' chrome around the frames; a frame's
//! covered parts (windows above it, menus) are left out, so the page shows there.

use desk_compositor::{Rect, Scene, SurfaceNode, TextureId};

use super::layout::{Box, Placed};

/// The quads of one plugin surface: its texture `texture` of `texture_px` pixels at `scale`.
/// Until a frame of the frame's new size arrives the last one is drawn anchored at the top left,
/// cropped or padded, never stretched (`lifecycle.md`).
pub fn pieces(
    placed: &Placed,
    scale: f64,
    texture: TextureId,
    texture_px: (u32, u32),
) -> Vec<SurfaceNode> {
    let rect = placed.rect;
    // The frame may be scaled by a transform (the spread view): the texture covers its layout size.
    let zoom_x = if placed.size.width > 0.0 {
        rect.width / placed.size.width
    } else {
        1.0
    };
    let zoom_y = if placed.size.height > 0.0 {
        rect.height / placed.size.height
    } else {
        1.0
    };
    let (tw, th) = (
        f64::from(texture_px.0.max(1)),
        f64::from(texture_px.1.max(1)),
    );
    // Where the texture ends, in page pixels: past it the page shows (padded).
    let drawn = Box {
        x: rect.x,
        y: rect.y,
        width: tw / scale * zoom_x,
        height: th / scale * zoom_y,
    };
    placed
        .pieces
        .iter()
        .filter_map(|piece| intersect(piece, &drawn))
        .map(|piece| {
            let u = (piece.x - rect.x) / zoom_x * scale / tw;
            let v = (piece.y - rect.y) / zoom_y * scale / th;
            let uw = piece.width / zoom_x * scale / tw;
            let vh = piece.height / zoom_y * scale / th;
            SurfaceNode {
                rect: px(&piece, scale),
                texture,
                uv: Rect::new(u as f32, v as f32, uw as f32, vh as f32),
                opacity: 1.0,
                radius: 0.0,
            }
        })
        .collect()
}

/// In device pixels, rounded out to whole ones: a frame at a fractional place leaves no seam where
/// the page's edge pixel shows through (its texture stretches by under a pixel).
fn px(b: &Box, scale: f64) -> Rect {
    let r = Rect::new(
        (b.x * scale) as f32,
        (b.y * scale) as f32,
        (b.width * scale) as f32,
        (b.height * scale) as f32,
    );
    r.round_out()
}

fn intersect(a: &Box, b: &Box) -> Option<Box> {
    let (x0, y0) = (a.x.max(b.x), a.y.max(b.y));
    let (x1, y1) = (
        (a.x + a.width).min(b.x + b.width),
        (a.y + a.height).min(b.y + b.height),
    );
    (x1 - x0 >= 0.5 && y1 - y0 >= 0.5).then_some(Box {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
    })
}

/// Fill `scene` again: the page `page` over the whole viewport, then `quads`.
pub fn rebuild(scene: &mut Scene, page: Option<TextureId>, quads: &[SurfaceNode]) {
    let root = scene.root();
    for child in scene.children(root).to_vec() {
        let _ = scene.remove(child);
    }
    let (w, h) = scene.viewport();
    if let Some(page) = page {
        let whole = Rect::new(0.0, 0.0, w as f32, h as f32);
        let _ = scene.insert(root, SurfaceNode::new(whole, page));
    }
    for quad in quads {
        let _ = scene.insert(root, *quad);
    }
}

#[cfg(test)]
mod tests {
    use super::{Box, Placed, pieces, rebuild};
    use crate::compositor_window::layout::Size;
    use desk_compositor::{Rect, Scene, TextureId};

    fn frame(pieces: Vec<Box>, rect: Box, size: Size) -> Placed {
        Placed {
            host: "main.a-b".into(),
            src: String::new(),
            loads: 1,
            size,
            rect,
            pieces,
            asleep: false,
        }
    }

    #[test]
    fn each_visible_part_samples_its_own_piece_of_the_texture() {
        let rect = Box {
            x: 100.0,
            y: 50.0,
            width: 400.0,
            height: 300.0,
        };
        let left = Box {
            x: 100.0,
            y: 50.0,
            width: 200.0,
            height: 300.0,
        };
        let placed = frame(
            vec![left],
            rect,
            Size {
                width: 400.0,
                height: 300.0,
            },
        );
        let quads = pieces(&placed, 2.0, TextureId(3), (800, 600));
        assert_eq!(quads.len(), 1);
        assert_eq!(
            quads[0].rect,
            Rect::new(200.0, 100.0, 400.0, 600.0),
            "device pixels"
        );
        assert_eq!(quads[0].uv, Rect::new(0.0, 0.0, 0.5, 1.0));
        assert_eq!(quads[0].texture, TextureId(3));
    }

    #[test]
    fn an_older_smaller_frame_is_drawn_from_the_top_left_and_never_stretched() {
        let rect = Box {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 300.0,
        };
        let placed = frame(
            vec![rect],
            rect,
            Size {
                width: 400.0,
                height: 300.0,
            },
        );
        let quads = pieces(&placed, 2.0, TextureId(1), (400, 600));
        assert_eq!(
            quads[0].rect,
            Rect::new(0.0, 0.0, 400.0, 600.0),
            "half as wide: the rest shows the page"
        );
        assert_eq!(quads[0].uv, Rect::new(0.0, 0.0, 1.0, 1.0));
    }

    #[test]
    fn a_frame_scaled_down_by_the_page_shows_its_whole_texture_in_its_box() {
        let rect = Box {
            x: 10.0,
            y: 10.0,
            width: 200.0,
            height: 150.0,
        };
        let placed = frame(
            vec![rect],
            rect,
            Size {
                width: 400.0,
                height: 300.0,
            },
        );
        let quads = pieces(&placed, 1.0, TextureId(1), (400, 300));
        assert_eq!(quads[0].uv, Rect::new(0.0, 0.0, 1.0, 1.0));
        assert_eq!(quads[0].rect, Rect::new(10.0, 10.0, 200.0, 150.0));
    }

    #[test]
    fn the_page_is_below_every_quad() {
        let mut scene = Scene::new(100, 80);
        let rect = Box {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        let quads = pieces(
            &frame(
                vec![rect],
                rect,
                Size {
                    width: 10.0,
                    height: 10.0,
                },
            ),
            1.0,
            TextureId(2),
            (10, 10),
        );
        rebuild(&mut scene, Some(TextureId(1)), &quads);
        rebuild(&mut scene, Some(TextureId(1)), &quads);
        assert_eq!(
            scene.children(scene.root()).len(),
            2,
            "rebuilt, not added to"
        );
    }
}
