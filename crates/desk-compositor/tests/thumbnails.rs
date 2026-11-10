//! Downscaled textures and what reads a texture back (#54): a thumbnail is a box filter of its
//! source however small, and is drawn again only when the source changed; a texture reads back
//! whole as straight RGBA, or bounded through a thumbnail (`ui.surface.snapshot`); a surface drawn
//! grey is its luminance. Then the canvas map and a sleeping window as the shell draws them: the
//! map's windows from their thumbnails, and the sleeping window's last frame greyed under its card
//! with Reload.

mod support;

use desk_compositor::headless::{Headless, Target, upload_rgba};
use desk_compositor::*;
use support::{FORMAT, assert_snapshot, checker, compositor, gpu, gradient, look, near, pixel};

const SOURCE: (u32, u32) = (256, 160);

fn texture(gpu: &Headless, size: (u32, u32), rgba: &[u8]) -> wgpu::Texture {
    upload_rgba(&gpu.device, &gpu.queue, size, rgba)
}

#[test]
fn a_thumbnail_is_a_box_filter_of_its_source_however_small() {
    let Some(gpu) = gpu("a_thumbnail_is_a_box_filter_of_its_source_however_small") else {
        return;
    };
    let mut compositor = compositor(&gpu);
    // One-pixel squares: any single bilinear pass from full size lands on whole black or white.
    let fine = checker(SOURCE, 1, [0, 0, 0, 255], [255, 255, 255, 255]);
    let source = texture(&gpu, SOURCE, &fine);
    compositor.register_texture(TextureId(1), &source);
    let mut thumbnails = Thumbnails::new();
    let id = thumbnails.refresh(&mut compositor, TextureId(1), SOURCE, (20, 12));
    assert!(id.0 > THUMBNAIL_IDS, "an id of the high range");
    assert_eq!(thumbnails.of(TextureId(1)), Some(id));
    let ((w, h), rgba) = thumbnails.read(&compositor, TextureId(1)).unwrap().unwrap();
    assert_eq!((w, h), (20, 12));
    for y in 0..h {
        for x in 0..w {
            let px = pixel(&rgba, w, x, y);
            assert!(near(px, [128, 128, 128, 255]), "({x}, {y}): {px:?}");
        }
    }
    thumbnails.retain(&mut compositor, |_| false);
    assert!(thumbnails.is_empty());
    assert_eq!(compositor.textures_resident(), 1, "its passes went");
}

#[test]
fn a_thumbnail_is_drawn_again_only_when_its_source_changed() {
    let Some(gpu) = gpu("a_thumbnail_is_drawn_again_only_when_its_source_changed") else {
        return;
    };
    let mut compositor = compositor(&gpu);
    let red = [220u8, 40, 40, 255].repeat((SOURCE.0 * SOURCE.1) as usize);
    let source = texture(&gpu, SOURCE, &red);
    compositor.register_texture(TextureId(1), &source);
    let mut thumbnails = Thumbnails::new();
    let id = thumbnails.refresh(&mut compositor, TextureId(1), SOURCE, (32, 20));
    let first = thumbnails
        .read(&compositor, TextureId(1))
        .unwrap()
        .unwrap()
        .1;
    // New pixels the compositor was not told of: the passes are not drawn again.
    let blue = [40u8, 40, 220, 255].repeat((SOURCE.0 * SOURCE.1) as usize);
    gpu.queue.write_texture(
        source.as_image_copy(),
        &blue,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(SOURCE.0 * 4),
            rows_per_image: Some(SOURCE.1),
        },
        wgpu::Extent3d {
            width: SOURCE.0,
            height: SOURCE.1,
            depth_or_array_layers: 1,
        },
    );
    assert_eq!(
        thumbnails.refresh(&mut compositor, TextureId(1), SOURCE, (32, 20)),
        id
    );
    let unchanged = thumbnails
        .read(&compositor, TextureId(1))
        .unwrap()
        .unwrap()
        .1;
    assert_eq!(first, unchanged);
    // Told, as a surface's every paint tells it: drawn again.
    compositor.update_texture(TextureId(1), &source);
    thumbnails.refresh(&mut compositor, TextureId(1), SOURCE, (32, 20));
    let now = thumbnails
        .read(&compositor, TextureId(1))
        .unwrap()
        .unwrap()
        .1;
    assert!(
        near(pixel(&now, 32, 10, 10), [40, 40, 220, 255]),
        "{:?}",
        &now[..4]
    );
}

#[test]
fn a_texture_reads_back_whole_or_bounded_with_straight_alpha() {
    let Some(gpu) = gpu("a_texture_reads_back_whole_or_bounded_with_straight_alpha") else {
        return;
    };
    let mut compositor = compositor(&gpu);
    let ramp = gradient(SOURCE);
    let mut half = ramp.clone();
    // A premultiplied half-transparent white in the top left corner.
    half[..4].copy_from_slice(&[128, 128, 128, 128]);
    let source = texture(&gpu, SOURCE, &half);
    compositor.register_texture(TextureId(7), &source);
    let (size, rgba) = read_texture(&mut compositor, TextureId(7), SOURCE, (None, None)).unwrap();
    assert_eq!(size, SOURCE);
    assert!(near(pixel(&rgba, SOURCE.0, 0, 0), [255, 255, 255, 128]));
    assert!(near(
        pixel(&rgba, SOURCE.0, 200, 100),
        pixel(&ramp, SOURCE.0, 200, 100)
    ));
    let (bounded, small) =
        read_texture(&mut compositor, TextureId(7), SOURCE, (Some(64), None)).unwrap();
    assert_eq!((bounded, small.len()), ((64, 40), 64 * 40 * 4));
    assert_eq!(compositor.textures_resident(), 1, "nothing kept for a read");
}

#[test]
fn a_surface_drawn_grey_is_its_luminance() {
    let Some(gpu) = gpu("a_surface_drawn_grey_is_its_luminance") else {
        return;
    };
    let mut compositor = compositor(&gpu);
    let red = [255u8, 0, 0, 255].repeat(64);
    let source = texture(&gpu, (8, 8), &red);
    compositor.register_texture(TextureId(1), &source);
    let mut scene = Scene::new(32, 16);
    let root = scene.root();
    let at = |x| Rect::new(x, 0.0, 16.0, 16.0);
    scene
        .insert(root, SurfaceNode::new(at(0.0), TextureId(1)))
        .unwrap();
    let grey = SurfaceNode {
        grey: 1.0,
        ..SurfaceNode::new(at(16.0), TextureId(1))
    };
    scene.insert(root, grey).unwrap();
    let target = Target::new(&gpu.device, (32, 16), FORMAT);
    compositor.render(&scene, &target.view, target.size);
    let rgba = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    assert!(near(pixel(&rgba, 32, 8, 8), [255, 0, 0, 255]));
    assert!(
        near(pixel(&rgba, 32, 24, 8), [54, 54, 54, 255]),
        "{:?}",
        pixel(&rgba, 32, 24, 8)
    );
}

/// The canvas map open in the bottom right of a 640 by 400 app at 0.75 device pixels each, two
/// windows in it from their thumbnails (the focused one marked) and the part in sight; over the
/// desk a window whose frame sleeps: its last frame greyed, its card over it with Reload.
#[test]
fn the_canvas_map_and_a_sleeping_window() {
    let Some(gpu) = gpu("the_canvas_map_and_a_sleeping_window") else {
        return;
    };
    let size = (480, 300);
    let mut compositor = compositor(&gpu);
    let theme = ChromeTheme::from_tokens(&look(""));
    let frames = [
        gradient(SOURCE),
        checker(SOURCE, 16, [60, 130, 220, 255], [250, 250, 250, 255]),
    ];
    let sources: Vec<wgpu::Texture> = frames.iter().map(|f| texture(&gpu, SOURCE, f)).collect();
    for (i, t) in sources.iter().enumerate() {
        compositor.register_texture(TextureId(1 + i as u64), t);
    }
    let mut thumbnails = Thumbnails::new();
    let thumbs: Vec<TextureId> = (1..=2)
        .map(|i| thumbnails.refresh(&mut compositor, TextureId(i), SOURCE, (36, 22)))
        .collect();
    let mut scene = Scene::new(size.0, size.1);
    scene.set_wallpaper(Wallpaper::Solid(theme.wallpaper));
    let mut chrome = Chrome::new(theme);
    let desk = GroupNode {
        transform: glam::Mat4::from_scale(glam::Vec3::new(0.75, 0.75, 1.0)),
        ..GroupNode::default()
    };
    let desk = scene.root_insert(desk);
    let window = chrome
        .window(
            &mut scene,
            desk,
            Rect::new(40.0, 40.0, 360.0, 240.0),
            "Notes",
            None,
            false,
        )
        .unwrap();
    let last = SurfaceNode {
        grey: 1.0,
        ..SurfaceNode::new(window.content, TextureId(2))
    };
    scene.insert(window.group, last).unwrap();
    let line = "Unloaded while out of sight. It loads again when shown.";
    chrome
        .sleeping_card(
            &mut scene,
            window.group,
            window.content,
            "Notes",
            line,
            &["Reload"],
        )
        .unwrap();
    // The map: 192 by 120 inside 4 px of padding, 70 px from the right and 64 from the bottom.
    let canvas = Rect::new(
        640.0 - 70.0 - 4.0 - 192.0,
        400.0 - 64.0 - 4.0 - 120.0,
        192.0,
        120.0,
    );
    let outer = canvas.inflate(4.0);
    chrome.map(&mut scene, desk, outer, canvas, false).unwrap();
    for (i, (x, y, focused)) in [(10.0, 30.0, true), (100.0, 50.0, false)]
        .iter()
        .enumerate()
    {
        let at = Rect::new(canvas.x + x, canvas.y + y, 60.0, 40.0);
        chrome
            .map_window(&mut scene, desk, at, *focused, false)
            .unwrap();
        scene.insert(desk, SurfaceNode::new(at, thumbs[i])).unwrap();
        chrome
            .map_window(&mut scene, desk, at, *focused, true)
            .unwrap();
    }
    let view = Rect::new(canvas.x + 4.0, canvas.y + 20.0, 120.0, 76.0);
    chrome.map_view(&mut scene, desk, view).unwrap();
    let target = Target::new(&gpu.device, size, FORMAT);
    let stats = compositor.render(&scene, &target.view, target.size);
    assert!(stats.drawn && stats.missing_textures == 0, "{stats:?}");
    assert_eq!(stats.missing_glyphs, 0, "{stats:?}");
    let rgba = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    assert_snapshot(&gpu, "map_and_asleep", size, &rgba);
}

/// `scene.insert(scene.root(), node)`, for the tests above.
trait RootInsert {
    fn root_insert(&mut self, node: GroupNode) -> NodeId;
}

impl RootInsert for Scene {
    fn root_insert(&mut self, node: GroupNode) -> NodeId {
        let root = self.root();
        self.insert(root, node).unwrap()
    }
}
