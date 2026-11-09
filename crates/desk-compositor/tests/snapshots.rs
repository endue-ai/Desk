//! Small scenes rendered headless and compared with the PNGs in `tests/snapshots/` (a per-channel
//! tolerance absorbs backend differences). `UPDATE_SNAPSHOTS=1 cargo test -p desk-compositor
//! --test snapshots` rewrites them; look at the diff before committing. Each scene also checks a
//! few pixels by meaning, so a wrong image cannot be blessed silently.

mod support;

use desk_compositor::glam::{Mat4, Vec2, Vec3};
use desk_compositor::headless::upload_rgba;
use desk_compositor::*;
use support::{SIZE, assert_snapshot, checker, gpu, gradient, near, pixel, render};

const INK: [u8; 4] = [224, 228, 238, 255];
const BLUE: [u8; 4] = [47, 111, 222, 255];

fn rgb(c: [u8; 4]) -> Color {
    Color::rgba8(c[0], c[1], c[2], c[3])
}

#[test]
fn wallpaper_and_rects() {
    let Some(gpu) = gpu("wallpaper_and_rects") else {
        return;
    };
    let mut scene = Scene::new(SIZE.0, SIZE.1);
    scene.set_wallpaper(Wallpaper::Gradient {
        top: Color::hex(0x1d2333),
        bottom: Color::hex(0x3b2a4d),
    });
    let root = scene.root();
    scene
        .insert(
            root,
            RectNode::new(Rect::new(10.0, 10.0, 50.0, 40.0), rgb(INK)),
        )
        .unwrap();
    scene
        .insert(
            root,
            RectNode {
                stroke: Some(Stroke {
                    width: 2.0,
                    color: Color::WHITE,
                }),
                radius: 10.0,
                ..RectNode::new(Rect::new(70.0, 10.0, 70.0, 40.0), rgb(BLUE))
            },
        )
        .unwrap();
    scene
        .insert(
            root,
            RectNode {
                radius: 6.0,
                shadow: Some(Shadow {
                    offset: Vec2::new(0.0, 6.0),
                    blur: 12.0,
                    spread: 0.0,
                    color: Color::BLACK.fade(0.6),
                }),
                ..RectNode::new(Rect::new(150.0, 14.0, 90.0, 48.0), Color::WHITE)
            },
        )
        .unwrap();
    let red = Color::hex(0xe63946).fade(0.6);
    let green = Color::hex(0x2a9d8f).fade(0.6);
    scene
        .insert(root, RectNode::new(Rect::new(20.0, 80.0, 80.0, 50.0), red))
        .unwrap();
    scene
        .insert(
            root,
            RectNode::new(Rect::new(60.0, 100.0, 80.0, 50.0), green),
        )
        .unwrap();
    let frame = RectNode {
        stroke: Some(Stroke {
            width: 3.0,
            color: Color::hex(0xffd166),
        }),
        radius: 12.0,
        ..RectNode::new(Rect::new(160.0, 90.0, 80.0, 50.0), Color::TRANSPARENT)
    };
    scene.insert(root, frame).unwrap();

    let rgba = render(&gpu, &scene, &[]);
    let at = |x, y| pixel(&rgba, SIZE.0, x, y);
    assert!(near(at(35, 30), INK), "plain fill: {:?}", at(35, 30));
    assert!(near(at(105, 30), BLUE), "rounded fill: {:?}", at(105, 30));
    assert!(
        near(at(105, 10), [255, 255, 255, 255]),
        "stroke on the top edge: {:?}",
        at(105, 10)
    );
    assert!(
        at(71, 11)[2] < 120,
        "the rounded corner leaves wallpaper: {:?}",
        at(71, 11)
    );
    assert!(
        at(195, 66)[0] + 8 < at(120, 66)[0],
        "the card's shadow darkens the wallpaper below it"
    );
    let (only_red, both) = (at(30, 90), at(80, 110));
    assert!(
        both[1] > only_red[1] && both[0] < only_red[0],
        "green over red blends"
    );
    assert!(
        near(at(200, 115), at(200, 118)),
        "the frame's middle shows the wallpaper"
    );
    assert_snapshot("wallpaper_and_rects", SIZE, &rgba);
}

#[test]
fn surfaces() {
    let Some(gpu) = gpu("surfaces") else { return };
    let check = upload_rgba(
        &gpu.device,
        &gpu.queue,
        (32, 32),
        &checker((32, 32), 8, INK, BLUE),
    );
    let ramp = upload_rgba(&gpu.device, &gpu.queue, (64, 64), &gradient((64, 64)));
    let (check_id, ramp_id) = (TextureId(1), TextureId(2));
    let mut scene = Scene::new(SIZE.0, SIZE.1);
    scene.set_wallpaper(Wallpaper::Solid(Color::hex(0x202020)));
    let root = scene.root();
    scene
        .insert(
            root,
            SurfaceNode::new(Rect::new(10.0, 10.0, 64.0, 64.0), check_id),
        )
        .unwrap();
    let right_half = SurfaceNode {
        uv: Rect::new(0.5, 0.0, 0.5, 1.0),
        ..SurfaceNode::new(Rect::new(90.0, 10.0, 32.0, 64.0), ramp_id)
    };
    scene.insert(root, right_half).unwrap();
    let rounded = SurfaceNode {
        radius: 14.0,
        ..SurfaceNode::new(Rect::new(140.0, 10.0, 64.0, 64.0), ramp_id)
    };
    scene.insert(root, rounded).unwrap();
    scene
        .insert(
            root,
            RectNode::new(Rect::new(20.0, 90.0, 100.0, 60.0), Color::hex(0xe63946)),
        )
        .unwrap();
    let ghost = SurfaceNode {
        opacity: 0.5,
        ..SurfaceNode::new(Rect::new(60.0, 100.0, 64.0, 32.0), check_id)
    };
    scene.insert(root, ghost).unwrap();
    scene
        .insert(
            root,
            SurfaceNode::new(Rect::new(150.0, 90.0, 64.0, 64.0), TextureId(99)),
        )
        .unwrap();

    let rgba = render(&gpu, &scene, &[(check_id, &check), (ramp_id, &ramp)]);
    let at = |x, y| pixel(&rgba, SIZE.0, x, y);
    assert!(
        near(at(13, 13), INK) && near(at(29, 13), BLUE),
        "checker cells at 2x"
    );
    assert!(
        at(91, 40)[0] > 120,
        "the right half of the ramp starts past the middle"
    );
    assert!(
        near(at(141, 11), [32, 32, 32, 255]),
        "rounded corner shows the wallpaper"
    );
    let ghost = at(100, 104);
    assert!(
        ghost[0] > 200 && ghost[2] > 90,
        "half-transparent checker over red: {ghost:?}"
    );
    assert!(
        near(at(180, 120), [32, 32, 32, 255]),
        "an unregistered texture draws nothing"
    );
    assert_snapshot("surfaces", SIZE, &rgba);
}

#[test]
fn groups() {
    let Some(gpu) = gpu("groups") else { return };
    let check = upload_rgba(
        &gpu.device,
        &gpu.queue,
        (32, 32),
        &checker((32, 32), 4, INK, BLUE),
    );
    let mut scene = Scene::new(SIZE.0, SIZE.1);
    scene.set_wallpaper(Wallpaper::Solid(Color::hex(0x101820)));
    let root = scene.root();
    let scaled = GroupNode {
        transform: Mat4::from_translation(Vec3::new(10.0, 10.0, 0.0))
            * Mat4::from_scale(Vec3::new(1.5, 1.5, 1.0)),
        ..GroupNode::default()
    };
    let scaled = scene.insert(root, scaled).unwrap();
    scene
        .insert(
            scaled,
            RectNode::new(Rect::new(0.0, 0.0, 40.0, 30.0), rgb(INK)),
        )
        .unwrap();
    scene
        .insert(
            scaled,
            SurfaceNode::new(Rect::new(10.0, 10.0, 20.0, 20.0), TextureId(1)),
        )
        .unwrap();
    let rotated = GroupNode {
        transform: Mat4::from_translation(Vec3::new(130.0, 40.0, 0.0))
            * Mat4::from_rotation_z(15f32.to_radians()),
        ..GroupNode::default()
    };
    let rotated = scene.insert(root, rotated).unwrap();
    scene
        .insert(
            rotated,
            RectNode::new(Rect::new(-30.0, -20.0, 60.0, 40.0), rgb(BLUE)),
        )
        .unwrap();
    let clipped = GroupNode {
        clip: Some(Rect::new(0.0, 0.0, 40.0, 40.0)),
        ..GroupNode::translated(190.0, 20.0)
    };
    let clipped = scene.insert(root, clipped).unwrap();
    scene
        .insert(
            clipped,
            SurfaceNode::new(Rect::new(-20.0, -20.0, 80.0, 80.0), TextureId(1)),
        )
        .unwrap();
    let faded = scene
        .insert(
            root,
            GroupNode {
                opacity: 0.5,
                ..GroupNode::default()
            },
        )
        .unwrap();
    let fainter = scene
        .insert(
            faded,
            GroupNode {
                opacity: 0.5,
                ..GroupNode::default()
            },
        )
        .unwrap();
    scene
        .insert(
            fainter,
            RectNode::new(Rect::new(20.0, 100.0, 200.0, 40.0), Color::WHITE),
        )
        .unwrap();

    let rgba = render(&gpu, &scene, &[(TextureId(1), &check)]);
    let at = |x, y| pixel(&rgba, SIZE.0, x, y);
    assert!(near(at(12, 12), INK), "scaled rect");
    assert!(
        near(at(70, 50), [16, 24, 32, 255]),
        "the scale ends at 10 + 1.5 * 40"
    );
    assert!(near(at(130, 40), BLUE), "rotated rect around its centre");
    assert!(
        near(at(185, 40), [16, 24, 32, 255]) && near(at(232, 40), [16, 24, 32, 255]),
        "clipped left and right"
    );
    let quarter = at(120, 120);
    assert!(
        (quarter[0] as i32 - 76).abs() <= 8,
        "white at 0.5 x 0.5 over the wallpaper: {quarter:?}"
    );
    assert_snapshot("groups", SIZE, &rgba);
}

#[test]
fn perspective_over_a_texture_wallpaper() {
    let Some(gpu) = gpu("perspective_over_a_texture_wallpaper") else {
        return;
    };
    let wall = upload_rgba(&gpu.device, &gpu.queue, (64, 32), &gradient((64, 32)));
    let check = upload_rgba(
        &gpu.device,
        &gpu.queue,
        (32, 32),
        &checker((32, 32), 8, INK, BLUE),
    );
    let mut scene = Scene::new(SIZE.0, SIZE.1);
    scene.set_projection(Projection::perspective());
    scene.set_wallpaper(Wallpaper::Texture(TextureId(10)));
    let root = scene.root();
    for (x, axis) in [(70.0, Vec3::Y), (186.0, Vec3::X)] {
        let tilt = Mat4::from_translation(Vec3::new(x, 80.0, 0.0))
            * Mat4::from_axis_angle(axis, 35f32.to_radians());
        let group = scene
            .insert(
                root,
                GroupNode {
                    transform: tilt,
                    ..GroupNode::default()
                },
            )
            .unwrap();
        let frame = RectNode {
            radius: 8.0,
            ..RectNode::new(Rect::new(-54.0, -44.0, 108.0, 88.0), Color::hex(0x14213d))
        };
        scene.insert(group, frame).unwrap();
        scene
            .insert(
                group,
                SurfaceNode::new(Rect::new(-50.0, -40.0, 100.0, 80.0), TextureId(1)),
            )
            .unwrap();
    }

    let rgba = render(
        &gpu,
        &scene,
        &[(TextureId(10), &wall), (TextureId(1), &check)],
    );
    let at = |x, y| pixel(&rgba, SIZE.0, x, y);
    assert!(
        at(2, 80)[0] < 60 && at(253, 80)[0] > 190,
        "the wallpaper ramps left to right"
    );
    let hit = hit_test(&scene, Vec2::new(70.0, 80.0)).expect("the tilted surface");
    assert!(matches!(
        scene.node(hit.node).unwrap().kind,
        NodeKind::Surface(_)
    ));
    assert!(
        (hit.local_point - Vec2::new(50.0, 40.0)).length() < 0.5,
        "{:?}",
        hit.local_point
    );
    assert_snapshot("perspective_over_a_texture_wallpaper", SIZE, &rgba);
}
