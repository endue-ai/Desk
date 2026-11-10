//! Hit testing as properties (#58, proptest), each against an oracle of its own rather than the
//! scene's matrices: chains of nested, clipped groups whose hit point is the inverse of their
//! transforms worked out in f64; nesting that hits exactly as one group of the product does, under
//! both projections and tilted in 3D; and `with_hit(false)` nodes that never take the pointer and
//! never hide what is under them. Pure CPU. The seed is fixed (`PROPTEST_RNG_SEED` picks another;
//! `PROPTEST_CASES` runs more), and failures are not written back into the tree.

use desk_compositor::glam::{DAffine2, DVec2, Mat4, Quat, Vec2, Vec3};
use desk_compositor::*;
use proptest::prelude::*;
use proptest::test_runner::RngSeed;

const VIEWPORT: (u32, u32) = (1280, 800);
const SEED: u64 = 0x0058_c0de_5eed;
/// How close two local points must be, in a node's own units (rects are 20 to 400 units wide).
const NEAR: f64 = 0.05;

fn config() -> ProptestConfig {
    let default = ProptestConfig::default();
    let rng_seed = if std::env::var_os("PROPTEST_RNG_SEED").is_some() {
        default.rng_seed
    } else {
        RngSeed::Fixed(SEED)
    };
    ProptestConfig {
        failure_persistence: None,
        rng_seed,
        ..default
    }
}

/// A 2D placement: scale, then turn, then move.
#[derive(Clone, Copy, Debug)]
struct Place {
    at: (f64, f64),
    angle: f64,
    scale: (f64, f64),
}

impl Place {
    fn matrix(&self) -> Mat4 {
        Mat4::from_scale_rotation_translation(
            Vec3::new(self.scale.0 as f32, self.scale.1 as f32, 1.0),
            Quat::from_rotation_z(self.angle as f32),
            Vec3::new(self.at.0 as f32, self.at.1 as f32, 0.0),
        )
    }

    fn affine(&self) -> DAffine2 {
        DAffine2::from_scale_angle_translation(self.scale.into(), self.angle, self.at.into())
    }
}

fn place(at: std::ops::Range<f64>) -> impl Strategy<Value = Place> {
    (at.clone(), at, -3.1f64..3.1, 0.5f64..2.0, 0.5f64..2.0).prop_map(|(x, y, angle, sx, sy)| {
        Place {
            at: (x, y),
            angle,
            scale: (sx, sy),
        }
    })
}

fn rect() -> impl Strategy<Value = Rect> {
    (-150f32..50.0, -150f32..50.0, 20f32..400.0, 20f32..400.0)
        .prop_map(|(x, y, w, h)| Rect::new(x, y, w, h))
}

/// One level of a chain: a placement and, maybe, a clip in its children's units.
fn level() -> impl Strategy<Value = (Place, Option<Rect>)> {
    (place(-60.0..60.0), proptest::option::weighted(0.4, rect()))
}

/// Whether `p` is inside `r`, and not within `NEAR` of an edge (where f32 and f64 may disagree).
fn inside(r: &Rect, p: DVec2) -> Option<bool> {
    let (x0, y0) = (f64::from(r.x), f64::from(r.y));
    let (x1, y1) = (x0 + f64::from(r.width), y0 + f64::from(r.height));
    let near_edge = [(p.x - x0), (p.x - x1), (p.y - y0), (p.y - y1)]
        .iter()
        .any(|d| d.abs() < NEAR * 4.0);
    (!near_edge).then_some(p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1)
}

fn scene() -> Scene {
    Scene::new(VIEWPORT.0, VIEWPORT.1)
}

fn on_screen(p: DVec2) -> bool {
    p.x > 1.0 && p.y > 1.0 && p.x < f64::from(VIEWPORT.0) - 1.0 && p.y < f64::from(VIEWPORT.1) - 1.0
}

fn screen(p: DVec2) -> Vec2 {
    Vec2::new(p.x as f32, p.y as f32)
}

proptest! {
    #![proptest_config(config())]

    /// A chain of one to four nested groups, each placed in 2D and some clipped, over a floor that
    /// covers the screen: a point hits the leaf exactly where the inverse of the chain says, inside
    /// every clip and the leaf's rectangle, at the local point the inverse gives; anywhere else it
    /// falls through to the floor.
    #[test]
    fn a_point_hits_where_the_inverse_of_its_nested_clipped_groups_says(
        origin in place(300.0..900.0),
        levels in proptest::collection::vec(level(), 0..4),
        leaf in rect(),
        picks in proptest::collection::vec((0.0f64..1.0, 0.0f64..1.0, any::<bool>()), 24),
    ) {
        let mut scene = scene();
        let floor = scene
            .insert(scene.root(), SurfaceNode::new(Rect::new(0.0, 0.0, 1280.0, 800.0), TextureId(9)))
            .unwrap();
        let mut parent = scene.root();
        let mut chain = vec![(origin, None)];
        chain.extend(levels);
        let mut world = DAffine2::IDENTITY;
        let mut spaces = Vec::new();
        for (place, clip) in &chain {
            let group = GroupNode { transform: place.matrix(), clip: *clip, ..GroupNode::default() };
            parent = scene.insert(parent, group).unwrap();
            world *= place.affine();
            spaces.push((world, *clip));
        }
        let node = scene.insert(parent, SurfaceNode::new(leaf, TextureId(1))).unwrap();
        let min = DVec2::new(f64::from(leaf.x), f64::from(leaf.y));
        let size = DVec2::new(f64::from(leaf.width), f64::from(leaf.height));

        for (u, v, from_leaf) in picks {
            // Half the points land on the leaf (sent forward through the chain), half anywhere.
            let point = if from_leaf {
                world.transform_point2(min + size * DVec2::new(u, v))
            } else {
                DVec2::new(u * 1280.0, v * 800.0)
            };
            if !on_screen(point) {
                continue;
            }
            let mut seen = Some(true);
            for (space, clip) in &spaces {
                if let (Some(clip), Some(true)) = (clip, seen) {
                    seen = inside(clip, space.inverse().transform_point2(point));
                }
            }
            let local = world.inverse().transform_point2(point);
            if seen == Some(true) {
                seen = inside(&leaf, local);
            }
            let Some(expected) = seen else { continue };
            let hit = hit_test(&scene, screen(point)).expect("the floor covers the screen");
            if expected {
                prop_assert_eq!(hit.node, node, "{:?} should hit the leaf", point);
                let got = DVec2::new(f64::from(hit.local_point.x), f64::from(hit.local_point.y));
                prop_assert!((got - (local - min)).length() < NEAR, "{:?} vs {:?}", got, local - min);
            } else {
                prop_assert_eq!(hit.node, floor, "{:?} should fall through", point);
            }
        }
    }

    /// Nested groups hit exactly as one group holding their product does, flat or tilted out of
    /// the plane, under the orthographic and the perspective camera.
    #[test]
    fn nested_groups_hit_as_one_group_of_their_product(
        origin in place(400.0..880.0),
        inner in proptest::collection::vec(place(-40.0..40.0), 1..3),
        tilt in (-0.8f32..0.8, -0.8f32..0.8),
        perspective in any::<bool>(),
        leaf in rect(),
        picks in proptest::collection::vec((0.0f32..1280.0, 0.0f32..800.0), 24),
    ) {
        let projection = if perspective { Projection::perspective() } else { Projection::Orthographic };
        let tilted = Mat4::from_rotation_x(tilt.0) * Mat4::from_rotation_y(tilt.1);
        let mut matrices = vec![origin.matrix() * tilted];
        matrices.extend(inner.iter().map(Place::matrix));
        let product = matrices.iter().fold(Mat4::IDENTITY, |m, n| m * *n);

        let mut nested = scene();
        nested.set_projection(projection);
        let mut parent = nested.root();
        for transform in &matrices {
            parent = nested.insert(parent, GroupNode { transform: *transform, ..GroupNode::default() }).unwrap();
        }
        nested.insert(parent, SurfaceNode::new(leaf, TextureId(1))).unwrap();
        let mut flat = scene();
        flat.set_projection(projection);
        let group = flat.insert(flat.root(), GroupNode { transform: product, ..GroupNode::default() }).unwrap();
        flat.insert(group, SurfaceNode::new(leaf, TextureId(1))).unwrap();

        // Grazing angles amplify f32 error in either path; compare in units of the leaf's size.
        let near = 0.002 * leaf.width.max(leaf.height);
        let edge = |p: Vec2| p.x < near || p.y < near || p.x > leaf.width - near || p.y > leaf.height - near;
        for (x, y) in picks {
            let point = Vec2::new(x, y);
            match (hit_test(&nested, point), hit_test(&flat, point)) {
                (Some(a), Some(b)) => prop_assert!(
                    (a.local_point - b.local_point).length() < near.max(0.05),
                    "{:?}: {:?} vs {:?}", point, a.local_point, b.local_point
                ),
                (None, None) => {}
                (Some(only), None) | (None, Some(only)) => prop_assert!(
                    edge(only.local_point),
                    "{:?} hit one and not the other, at {:?}", point, only.local_point
                ),
            }
        }
    }

    /// Windows of one or two leaves, any of them or their groups `with_hit(false)`: a point hits
    /// the topmost leaf under it that hit testing sees, never one in a pass-through subtree, and a
    /// pass-through node above a leaf never hides it.
    #[test]
    fn pass_through_nodes_never_take_the_pointer_and_never_hide_what_is_under_them(
        windows in proptest::collection::vec(
            (place(200.0..1080.0), any::<bool>(), proptest::collection::vec((rect(), any::<bool>(), any::<bool>()), 1..3)),
            2..7,
        ),
        picks in proptest::collection::vec((0.0f64..1280.0, 0.0f64..800.0), 32),
    ) {
        let mut scene = scene();
        let mut leaves = Vec::new();
        for (place, group_hit, kids) in &windows {
            let group: Node = GroupNode { transform: place.matrix(), ..GroupNode::default() }.into();
            let group = scene.insert(scene.root(), group.with_hit(*group_hit)).unwrap();
            for (rect, hit, surface) in kids {
                let node: Node = if *surface {
                    SurfaceNode::new(*rect, TextureId(1)).into()
                } else {
                    RectNode::new(*rect, Color::WHITE).into()
                };
                let id = scene.insert(group, node.with_hit(*hit)).unwrap();
                leaves.push((id, place.affine(), *rect, *group_hit && *hit));
            }
        }
        'points: for (x, y) in picks {
            let point = DVec2::new(x, y);
            let mut expected = None;
            for (id, affine, rect, seen) in leaves.iter().rev() {
                let Some(under) = inside(rect, affine.inverse().transform_point2(point)) else {
                    continue 'points;
                };
                if under && *seen {
                    expected = Some(*id);
                    break;
                }
            }
            let got = hit_test(&scene, screen(point)).map(|h| h.node);
            prop_assert_eq!(got, expected, "at {:?}", point);
            if let Some(id) = got {
                let mut at = Some(id);
                while let Some(node) = at {
                    prop_assert!(scene.node(node).unwrap().hit, "{:?} is in a pass-through subtree", id);
                    at = scene.parent(node);
                }
            }
        }
    }
}
