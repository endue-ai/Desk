//! A window at rest shows its page as the page rendered it (#250, ADR 0209): a texture that maps
//! one texel to one device pixel lands on whole pixels wherever its window was dropped, at every
//! display scale, and each pixel is its texel exactly; a part cut from a texture shows that part
//! and nothing next to it; a window on its way is filtered where it is; and a window's content
//! keeps inside its rounded corners.

mod support;

use desk_compositor::glam::{Mat4, Vec3};
use desk_compositor::headless::upload_rgba;
use desk_compositor::*;
use support::{gpu, pixel, render};

const SCALES: [f32; 4] = [1.0, 1.25, 1.5, 2.0];
/// Places a drag, a pan or a glide leaves, in CSS pixels.
const PLACES: [(f32, f32); 4] = [(10.4, 20.6), (33.3, 7.7), (0.5, 0.5), (12.75, 3.25)];
/// The window's size in CSS pixels, and the screen's.
const WINDOW: (f32, f32) = (64.0, 40.0);
const SCREEN: (f32, f32) = (128.0, 80.0);
const WALL: [u8; 4] = [16, 32, 48, 255];

/// Opaque noise: any filtering, any texel off by one, shows.
fn noise(size: (u32, u32)) -> Vec<u8> {
    let mut state = 0x2545_f491_u32;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state
    };
    (0..size.0 * size.1)
        .flat_map(|_| {
            let [r, g, b, _] = next().to_le_bytes();
            [r, g, b, 255]
        })
        .collect()
}

fn texel(rgba: &[u8], size: (u32, u32), x: u32, y: u32) -> [u8; 4] {
    pixel(rgba, size.0, x, y)
}

/// A desk at `scale`: one group from CSS pixels to device pixels, as the shell's, holding a
/// window's group at `at` with `surface` in it.
fn desk(scale: f32, at: (f32, f32), surface: SurfaceNode) -> Scene {
    let size = ((SCREEN.0 * scale) as u32, (SCREEN.1 * scale) as u32);
    let mut scene = Scene::new(size.0, size.1);
    scene.set_wallpaper(Wallpaper::Solid(Color::rgba8(16, 32, 48, 255)));
    let css = GroupNode {
        transform: Mat4::from_scale(Vec3::new(scale, scale, 1.0)),
        ..GroupNode::default()
    };
    let root = scene.root();
    let desk = scene.insert(root, css).unwrap();
    let window = scene
        .insert(desk, GroupNode::translated(at.0, at.1))
        .unwrap();
    scene.insert(window, surface).unwrap();
    scene
}

/// Where in the frame the texture's texel (0, 0) sits, if every pixel of the `cut`-texel part
/// from `first` shows its texel exactly within a pixel of `near`.
fn found(
    frame: &[u8],
    width: u32,
    texture: (&[u8], (u32, u32)),
    (first, cut): ((u32, u32), (u32, u32)),
    near: (f32, f32),
) -> Option<(i32, i32)> {
    let (rgba, size) = texture;
    let candidates = (-1..=1).flat_map(|dy| (-1..=1).map(move |dx| (dx, dy)));
    candidates
        .map(|(dx, dy)| (near.0.round() as i32 + dx, near.1.round() as i32 + dy))
        .find(|(ox, oy)| {
            (first.1..first.1 + cut.1).all(|ty| {
                (first.0..first.0 + cut.0).all(|tx| {
                    let (x, y) = (*ox + tx as i32, *oy + ty as i32);
                    x >= 0
                        && y >= 0
                        && pixel(frame, width, x as u32, y as u32) == texel(rgba, size, tx, ty)
                })
            })
        })
}

#[test]
fn a_window_dropped_at_a_fraction_shows_its_page_pixel_for_pixel_at_every_scale() {
    let Some(gpu) = gpu("a_window_dropped_at_a_fraction") else {
        return;
    };
    for scale in SCALES {
        let size = (
            (WINDOW.0 * scale).round() as u32,
            (WINDOW.1 * scale).round() as u32,
        );
        let page = noise(size);
        let texture = upload_rgba(&gpu.device, &gpu.queue, size, &page);
        for at in PLACES {
            let surface = SurfaceNode::new(Rect::new(0.0, 0.0, WINDOW.0, WINDOW.1), TextureId(1));
            let scene = desk(scale, at, surface);
            let frame = render(&gpu, &scene, &[(TextureId(1), &texture)]);
            let width = scene.viewport().0;
            let near = (at.0 * scale, at.1 * scale);
            let whole = ((0, 0), size);
            let origin = found(&frame, width, (&page, size), whole, near);
            assert!(
                origin.is_some(),
                "scale {scale}, dropped at {at:?}: the page's pixels are not all there as rendered"
            );
        }
    }
}

#[test]
fn a_part_cut_from_a_page_shows_that_part_and_nothing_beside_it() {
    let Some(gpu) = gpu("a_part_cut_from_a_page") else {
        return;
    };
    for scale in SCALES {
        let size = (
            (SCREEN.0 * scale).round() as u32,
            (SCREEN.1 * scale).round() as u32,
        );
        let page = noise(size);
        let texture = upload_rgba(&gpu.device, &gpu.queue, size, &page);
        // A title bar's piece of the page: from CSS (13, 7), 30 × 10, drawn at a fraction.
        let (from, part) = ((13.0, 7.0), (30.0, 10.0));
        let (tw, th) = (size.0 as f32, size.1 as f32);
        let uv = Rect::new(
            from.0 * scale / tw,
            from.1 * scale / th,
            part.0 * scale / tw,
            part.1 * scale / th,
        );
        let at = (40.3, 21.6);
        let surface = SurfaceNode {
            uv,
            ..SurfaceNode::new(Rect::new(0.0, 0.0, part.0, part.1), TextureId(2))
        };
        let scene = desk(scale, at, surface);
        let frame = render(&gpu, &scene, &[(TextureId(2), &texture)]);
        let width = scene.viewport().0;
        // Every texel the part wholly covers is there as rendered; one it cuts through lands on
        // a pixel of its own or none.
        let edges = |a: f32, len: f32| ((a * scale).ceil() as u32, ((a + len) * scale) as u32);
        let ((x0, x1), (y0, y1)) = (edges(from.0, part.0), edges(from.1, part.1));
        let first = (x0, y0);
        let cut = (x1 - x0, y1 - y0);
        let near = (at.0 * scale - from.0 * scale, at.1 * scale - from.1 * scale);
        let origin = found(&frame, width, (&page, size), (first, cut), near);
        let Some((ox, oy)) = origin else {
            panic!("scale {scale}: the part's pixels are not there as rendered");
        };
        // The texel left of the part and the one above it: never drawn, the wallpaper there.
        let outside = |a: f32| (a * scale).floor() as i32 - 1;
        let left = (ox + outside(from.0)) as u32;
        let above = (oy + outside(from.1)) as u32;
        let mid = (oy + (y0 + cut.1 / 2) as i32) as u32;
        assert_eq!(
            pixel(&frame, width, left, mid),
            WALL,
            "scale {scale}: bled left"
        );
        let centre = (ox + (x0 + cut.0 / 2) as i32) as u32;
        assert_eq!(
            pixel(&frame, width, centre, above),
            WALL,
            "scale {scale}: bled up"
        );
    }
}

#[test]
fn a_window_on_its_way_is_filtered_where_it_is() {
    let Some(gpu) = gpu("a_window_on_its_way") else {
        return;
    };
    let size = (WINDOW.0 as u32, WINDOW.1 as u32);
    let page = noise(size);
    let texture = upload_rgba(&gpu.device, &gpu.queue, size, &page);
    let surface = SurfaceNode {
        whole_pixels: false,
        ..SurfaceNode::new(Rect::new(0.0, 0.0, WINDOW.0, WINDOW.1), TextureId(3))
    };
    let scene = desk(1.0, (10.5, 20.5), surface);
    let frame = render(&gpu, &scene, &[(TextureId(3), &texture)]);
    let width = scene.viewport().0;
    let found = found(&frame, width, (&page, size), ((0, 0), size), (10.5, 20.5));
    assert_eq!(
        found, None,
        "half a pixel off, it blends: it moves smoothly"
    );
}

#[test]
fn a_windows_content_keeps_inside_its_rounded_bottom_corners() {
    let Some(gpu) = gpu("a_windows_content_keeps_inside") else {
        return;
    };
    for scale in SCALES {
        let size = (
            (WINDOW.0 * scale).round() as u32,
            (WINDOW.1 * scale).round() as u32,
        );
        let red = [230u8, 20, 20, 255];
        let page: Vec<u8> = (0..size.0 * size.1).flat_map(|_| red).collect();
        let texture = upload_rgba(&gpu.device, &gpu.queue, size, &page);
        let surface = SurfaceNode {
            radius: 12.0,
            corners: Corners::BOTTOM,
            ..SurfaceNode::new(Rect::new(0.0, 0.0, WINDOW.0, WINDOW.1), TextureId(4))
        };
        let at = (20.4, 10.6);
        let scene = desk(scale, at, surface);
        let frame = render(&gpu, &scene, &[(TextureId(4), &texture)]);
        let width = scene.viewport().0;
        let (x0, y0) = ((at.0 * scale).round() as u32, (at.1 * scale).round() as u32);
        let (x1, y1) = (x0 + size.0 - 1, y0 + size.1 - 1);
        for corner in [(x0, y1), (x1, y1)] {
            let got = pixel(&frame, width, corner.0, corner.1);
            assert_eq!(
                got, WALL,
                "scale {scale}: content past the bottom corner {corner:?}"
            );
        }
        for corner in [(x0, y0), (x1, y0)] {
            let got = pixel(&frame, width, corner.0, corner.1);
            assert_eq!(
                got, red,
                "scale {scale}: the top corner {corner:?} is the title bar's"
            );
        }
    }
}
