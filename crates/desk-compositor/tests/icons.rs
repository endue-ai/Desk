//! Line icons as textures (the canvas map's windows, ADR 0273): made once per path, size and
//! colour, drawn like any surface, and let go once nobody asks for them.

use desk_compositor::headless::{Target, headless_device};
use desk_compositor::{
    Color, Compositor, ICON_IDS, Icons, Rect, Scene, SurfaceNode, TextureId, Wallpaper,
};

/// A box with a line across it, as `shell/icons.ts` writes paths.
const BOX: &str = "M4 4h16v16H4zM4 12h16";

fn compositor() -> Compositor {
    let gpu = headless_device().expect("a GPU or its fallback");
    Compositor::new(
        &gpu.device,
        &gpu.queue,
        desk_compositor::wgpu::TextureFormat::Rgba8Unorm,
    )
}

#[test]
fn an_icon_is_made_once_and_let_go_when_nobody_asks_for_it() {
    let mut compositor = compositor();
    let mut icons = Icons::new();
    let ink = Color::rgba8(0x40, 0x3d, 0x37, 0xff);
    let first = icons.icon(&mut compositor, BOX, 32, ink).unwrap();
    assert!(first.0 > ICON_IDS, "{first:?}");
    assert_eq!(icons.icon(&mut compositor, BOX, 32, ink), Some(first));
    let larger = icons.icon(&mut compositor, BOX, 48, ink).unwrap();
    let accent = icons.icon(&mut compositor, BOX, 32, Color::WHITE).unwrap();
    assert_eq!(
        [first, larger, accent]
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        3
    );
    assert_eq!(icons.icon(&mut compositor, "M100 100h1", 32, ink), None);
    let resident = compositor.textures_resident();
    icons.sweep(&mut compositor);
    assert_eq!(icons.len(), 4, "all asked for since the last sweep");
    // Only the first asked for again: the others go, their textures with them.
    assert_eq!(icons.icon(&mut compositor, BOX, 32, ink), Some(first));
    icons.sweep(&mut compositor);
    assert_eq!(icons.len(), 1);
    assert_eq!(compositor.textures_resident(), resident - 2);
    icons.sweep(&mut compositor);
    assert!(icons.is_empty());
}

#[test]
fn an_icon_draws_its_strokes_in_its_colour_over_what_lies_under_it() {
    let mut compositor = compositor();
    let mut icons = Icons::new();
    let red = Color::new(1.0, 0.0, 0.0, 1.0);
    let icon: TextureId = icons.icon(&mut compositor, BOX, 24, red).unwrap();
    let mut scene = Scene::new(24, 24);
    scene.set_wallpaper(Wallpaper::Solid(Color::BLACK));
    let whole = Rect::new(0.0, 0.0, 24.0, 24.0);
    scene
        .insert(scene.root(), SurfaceNode::new(whole, icon))
        .unwrap();
    let target = Target::new(compositor.device(), (24, 24), compositor.format());
    assert!(compositor.render(&scene, &target.view, target.size).drawn);
    let rgba = target
        .read_rgba(compositor.device(), compositor.queue())
        .unwrap();
    let at = |x: usize, y: usize| &rgba[(y * 24 + x) * 4..(y * 24 + x) * 4 + 4];
    // On the line across the middle, red; inside the box away from its strokes, the black under it.
    assert_eq!(at(12, 12), [255, 0, 0, 255]);
    assert_eq!(at(8, 8), [0, 0, 0, 255]);
}
