//! The render loop on a real adapter: frames are drawn on damage or while something animates and
//! skipped otherwise, the stats say what happened, textures damage the surfaces showing them, and
//! draw order follows the children's order.

mod support;

use desk_compositor::headless::{Target, upload_rgba};
use desk_compositor::*;
use support::{FORMAT, checker, gpu, near, pixel};

const RED: [u8; 4] = [255, 0, 0, 255];
const GREEN: [u8; 4] = [0, 255, 0, 255];

#[test]
fn draws_on_damage_and_skips_when_nothing_changed() {
    let Some(gpu) = gpu("draws_on_damage_and_skips_when_nothing_changed") else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let target = Target::new(&gpu.device, (200, 100), FORMAT);
    let mut scene = Scene::new(200, 100);
    let rect = scene
        .insert(
            scene.root(),
            RectNode::new(Rect::new(10.0, 10.0, 20.0, 20.0), Color::WHITE),
        )
        .unwrap();

    let first = compositor.render(&scene, &target.view, target.size);
    assert!(first.drawn && !first.animating);
    assert_eq!(
        first.damage,
        Some(Rect::new(0.0, 0.0, 200.0, 100.0)),
        "the first frame is all damage"
    );
    assert_eq!((first.nodes_drawn, first.draw_calls), (1, 1));

    let idle = compositor.render(&scene, &target.view, target.size);
    assert!(!idle.drawn, "nothing changed");
    assert_eq!(
        (idle.damage, idle.nodes_drawn, idle.draw_calls),
        (None, 0, 0)
    );

    scene
        .set(
            rect,
            RectNode::new(Rect::new(50.0, 10.0, 20.0, 20.0), Color::WHITE),
        )
        .unwrap();
    let moved = compositor.render(&scene, &target.view, target.size);
    assert!(moved.drawn);
    assert_eq!(
        moved.damage,
        Some(Rect::new(9.0, 9.0, 62.0, 22.0)),
        "old and new place"
    );
    assert!(!compositor.render(&scene, &target.view, target.size).drawn);

    let bigger = Target::new(&gpu.device, (300, 100), FORMAT);
    scene.resize(300, 100);
    let resized = compositor.render(&scene, &bigger.view, bigger.size);
    assert_eq!(resized.damage, Some(Rect::new(0.0, 0.0, 300.0, 100.0)));
    compositor.invalidate();
    assert!(
        compositor.render(&scene, &bigger.view, bigger.size).drawn,
        "invalidate forces a frame"
    );
}

#[test]
fn an_animating_node_keeps_frames_coming_until_it_stops() {
    let Some(gpu) = gpu("an_animating_node_keeps_frames_coming_until_it_stops") else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let target = Target::new(&gpu.device, (100, 100), FORMAT);
    let mut scene = Scene::new(100, 100);
    let live = scene
        .insert(
            scene.root(),
            RectNode::new(Rect::new(0.0, 0.0, 10.0, 10.0), Color::WHITE),
        )
        .unwrap();
    compositor.render(&scene, &target.view, target.size);
    scene.set_animating(live, true).unwrap();
    for _ in 0..3 {
        let frame = compositor.render(&scene, &target.view, target.size);
        assert!(frame.drawn && frame.animating);
        assert_eq!(frame.damage, Some(Rect::new(0.0, 0.0, 11.0, 11.0)));
    }
    scene.set_animating(live, false).unwrap();
    assert!(!compositor.render(&scene, &target.view, target.size).drawn);
}

#[test]
fn texture_changes_damage_the_surfaces_showing_them() {
    let Some(gpu) = gpu("texture_changes_damage_the_surfaces_showing_them") else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let target = Target::new(&gpu.device, (100, 100), FORMAT);
    let red = upload_rgba(
        &gpu.device,
        &gpu.queue,
        (4, 4),
        &checker((4, 4), 4, RED, RED),
    );
    let green = upload_rgba(
        &gpu.device,
        &gpu.queue,
        (4, 4),
        &checker((4, 4), 4, GREEN, GREEN),
    );
    let mut scene = Scene::new(100, 100);
    let shown = SurfaceNode::new(Rect::new(20.0, 20.0, 40.0, 40.0), TextureId(5));
    scene.insert(scene.root(), shown).unwrap();
    compositor.register_texture(TextureId(5), &red);
    compositor.register_texture(TextureId(6), &green);
    let first = compositor.render(&scene, &target.view, target.size);
    assert_eq!((first.nodes_drawn, first.textures_resident), (1, 2));
    let read = |target: &Target| target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    assert!(near(pixel(&read(&target), 100, 40, 40), RED));

    compositor.update_texture(TextureId(6), &green);
    assert!(
        !compositor.render(&scene, &target.view, target.size).drawn,
        "no surface shows texture 6"
    );

    compositor.update_texture(TextureId(5), &red);
    let repaint = compositor.render(&scene, &target.view, target.size);
    assert_eq!(
        repaint.damage,
        Some(Rect::new(19.0, 19.0, 42.0, 42.0)),
        "a paint into the same texture"
    );

    compositor.update_texture(TextureId(5), &green);
    compositor.render(&scene, &target.view, target.size);
    assert!(
        near(pixel(&read(&target), 100, 40, 40), GREEN),
        "a new texture for the same id"
    );

    compositor.remove_texture(TextureId(5));
    let gone = compositor.render(&scene, &target.view, target.size);
    assert!(gone.drawn);
    assert_eq!(
        (
            gone.nodes_drawn,
            gone.missing_textures,
            gone.textures_resident
        ),
        (0, 1, 1)
    );
}

#[test]
fn draw_order_follows_the_children_and_reorder_changes_it() {
    let Some(gpu) = gpu("draw_order_follows_the_children_and_reorder_changes_it") else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let target = Target::new(&gpu.device, (100, 100), FORMAT);
    let mut scene = Scene::new(100, 100);
    let root = scene.root();
    let fill = |c: [u8; 4]| Color::rgba8(c[0], c[1], c[2], c[3]);
    let red = scene
        .insert(
            root,
            RectNode::new(Rect::new(0.0, 0.0, 60.0, 60.0), fill(RED)),
        )
        .unwrap();
    scene
        .insert(
            root,
            RectNode::new(Rect::new(40.0, 40.0, 60.0, 60.0), fill(GREEN)),
        )
        .unwrap();
    compositor.render(&scene, &target.view, target.size);
    let read = || target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    assert!(
        near(pixel(&read(), 100, 50, 50), GREEN),
        "the later child is on top"
    );
    scene.reorder(red, 1).unwrap();
    assert!(compositor.render(&scene, &target.view, target.size).drawn);
    assert!(
        near(pixel(&read(), 100, 50, 50), RED),
        "reordered to the top"
    );
}

#[test]
fn many_items_grow_the_uniform_buffer() {
    let Some(gpu) = gpu("many_items_grow_the_uniform_buffer") else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let target = Target::new(&gpu.device, (200, 200), FORMAT);
    let mut scene = Scene::new(200, 200);
    for i in 0..300 {
        let (x, y) = ((i % 20) as f32 * 10.0, (i / 20) as f32 * 10.0);
        let colour = if i == 299 {
            Color::rgba8(0, 255, 0, 255)
        } else {
            Color::WHITE
        };
        scene
            .insert(
                scene.root(),
                RectNode::new(Rect::new(x, y, 8.0, 8.0), colour),
            )
            .unwrap();
    }
    let stats = compositor.render(&scene, &target.view, target.size);
    assert_eq!((stats.nodes_drawn, stats.draw_calls), (300, 300));
    let rgba = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    assert!(
        near(pixel(&rgba, 200, 194, 144), GREEN),
        "the last item drew from its own slot"
    );
}
