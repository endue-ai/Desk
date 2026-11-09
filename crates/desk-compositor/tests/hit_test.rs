//! Hit testing: property tests over random 2D and 3D transforms under both projections (a point
//! inside a transformed node hits it, a point outside does not, the topmost wins), and the rules
//! for clips and `hit: false`. Pure CPU, no adapter needed.

use desk_compositor::glam::{Mat4, Vec2, Vec3};
use desk_compositor::*;

/// xorshift64*: deterministic cases without a dependency.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 40) as f32 / (1u64 << 24) as f32
    }

    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next()
    }
}

const VIEWPORT: (u32, u32) = (1280, 800);
const CASES: usize = 500;

/// A random placement: move, scale, turn about Z and, sometimes, tilt about X or Y.
fn transform(rng: &mut Rng, tilt: bool) -> Mat4 {
    let center = Vec3::new(rng.range(200.0, 1080.0), rng.range(150.0, 650.0), 0.0);
    let scale = rng.range(0.4, 2.0);
    let turn = Mat4::from_rotation_z(rng.range(-3.1, 3.1));
    let tilt = if tilt {
        Mat4::from_rotation_x(rng.range(-1.0, 1.0)) * Mat4::from_rotation_y(rng.range(-1.0, 1.0))
    } else {
        Mat4::IDENTITY
    };
    Mat4::from_translation(center) * tilt * turn * Mat4::from_scale(Vec3::new(scale, scale, 1.0))
}

fn scene_with(projection: Projection) -> Scene {
    let mut scene = Scene::new(VIEWPORT.0, VIEWPORT.1);
    scene.set_projection(projection);
    scene
}

fn surface(rect: Rect) -> SurfaceNode {
    SurfaceNode::new(rect, TextureId(1))
}

#[test]
fn a_point_inside_a_transformed_surface_hits_it_and_one_outside_does_not() {
    let mut rng = Rng(0x5eed_cafe_f00d_0001);
    let (mut inside_checked, mut outside_checked) = (0, 0);
    for case in 0..CASES {
        let projection = if case % 2 == 0 {
            Projection::Orthographic
        } else {
            Projection::perspective()
        };
        let mut scene = scene_with(projection);
        let group = GroupNode {
            transform: transform(&mut rng, case % 3 != 0),
            ..GroupNode::default()
        };
        let group = scene.insert(scene.root(), group).unwrap();
        let rect = Rect::new(
            rng.range(-150.0, 0.0),
            rng.range(-100.0, 0.0),
            rng.range(60.0, 300.0),
            rng.range(40.0, 200.0),
        );
        let node = scene.insert(group, surface(rect)).unwrap();

        let inside = Vec2::new(
            rng.range(0.05, 0.95) * rect.width,
            rng.range(0.05, 0.95) * rect.height,
        );
        if let Some(screen) = scene.to_screen(node, inside).filter(|p| on_screen(*p)) {
            let hit = hit_test(&scene, screen)
                .unwrap_or_else(|| panic!("case {case}: {inside} at {screen} missed"));
            assert_eq!(hit.node, node, "case {case}");
            assert!(
                (hit.local_point - inside).length() < 0.05 * rect.width.max(rect.height).max(10.0),
                "case {case}: {inside} came back as {}",
                hit.local_point
            );
            inside_checked += 1;
        }

        let outside = match case % 4 {
            0 => Vec2::new(-rng.range(0.05, 0.5) * rect.width, inside.y),
            1 => Vec2::new(rect.width * rng.range(1.05, 1.5), inside.y),
            2 => Vec2::new(inside.x, -rng.range(0.05, 0.5) * rect.height),
            _ => Vec2::new(inside.x, rect.height * rng.range(1.05, 1.5)),
        };
        if let Some(screen) = scene.to_screen(node, outside).filter(|p| on_screen(*p)) {
            assert_eq!(
                hit_test(&scene, screen),
                None,
                "case {case}: {outside} at {screen} hit"
            );
            outside_checked += 1;
        }
    }
    assert!(
        inside_checked > CASES * 9 / 10 && outside_checked > CASES * 3 / 4,
        "{inside_checked} in, {outside_checked} out"
    );
}

#[test]
fn a_flat_translated_scaled_turned_surface_hits_where_the_matrix_says() {
    let mut scene = scene_with(Projection::Orthographic);
    let transform = Mat4::from_translation(Vec3::new(400.0, 300.0, 0.0))
        * Mat4::from_rotation_z(std::f32::consts::FRAC_PI_2)
        * Mat4::from_scale(Vec3::new(2.0, 2.0, 1.0));
    let group = scene
        .insert(
            scene.root(),
            GroupNode {
                transform,
                ..GroupNode::default()
            },
        )
        .unwrap();
    let node = scene
        .insert(group, surface(Rect::new(0.0, 0.0, 100.0, 50.0)))
        .unwrap();
    // Local (10, 5) -> scale (20, 10) -> turn 90° (-10, 20) -> move (390, 320).
    let hit = hit_test(&scene, Vec2::new(390.0, 320.0)).unwrap();
    assert_eq!(hit.node, node);
    assert!(
        (hit.local_point - Vec2::new(10.0, 5.0)).length() < 1e-3,
        "{:?}",
        hit.local_point
    );
    assert_eq!(
        hit_test(&scene, Vec2::new(410.0, 320.0)),
        None,
        "the turn put the surface left of 400"
    );
}

#[test]
fn the_topmost_of_overlapping_nodes_wins() {
    let mut rng = Rng(0x0dd5_eed5_0000_0002);
    for case in 0..CASES {
        let projection = if case % 2 == 0 {
            Projection::Orthographic
        } else {
            Projection::perspective()
        };
        let mut scene = scene_with(projection);
        let root = scene.root();
        let shared = transform(&mut rng, case % 3 == 0);
        let mut ids = Vec::new();
        for _ in 0..3 {
            let group = scene
                .insert(
                    root,
                    GroupNode {
                        transform: shared,
                        ..GroupNode::default()
                    },
                )
                .unwrap();
            ids.push(
                scene
                    .insert(group, surface(Rect::new(-50.0, -50.0, 100.0, 100.0)))
                    .unwrap(),
            );
        }
        let Some(screen) = scene
            .to_screen(ids[0], Vec2::new(50.0, 50.0))
            .filter(|p| on_screen(*p))
        else {
            continue;
        };
        assert_eq!(
            hit_test(&scene, screen).map(|h| h.node),
            Some(ids[2]),
            "case {case}: last child on top"
        );
        let first_group = scene.parent(ids[0]).unwrap();
        scene.reorder(first_group, 2).unwrap();
        assert_eq!(
            hit_test(&scene, screen).map(|h| h.node),
            Some(ids[0]),
            "case {case}: reordered to the top"
        );
    }
}

#[test]
fn hit_false_lets_the_pointer_through_to_the_node_below() {
    let mut scene = scene_with(Projection::Orthographic);
    let root = scene.root();
    let below = scene
        .insert(root, surface(Rect::new(0.0, 0.0, 100.0, 100.0)))
        .unwrap();
    let overlay: Node = RectNode::new(Rect::new(0.0, 0.0, 100.0, 100.0), Color::WHITE).into();
    let overlay = scene.insert(root, overlay.with_hit(false)).unwrap();
    let p = Vec2::new(50.0, 50.0);
    assert_eq!(hit_test(&scene, p).map(|h| h.node), Some(below));
    let inert: Node = GroupNode::default().into();
    let inert = scene.insert(root, inert.with_hit(false)).unwrap();
    scene
        .insert(inert, surface(Rect::new(0.0, 0.0, 100.0, 100.0)))
        .unwrap();
    assert_eq!(
        hit_test(&scene, p).map(|h| h.node),
        Some(below),
        "a whole subtree passes through"
    );
    let active: Node = RectNode::new(Rect::new(0.0, 0.0, 100.0, 100.0), Color::WHITE).into();
    scene.set(overlay, active).unwrap();
    assert_eq!(
        hit_test(&scene, p).map(|h| h.node),
        Some(overlay),
        "the overlay takes the pointer while active"
    );
}

#[test]
fn a_clip_hides_what_it_cuts_from_hit_testing_too() {
    let mut scene = scene_with(Projection::Orthographic);
    let root = scene.root();
    let below = scene
        .insert(root, surface(Rect::new(0.0, 0.0, 400.0, 400.0)))
        .unwrap();
    let clip = GroupNode {
        clip: Some(Rect::new(0.0, 0.0, 50.0, 50.0)),
        ..GroupNode::translated(100.0, 100.0)
    };
    let clipped = scene.insert(root, clip).unwrap();
    let inner = scene
        .insert(clipped, surface(Rect::new(0.0, 0.0, 200.0, 200.0)))
        .unwrap();
    let hit = hit_test(&scene, Vec2::new(120.0, 130.0)).unwrap();
    assert_eq!(hit.node, inner);
    assert!(
        (hit.local_point - Vec2::new(20.0, 30.0)).length() < 1e-3,
        "{:?}",
        hit.local_point
    );
    assert_eq!(
        hit_test(&scene, Vec2::new(170.0, 130.0)).map(|h| h.node),
        Some(below),
        "cut off by the clip"
    );
    assert_eq!(
        hit_test(&scene, Vec2::new(500.0, 500.0)),
        None,
        "the wallpaper is never hit"
    );
}

#[test]
fn degenerate_and_edge_on_nodes_are_never_hit() {
    let mut scene = scene_with(Projection::perspective());
    let root = scene.root();
    let flat = GroupNode {
        transform: Mat4::from_scale(Vec3::new(0.0, 1.0, 1.0)),
        ..GroupNode::default()
    };
    let flat = scene.insert(root, flat).unwrap();
    scene
        .insert(flat, surface(Rect::new(0.0, 0.0, 1280.0, 800.0)))
        .unwrap();
    let edge_on = Mat4::from_translation(Vec3::new(640.0, 400.0, 0.0))
        * Mat4::from_rotation_y(std::f32::consts::FRAC_PI_2);
    let edge_on = scene
        .insert(
            root,
            GroupNode {
                transform: edge_on,
                ..GroupNode::default()
            },
        )
        .unwrap();
    scene
        .insert(edge_on, surface(Rect::new(-100.0, -100.0, 200.0, 200.0)))
        .unwrap();
    assert_eq!(hit_test(&scene, Vec2::new(640.0, 400.0)), None);
    assert_eq!(hit_test(&scene, Vec2::new(10.0, 10.0)), None);
}

fn on_screen(p: Vec2) -> bool {
    p.x > 1.0 && p.y > 1.0 && p.x < VIEWPORT.0 as f32 - 1.0 && p.y < VIEWPORT.1 as f32 - 1.0
}
