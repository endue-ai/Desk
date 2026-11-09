use super::*;
use crate::node::{RectNode, SurfaceNode};
use glam::Vec3;

fn rect(x: f32, y: f32, w: f32, h: f32) -> RectNode {
    RectNode::new(Rect::new(x, y, w, h), Color::WHITE)
}

/// A scene whose initial damage has been seen.
fn fresh() -> (Scene, u64) {
    let scene = Scene::new(200, 100);
    let seen = scene.revision();
    (scene, seen)
}

#[test]
fn insert_appends_on_top_and_damages_the_node() {
    let (mut scene, seen) = fresh();
    let a = scene
        .insert(scene.root(), rect(10.0, 10.0, 20.0, 20.0))
        .unwrap();
    let b = scene
        .insert(scene.root(), rect(50.0, 10.0, 20.0, 20.0))
        .unwrap();
    assert_eq!(scene.children(scene.root()), &[a, b]);
    assert_eq!(scene.parent(b), Some(scene.root()));
    assert_eq!(
        scene.damage_since(seen),
        Some(Rect::new(9.0, 9.0, 62.0, 22.0)),
        "both rects, one pixel of antialiasing around"
    );
}

#[test]
fn moving_a_group_damages_where_it_was_and_where_it_is() {
    let (mut scene, _) = fresh();
    let group = scene
        .insert(scene.root(), GroupNode::translated(0.0, 0.0))
        .unwrap();
    scene.insert(group, rect(0.0, 0.0, 10.0, 10.0)).unwrap();
    let seen = scene.revision();
    scene
        .set(group, GroupNode::translated(100.0, 50.0))
        .unwrap();
    assert_eq!(
        scene.damage_since(seen),
        Some(Rect::new(0.0, 0.0, 111.0, 61.0))
    );
    assert_eq!(
        scene
            .world_transform(group)
            .unwrap()
            .transform_point3(Vec3::ZERO),
        Vec3::new(100.0, 50.0, 0.0)
    );
}

#[test]
fn setting_the_same_data_or_off_screen_changes_does_not_damage() {
    let (mut scene, _) = fresh();
    let a = scene
        .insert(scene.root(), rect(10.0, 10.0, 20.0, 20.0))
        .unwrap();
    let off = scene
        .insert(scene.root(), rect(500.0, 0.0, 5.0, 5.0))
        .unwrap();
    let seen = scene.revision();
    scene.set(a, rect(10.0, 10.0, 20.0, 20.0)).unwrap();
    scene.set(off, rect(600.0, 0.0, 5.0, 5.0)).unwrap();
    assert_eq!(scene.damage_since(seen), None);
    assert_eq!(scene.revision(), seen);
}

#[test]
fn reorder_moves_within_siblings_and_damages_the_node() {
    let (mut scene, _) = fresh();
    let root = scene.root();
    let a = scene.insert(root, rect(0.0, 0.0, 10.0, 10.0)).unwrap();
    let b = scene.insert(root, rect(5.0, 0.0, 10.0, 10.0)).unwrap();
    let c = scene.insert(root, rect(100.0, 50.0, 10.0, 10.0)).unwrap();
    let seen = scene.revision();
    scene.reorder(a, 99).unwrap();
    assert_eq!(scene.children(root), &[b, c, a]);
    assert_eq!(
        scene.damage_since(seen),
        Some(Rect::new(0.0, 0.0, 11.0, 11.0))
    );
    let seen = scene.revision();
    scene.reorder(a, 2).unwrap();
    assert_eq!(scene.damage_since(seen), None, "already there");
    assert_eq!(scene.reorder(root, 0), Err(SceneError::Root));
}

#[test]
fn remove_takes_the_subtree_and_damages_it() {
    let (mut scene, _) = fresh();
    let group = scene
        .insert(scene.root(), GroupNode::translated(20.0, 20.0))
        .unwrap();
    let child = scene.insert(group, rect(0.0, 0.0, 10.0, 10.0)).unwrap();
    scene.set_animating(child, true).unwrap();
    let seen = scene.revision();
    assert!(scene.remove(group).unwrap().is_group());
    assert_eq!(scene.node(child), None);
    assert!(!scene.is_animating());
    assert!(scene.is_empty());
    assert_eq!(
        scene.damage_since(seen),
        Some(Rect::new(19.0, 19.0, 12.0, 12.0))
    );
    assert_eq!(scene.remove(scene.root()), Err(SceneError::Root));
    assert_eq!(scene.remove(group), Err(SceneError::NoSuchNode(group)));
}

#[test]
fn children_go_under_groups_only() {
    let (mut scene, _) = fresh();
    let leaf = scene
        .insert(
            scene.root(),
            SurfaceNode::new(Rect::new(0.0, 0.0, 4.0, 4.0), TextureId(1)),
        )
        .unwrap();
    assert_eq!(
        scene.insert(leaf, rect(0.0, 0.0, 1.0, 1.0)),
        Err(SceneError::NotAGroup(leaf))
    );
    let group = scene.insert(scene.root(), GroupNode::default()).unwrap();
    scene.insert(group, rect(0.0, 0.0, 1.0, 1.0)).unwrap();
    assert_eq!(
        scene.set(group, rect(0.0, 0.0, 1.0, 1.0)),
        Err(SceneError::NotAGroup(group))
    );
}

#[test]
fn a_clip_bounds_the_damage_of_what_it_hides() {
    let (mut scene, _) = fresh();
    let group = scene
        .insert(
            scene.root(),
            GroupNode {
                clip: Some(Rect::new(0.0, 0.0, 30.0, 30.0)),
                ..GroupNode::default()
            },
        )
        .unwrap();
    let seen = scene.revision();
    scene.insert(group, rect(0.0, 0.0, 100.0, 100.0)).unwrap();
    assert_eq!(
        scene.damage_since(seen),
        Some(Rect::new(0.0, 0.0, 30.0, 30.0))
    );
}

#[test]
fn shadows_widen_the_damage() {
    let (mut scene, seen) = fresh();
    let mut r = rect(50.0, 50.0, 20.0, 20.0);
    r.shadow = Some(crate::types::Shadow {
        offset: glam::Vec2::new(0.0, 4.0),
        blur: 4.0,
        spread: 0.0,
        color: Color::BLACK,
    });
    scene.insert(scene.root(), r).unwrap();
    let damage = scene.damage_since(seen).unwrap();
    assert!(damage.max().y >= 50.0 + 20.0 + 4.0 + 6.0, "{damage:?}");
}

#[test]
fn resize_projection_and_wallpaper_damage_everything() {
    let (mut scene, seen) = fresh();
    scene.resize(300, 100);
    assert_eq!(
        scene.damage_since(seen),
        Some(Rect::new(0.0, 0.0, 300.0, 100.0))
    );
    let seen = scene.revision();
    scene.set_projection(Projection::perspective());
    scene.set_wallpaper(Wallpaper::Solid(Color::WHITE));
    assert_eq!(scene.revision(), seen + 2);
    let seen = scene.revision();
    scene.set_wallpaper(Wallpaper::Solid(Color::WHITE));
    assert_eq!(scene.revision(), seen, "the same wallpaper again");
}
