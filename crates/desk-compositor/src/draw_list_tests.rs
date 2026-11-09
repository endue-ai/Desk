use super::*;
use crate::node::GroupNode;

#[test]
fn items_follow_paint_order_and_skip_what_cannot_show() {
    let mut scene = Scene::new(100, 100);
    scene.set_wallpaper(Wallpaper::Gradient {
        top: Color::BLACK,
        bottom: Color::WHITE,
    });
    let root = scene.root();
    let mut framed = RectNode::new(Rect::new(0.0, 0.0, 10.0, 10.0), Color::WHITE);
    framed.shadow = Some(crate::Shadow {
        offset: glam::Vec2::ZERO,
        blur: 4.0,
        spread: 0.0,
        color: Color::BLACK,
    });
    scene.insert(root, framed).unwrap();
    scene
        .insert(
            root,
            RectNode::new(Rect::new(0.0, 0.0, 5.0, 5.0), Color::TRANSPARENT),
        )
        .unwrap();
    let hidden = scene
        .insert(
            root,
            GroupNode {
                opacity: 0.0,
                ..GroupNode::default()
            },
        )
        .unwrap();
    scene
        .insert(
            hidden,
            RectNode::new(Rect::new(0.0, 0.0, 5.0, 5.0), Color::WHITE),
        )
        .unwrap();
    scene
        .insert(
            root,
            SurfaceNode::new(Rect::new(0.0, 0.0, 5.0, 5.0), TextureId(7)),
        )
        .unwrap();
    scene
        .insert(
            root,
            SurfaceNode::new(Rect::new(0.0, 0.0, 5.0, 5.0), TextureId(8)),
        )
        .unwrap();
    let known = |id: TextureId| (id == TextureId(7)).then_some((4, 4));
    let mut items = Vec::new();
    let counts = build(&scene, &known, &mut items);
    let modes: Vec<u32> = items.iter().map(|i| i.uniform.mode[0]).collect();
    assert_eq!(
        modes,
        [MODE_GRADIENT, MODE_SHADOW, MODE_SHAPE, MODE_SURFACE]
    );
    assert_eq!(counts.nodes_drawn, 2);
    assert_eq!(counts.missing_textures, 1);
}

#[test]
fn a_clip_sets_a_scissor_and_reaches_nested_children() {
    let mut scene = Scene::new(100, 100);
    let clip = GroupNode {
        clip: Some(Rect::new(10.0, 10.0, 20.0, 20.0)),
        ..GroupNode::translated(5.0, 0.0)
    };
    let outer = scene.insert(scene.root(), clip).unwrap();
    let inner = scene
        .insert(outer, GroupNode::translated(3.0, 0.0))
        .unwrap();
    scene
        .insert(
            inner,
            RectNode::new(Rect::new(0.0, 0.0, 50.0, 50.0), Color::WHITE),
        )
        .unwrap();
    let mut items = Vec::new();
    build(&scene, &|_| None, &mut items);
    assert_eq!(items[0].scissor, Some(Rect::new(15.0, 10.0, 20.0, 20.0)));
    assert_eq!(items[0].uniform.clip, [10.0, 10.0, 30.0, 30.0]);
    assert_eq!(
        items[0].uniform.clip_from_local[3][0], 3.0,
        "inner's move, into the clip's space"
    );
}
