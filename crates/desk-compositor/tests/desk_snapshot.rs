//! The compose budget's own desk as a snapshot (#58): the benchmark's 15 titled windows (Latin,
//! Hangul and CJK titles, every third one tilted in 3D under perspective, each over a texture of its
//! own) at a fixed scene time, rendered headless and compared with `tests/snapshots/desk_fifteen.png`
//! under the platform's tolerance. What the budget times is what this test sees.

#[path = "../examples/shared/mod.rs"]
mod shared;
mod support;

use desk_compositor::headless::Target;
use desk_compositor::*;
use support::{FORMAT, assert_snapshot, compositor, gpu, pixel};

const SIZE: (u32, u32) = (640, 360);
const WINDOWS: usize = 15;
/// Seconds of scene time: windows have drifted and the tilted ones have turned.
const AT: f32 = 1.25;
/// Glyphs of the benchmark's titles outside `tests/fonts`' subsets, in the visible part of each.
const MISSING_GLYPHS: usize = 10;

#[test]
fn the_budgets_desk_of_fifteen_windows() {
    let Some(gpu) = gpu("the_budgets_desk_of_fifteen_windows") else {
        return;
    };
    let mut compositor = compositor(&gpu);
    let theme = ChromeTheme::from_tokens(&shared::look(""));
    let wallpaper = theme.wallpaper;
    let mut desk = shared::build(SIZE, WINDOWS, &mut compositor, theme);
    shared::animate(&mut desk, &mut compositor, AT);
    let target = Target::new(&gpu.device, SIZE, FORMAT);
    let stats = compositor.render(&desk.scene, &target.view, target.size);
    assert!(stats.drawn, "{stats:?}");
    assert_eq!(
        (stats.nodes_drawn, stats.missing_textures),
        (WINDOWS * 4, 0),
        "a frame, a title bar, a title and a surface per window: {stats:?}"
    );
    // The test fonts are cut down to the text tests' strings (tests/fonts/SOURCE.md): メモ and the
    // long Hangul title's syllables past 한글 제목 draw as nothing, the same on every OS.
    assert_eq!(stats.missing_glyphs, MISSING_GLYPHS, "{stats:?}");
    let rgba = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    let wall = [wallpaper.r, wallpaper.g, wallpaper.b].map(|v| (v * 255.0).round() as u8);
    let shows_wallpaper = |x, y| {
        let p = pixel(&rgba, SIZE.0, x, y);
        p.iter().zip(wall).all(|(a, b)| a.abs_diff(b) <= 8)
    };
    assert!(shows_wallpaper(1, 1), "the corner is wallpaper");
    let covered = (0..SIZE.1)
        .step_by(8)
        .flat_map(|y| (0..SIZE.0).step_by(8).map(move |x| (x, y)))
        .filter(|&(x, y)| !shows_wallpaper(x, y))
        .count();
    let samples = (SIZE.0 / 8 * SIZE.1 / 8) as usize;
    assert!(
        covered > samples / 2,
        "windows cover most of the desk: {covered} of {samples}"
    );
    assert_snapshot(&gpu, "desk_fifteen", SIZE, &rgba);
}
