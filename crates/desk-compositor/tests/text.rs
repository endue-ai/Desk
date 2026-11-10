//! Chrome text (ADR 0145): Latin, Hangul and CJK through fallback, an ellipsis where a title would
//! overflow, wrapping, subpixel positioning, the node's transform, opacity and clip, damage, and
//! the compositor's atlas. The bundled fonts (`tests/fonts`) make it the same on every OS; the
//! machine's fonts and emoji are checked where the machine has them.

mod support;

use desk_compositor::glam::{Mat4, Vec2, Vec3};
use desk_compositor::headless::Target;
use desk_compositor::*;
use support::{FORMAT, compositor, gpu, pixel};

const SIZE: (u32, u32) = (320, 120);
const GROUND: [u8; 4] = [20, 20, 22, 255];
const INK: [u8; 4] = [242, 240, 245, 255];

fn rgb(c: [u8; 4]) -> Color {
    Color::rgba8(c[0], c[1], c[2], c[3])
}

fn style(size: f32) -> TextStyle {
    TextStyle {
        font: FontStack::new(r#""Inter", "SUIT", -apple-system, "Noto Sans KR", sans-serif"#),
        size,
        weight: 500,
        color: rgb(INK),
        ..TextStyle::default()
    }
}

fn scene() -> Scene {
    let mut scene = Scene::new(SIZE.0, SIZE.1);
    scene.set_wallpaper(Wallpaper::Solid(rgb(GROUND)));
    scene
}

fn frame(
    gpu: &headless::Headless,
    compositor: &mut Compositor,
    scene: &Scene,
) -> (FrameStats, Vec<u8>) {
    let target = Target::new(&gpu.device, SIZE, FORMAT);
    let stats = compositor.render(scene, &target.view, target.size);
    (stats, target.read_rgba(&gpu.device, &gpu.queue).unwrap())
}

/// Pixels in `rect` that are not the ground: the text's ink.
fn ink(rgba: &[u8], rect: Rect) -> usize {
    let (x0, y0) = (rect.x.max(0.0) as u32, rect.y.max(0.0) as u32);
    let (x1, y1) = (
        ((rect.x + rect.width) as u32).min(SIZE.0),
        ((rect.y + rect.height) as u32).min(SIZE.1),
    );
    (y0..y1)
        .flat_map(|y| (x0..x1).map(move |x| (x, y)))
        .filter(|&(x, y)| pixel(rgba, SIZE.0, x, y)[0] > GROUND[0] + 24)
        .count()
}

/// The leftmost and rightmost columns with ink in `rect`.
fn ink_columns(rgba: &[u8], rect: Rect) -> Option<(u32, u32)> {
    let columns: Vec<u32> = (rect.x as u32..(rect.x + rect.width) as u32)
        .filter(|&x| ink(rgba, Rect::new(x as f32, rect.y, 1.0, rect.height)) > 0)
        .collect();
    Some((*columns.first()?, *columns.last()?))
}

#[test]
fn latin_hangul_and_cjk_titles_find_their_glyphs_through_fallback() {
    let Some(gpu) = gpu("latin_hangul_and_cjk_titles") else {
        return;
    };
    let mut scene = scene();
    let titles = [
        "Settings — Files",
        "설정 · 한글 제목",
        "设置 · 日本語 · ひらがな",
    ];
    let boxes: Vec<Rect> = (0..3)
        .map(|i| Rect::new(10.0, 8.0 + 36.0 * i as f32, 300.0, 30.0))
        .collect();
    for (title, rect) in titles.iter().zip(&boxes) {
        scene
            .insert(scene.root(), TextNode::new(*rect, title, style(16.0)))
            .unwrap();
    }
    let mut compositor = compositor(&gpu);
    let (stats, rgba) = frame(&gpu, &mut compositor, &scene);
    assert_eq!(
        stats.missing_glyphs, 0,
        "every glyph from a font: {stats:?}"
    );
    assert!(stats.glyphs >= 30, "{stats:?}");
    for (title, rect) in titles.iter().zip(&boxes) {
        let drawn = ink(&rgba, *rect);
        assert!(drawn > 120, "{title} draws: {drawn} pixels");
    }
    let brightest = (0..SIZE.1)
        .flat_map(|y| (0..SIZE.0).map(move |x| (x, y)))
        .map(|(x, y)| pixel(&rgba, SIZE.0, x, y))
        .max_by_key(|p| p[0])
        .unwrap();
    assert!(
        support::near(brightest, INK),
        "full coverage is the text colour: {brightest:?}"
    );
}

#[test]
fn a_title_too_long_for_its_box_ends_in_an_ellipsis_and_never_leaves_it() {
    let Some(gpu) = gpu("ellipsis") else { return };
    let mut scene = scene();
    let long = "A window whose title is far too long for its title bar";
    let short_box = Rect::new(10.0, 10.0, 140.0, 24.0);
    scene
        .insert(scene.root(), TextNode::new(short_box, long, style(14.0)))
        .unwrap();
    let wrapped = Rect::new(10.0, 50.0, 140.0, 60.0);
    scene
        .insert(
            scene.root(),
            TextNode::new(wrapped, long, style(14.0)).wrapped(),
        )
        .unwrap();
    let mut compositor = compositor(&gpu);
    let (_, rgba) = frame(&gpu, &mut compositor, &scene);
    let (_, right) = ink_columns(&rgba, short_box).expect("the title draws");
    assert!(
        right as f32 > short_box.x + short_box.width - 24.0,
        "it runs to the box's end: {right}"
    );
    assert_eq!(
        ink(&rgba, Rect::new(150.0, 0.0, 170.0, 40.0)),
        0,
        "nothing past the box"
    );
    // The ellipsis: three dots at the end, short marks on the baseline with gaps between them.
    let tail = Rect::new(right as f32 - 10.0, 10.0, 11.0, 24.0);
    assert!(
        ink(&rgba, tail) > 0 && ink(&rgba, tail) < 40,
        "dots, not letters: {}",
        ink(&rgba, tail)
    );
    let lines = (50..110)
        .filter(|&y| ink(&rgba, Rect::new(10.0, y as f32, 140.0, 1.0)) > 0)
        .fold((0, None::<u32>), |(n, last), y| match last {
            Some(prev) if prev + 1 == y => (n, Some(y)),
            _ => (n + 1, Some(y)),
        })
        .0;
    assert!(lines >= 3, "the wrapped title breaks into lines: {lines}");
}

#[test]
fn glyphs_keep_their_subpixel_position() {
    let Some(gpu) = gpu("subpixel") else { return };
    let row = |x: f32| {
        let mut scene = scene();
        let node = TextNode::new(Rect::new(x, 20.0, 200.0, 40.0), "lll", style(18.0));
        scene.insert(scene.root(), node).unwrap();
        let mut compositor = compositor(&gpu);
        let (_, rgba) = frame(&gpu, &mut compositor, &scene);
        (0..SIZE.0)
            .map(|x| (20..60).map(|y| pixel(&rgba, SIZE.0, x, y)[0] as u32).sum())
            .collect::<Vec<u32>>()
    };
    let (whole, half, next) = (row(10.0), row(10.5), row(11.0));
    assert_eq!(
        whole[..300],
        next[1..301],
        "a whole pixel moves the same pixels"
    );
    assert_ne!(whole[..300], half[..300], "half a pixel rasterises anew");
    assert_ne!(next[..300], half[..300]);
}

#[test]
fn text_follows_its_group_through_opacity_clip_and_transform() {
    let Some(gpu) = gpu("text_group") else { return };
    let mut scene = scene();
    let faded = scene
        .insert(
            scene.root(),
            GroupNode {
                opacity: 0.5,
                ..GroupNode::default()
            },
        )
        .unwrap();
    scene
        .insert(
            faded,
            TextNode::new(Rect::new(10.0, 10.0, 140.0, 30.0), "Faded", style(24.0)),
        )
        .unwrap();
    scene
        .insert(
            scene.root(),
            TextNode::new(Rect::new(160.0, 10.0, 140.0, 30.0), "Solid", style(24.0)),
        )
        .unwrap();
    let clipped = scene
        .insert(
            scene.root(),
            GroupNode {
                clip: Some(Rect::new(0.0, 60.0, 60.0, 60.0)),
                ..GroupNode::default()
            },
        )
        .unwrap();
    scene
        .insert(
            clipped,
            TextNode::new(Rect::new(10.0, 70.0, 140.0, 30.0), "Clipped", style(24.0)),
        )
        .unwrap();
    let turned = GroupNode {
        transform: Mat4::from_translation(Vec3::new(230.0, 90.0, 0.0)) * Mat4::from_rotation_z(0.4),
        ..GroupNode::default()
    };
    let turned = scene.insert(scene.root(), turned).unwrap();
    scene
        .insert(
            turned,
            TextNode::new(Rect::new(-40.0, -12.0, 80.0, 24.0), "Turned", style(16.0)),
        )
        .unwrap();
    let mut compositor = compositor(&gpu);
    let (_, rgba) = frame(&gpu, &mut compositor, &scene);
    let peak = |rect: Rect| {
        (rect.y as u32..(rect.y + rect.height) as u32)
            .flat_map(|y| (rect.x as u32..(rect.x + rect.width) as u32).map(move |x| (x, y)))
            .map(|(x, y)| pixel(&rgba, SIZE.0, x, y)[0])
            .max()
            .unwrap()
    };
    let (faint, solid) = (
        peak(Rect::new(10.0, 10.0, 140.0, 30.0)),
        peak(Rect::new(160.0, 10.0, 140.0, 30.0)),
    );
    assert!(
        faint + 60 < solid && faint > GROUND[0] + 40,
        "half opacity: {faint} vs {solid}"
    );
    assert!(
        ink(&rgba, Rect::new(10.0, 60.0, 50.0, 50.0)) > 0,
        "inside the clip"
    );
    assert_eq!(
        ink(&rgba, Rect::new(61.0, 60.0, 100.0, 50.0)),
        0,
        "past the clip"
    );
    assert!(
        ink(&rgba, Rect::new(180.0, 60.0, 100.0, 60.0)) > 40,
        "turned text draws"
    );
}

#[test]
fn a_text_change_damages_its_box_and_glyphs_stay_in_the_atlas() {
    let Some(gpu) = gpu("text_damage") else {
        return;
    };
    let mut scene = scene();
    let rect = Rect::new(20.0, 20.0, 200.0, 30.0);
    let title = scene
        .insert(scene.root(), TextNode::new(rect, "Notes", style(16.0)))
        .unwrap();
    let mut compositor = compositor(&gpu);
    let (first, _) = frame(&gpu, &mut compositor, &scene);
    let resident = compositor.glyphs_resident();
    assert!(first.drawn && resident >= 4, "{resident}");
    let (still, _) = frame(&gpu, &mut compositor, &scene);
    assert!(!still.drawn, "nothing changed");
    let mut recoloured = TextNode::new(rect, "Notes", style(16.0));
    recoloured.style.color = Color::hex(0xb6a3f5);
    scene.set(title, recoloured).unwrap();
    let (changed, _) = frame(&gpu, &mut compositor, &scene);
    assert_eq!(changed.damage, Some(rect.inflate(1.0)), "only the box");
    assert_eq!(
        compositor.glyphs_resident(),
        resident,
        "a colour is not a new glyph"
    );
    assert_eq!(
        hit_test(&scene, Vec2::new(30.0, 30.0)).map(|h| h.node),
        Some(title)
    );
}

#[test]
fn the_atlas_grows_for_many_sizes() {
    let Some(gpu) = gpu("atlas_grows") else {
        return;
    };
    let size = (1024, 1024);
    let mut scene = Scene::new(size.0, size.1);
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (i, px) in (20..68).step_by(2).enumerate() {
        let rect = Rect::new(0.0, i as f32 * 42.0, 1024.0, 42.0);
        let node = TextNode::new(rect, alphabet, style(px as f32));
        scene.insert(scene.root(), node).unwrap();
    }
    let mut compositor = compositor(&gpu);
    let target = Target::new(&gpu.device, size, FORMAT);
    let stats = compositor.render(&scene, &target.view, target.size);
    assert_eq!(stats.missing_glyphs, 0);
    let (side, resident) = (compositor.atlas_side(), compositor.glyphs_resident());
    assert!(side > 512, "the atlas grew past its first page: {side}");
    assert!(resident > 600, "{resident}");
    // Every glyph still drew after the growth: its texels moved with the page.
    let rgba = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    let inked =
        |y0: u32| (y0..y0 + 42).any(|y| (0..1024).any(|x| pixel(&rgba, 1024, x, y)[0] > 128));
    assert!((0..24).all(|i| inked(i * 42)), "every line draws");
    compositor.invalidate();
    compositor.render(&scene, &target.view, target.size);
    assert_eq!(
        (compositor.atlas_side(), compositor.glyphs_resident()),
        (side, resident)
    );
}

#[test]
fn the_machines_fonts_are_found_and_cover_hangul_and_emoji_where_it_has_them() {
    let Some(gpu) = gpu("system_fonts") else {
        return;
    };
    let mut fonts = Fonts::system();
    assert!(fonts.faces() > 0, "system font discovery found nothing");
    assert!(
        fonts.has_family(&fonts.sans_family()),
        "sans-serif is an installed family"
    );
    let mono = FontStack::new(r#""IBM Plex Mono", ui-monospace, Menlo, monospace"#);
    let mono_family = fonts.family_of(&mono);
    let has_mono = fonts.has_family(&mono_family);
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    compositor.set_fonts(fonts);
    let mut scene = scene();
    scene
        .insert(
            scene.root(),
            TextNode::new(
                Rect::new(10.0, 10.0, 300.0, 40.0),
                "설정 设置 Files",
                style(18.0),
            ),
        )
        .unwrap();
    scene
        .insert(
            scene.root(),
            TextNode::new(Rect::new(10.0, 60.0, 100.0, 50.0), "🙂", style(36.0)),
        )
        .unwrap();
    // A title's weight (500) in a family without it (Menlo has 400 and 700) still sets in it.
    let monospaced = |text: &str, y: f32| {
        let style = TextStyle {
            font: mono.clone(),
            ..style(16.0)
        };
        TextNode::new(Rect::new(130.0, y, 180.0, 24.0), text, style)
    };
    let (narrow, wide) = (
        Rect::new(130.0, 60.0, 180.0, 24.0),
        Rect::new(130.0, 88.0, 180.0, 24.0),
    );
    scene
        .insert(scene.root(), monospaced("iiiiii", narrow.y))
        .unwrap();
    scene
        .insert(scene.root(), monospaced("MMMMMM", wide.y))
        .unwrap();
    let (stats, rgba) = frame(&gpu, &mut compositor, &scene);
    if has_mono {
        let span = |r| ink_columns(&rgba, r).map(|(a, b)| b - a).unwrap_or(0);
        let (i, m) = (span(narrow), span(wide));
        assert!(
            i + 12 >= m,
            "{mono_family} at 500 is monospaced: {i} vs {m}"
        );
    }
    if stats.missing_glyphs > 0 {
        eprintln!(
            "system_fonts: this machine lacks Hangul, CJK or emoji fonts ({} glyphs missing)",
            stats.missing_glyphs
        );
        return;
    }
    assert!(ink(&rgba, Rect::new(10.0, 10.0, 300.0, 40.0)) > 80);
    let coloured = (60..110)
        .flat_map(|y| (10..110).map(move |x| (x, y)))
        .map(|(x, y)| pixel(&rgba, SIZE.0, x, y))
        .any(|[r, g, b, _]| r.max(g).max(b) - r.min(g).min(b) > 80);
    assert!(coloured, "the emoji draws in its own colours");
}
