//! The desk's chrome under two looks, the tables the runtime sends (the bridge's theme.tokens
//! vectors): the endue theme dark, the desk's default, and endue.theme-amber, which squares the
//! corners, glows its shadows and sets everything in a monospace stack. Rendered headless (a
//! software adapter on CI) with the bundled fonts and compared with `tests/snapshots/`;
//! `UPDATE_SNAPSHOTS=1` rewrites them. A switch between them restyles every part in one frame.

mod support;

use desk_compositor::headless::Target;
use desk_compositor::*;
use support::{FORMAT, assert_snapshot, compositor, gpu, look, near, pixel};

const SIZE: (u32, u32) = (360, 240);

/// Two windows (one focused, titled in Hangul; one with a CJK title, a subtitle and a sleeping
/// placeholder), an edge bar, a snap preview and a toast.
fn desk(theme: ChromeTheme) -> (Scene, Chrome, WindowChrome) {
    let mut scene = Scene::new(SIZE.0, SIZE.1);
    let mut chrome = Chrome::new(theme);
    scene.set_wallpaper(Wallpaper::Solid(chrome.theme().wallpaper));
    let root = scene.root();
    let back = Rect::new(176.0, 12.0, 176.0, 118.0);
    let other = chrome
        .window(
            &mut scene,
            root,
            back,
            "设置 · 日本語",
            Some("ひらがな"),
            false,
        )
        .unwrap();
    chrome
        .placeholder(&mut scene, other.group, other.content, "잠든 창")
        .unwrap();
    let front = Rect::new(14.0, 30.0, 166.0, 112.0);
    let focused = chrome
        .window(&mut scene, root, front, "설정 — Settings", None, true)
        .unwrap();
    let bar = Rect::new(10.0, 204.0, 176.0, 28.0);
    chrome
        .bar(&mut scene, root, bar, Some("Files · 터미널"))
        .unwrap();
    chrome
        .snap_preview(&mut scene, root, Rect::new(206.0, 138.0, 146.0, 26.0))
        .unwrap();
    let toast = Rect::new(196.0, 172.0, 156.0, 60.0);
    chrome
        .toast(&mut scene, root, toast, "저장했습니다 · Saved the desk")
        .unwrap();
    (scene, chrome, focused)
}

fn frame(gpu: &headless::Headless, compositor: &mut Compositor, scene: &Scene) -> Vec<u8> {
    let target = Target::new(&gpu.device, SIZE, FORMAT);
    let stats = compositor.render(scene, &target.view, target.size);
    assert!(stats.drawn && stats.missing_glyphs == 0, "{stats:?}");
    target.read_rgba(&gpu.device, &gpu.queue).unwrap()
}

fn bytes(c: Color) -> [u8; 4] {
    [c.r, c.g, c.b, c.a].map(|v| (v * 255.0).round() as u8)
}

#[test]
fn the_fallback_look_is_the_default_theme() {
    assert_eq!(ChromeTheme::from_tokens(&look("")), ChromeTheme::default());
    assert_eq!(
        ChromeTheme::from_tokens(&Tokens::default()),
        ChromeTheme::default()
    );
}

#[test]
fn the_chrome_takes_the_tokens_of_the_look_in_force() {
    let (dark, amber) = (look(""), look("-amber"));
    let theme = ChromeTheme::from_tokens(&amber);
    assert_eq!(theme.wallpaper, amber.color("background").unwrap());
    assert_eq!(theme.window.radius, 0.0, "amber's shape is radius none");
    // The design system's toast recipe points at the theme's tokens; the compositor follows it.
    assert_eq!(theme.toast.radius, amber.length("radiusLg").unwrap());
    assert_eq!(amber.raw("toastShadow"), Some("var(--desk-shadow-md)"));
    assert!(
        theme.toast.shadow.is_some_and(|s| s.color.a > 0.5),
        "{:?}",
        theme.toast.shadow
    );
    assert_eq!(
        theme.window.title.font.families().next(),
        Some("IBM Plex Mono")
    );
    let endue = ChromeTheme::from_tokens(&dark);
    assert_eq!((endue.window.radius, endue.window.title.size), (12.0, 14.0));
    assert_eq!(endue.snap.fill, dark.color("primarySoft").unwrap());
}

#[test]
fn a_hover_title_takes_the_tooltip_tokens_as_the_shells_tooltip_does() {
    let (dark, amber) = (look(""), look("-amber"));
    let (endue, amber_theme) = (
        ChromeTheme::from_tokens(&dark),
        ChromeTheme::from_tokens(&amber),
    );
    assert_eq!(amber_theme.tooltip.fill, amber.color("tooltip").unwrap());
    assert_eq!(
        amber_theme.tooltip.text.color,
        amber.color("tooltipText").unwrap()
    );
    assert_eq!(amber_theme.tooltip.radius, 0.0, "amber's radius-md is 0");
    let tip = &endue.tooltip;
    assert_eq!((tip.radius, tip.padding_x, tip.padding_y), (8.0, 8.0, 4.0));
    assert_eq!(tip.text.size, 12.0);
    assert!(
        (tip.text.size * tip.text.line_height - 20.0).abs() < 1e-3,
        "20 px lines"
    );
    assert!(
        tip.shadow.is_some_and(|s| s.blur == 2.0),
        "{:?}",
        tip.shadow
    );
}

#[test]
fn chrome_in_the_endue_theme() {
    let Some(gpu) = gpu("chrome_in_the_endue_theme") else {
        return;
    };
    let theme = ChromeTheme::from_tokens(&look(""));
    let (scene, _, front) = desk(theme.clone());
    let rgba = frame(&gpu, &mut compositor(&gpu), &scene);
    let at = |x, y| pixel(&rgba, SIZE.0, x, y);
    assert!(
        near(at(3, 3), bytes(theme.wallpaper)),
        "wallpaper: {:?}",
        at(3, 3)
    );
    assert!(
        near(at(100, 120), bytes(theme.window.fill)),
        "frame: {:?}",
        at(100, 120)
    );
    assert!(
        near(at(14, 30), bytes(theme.wallpaper)),
        "a rounded corner: {:?}",
        at(14, 30)
    );
    assert!(front.content.y == theme.window.title_height);
    assert_snapshot(&gpu, "chrome_endue_dark", SIZE, &rgba);
}

#[test]
fn chrome_in_the_amber_theme() {
    let Some(gpu) = gpu("chrome_in_the_amber_theme") else {
        return;
    };
    let theme = ChromeTheme::from_tokens(&look("-amber"));
    let (scene, _, _) = desk(theme.clone());
    let rgba = frame(&gpu, &mut compositor(&gpu), &scene);
    let at = |x, y| pixel(&rgba, SIZE.0, x, y);
    assert!(
        near(at(3, 3), bytes(theme.wallpaper)),
        "wallpaper: {:?}",
        at(3, 3)
    );
    assert!(
        near(at(100, 120), bytes(theme.window.fill)),
        "frame: {:?}",
        at(100, 120)
    );
    assert!(
        near(at(14, 30), bytes(theme.window.border_focused)),
        "a square corner: {:?}",
        at(14, 30)
    );
    assert_snapshot(&gpu, "chrome_amber", SIZE, &rgba);
}

#[test]
fn a_theme_switch_restyles_every_part_in_one_frame() {
    let Some(gpu) = gpu("theme_switch") else {
        return;
    };
    let amber = ChromeTheme::from_tokens(&look("-amber"));
    let (mut scene, mut chrome, _) = desk(ChromeTheme::from_tokens(&look("")));
    let mut live = compositor(&gpu);
    let target = Target::new(&gpu.device, SIZE, FORMAT);
    assert!(live.render(&scene, &target.view, target.size).drawn);
    chrome.set_theme(&mut scene, amber.clone());
    let switched = live.render(&scene, &target.view, target.size);
    assert!(switched.drawn, "the switch draws the next frame");
    assert_eq!(switched.damage, Some(Rect::new(0.0, 0.0, 360.0, 240.0)));
    let after = target.read_rgba(&gpu.device, &gpu.queue).unwrap();
    // That one frame is the amber desk, as a desk built in amber from the start draws it.
    let (fresh, _, _) = desk(amber.clone());
    let expected = frame(&gpu, &mut compositor(&gpu), &fresh);
    let differ = after
        .chunks(4)
        .zip(expected.chunks(4))
        .filter(|(a, b)| a != b)
        .count();
    assert_eq!(
        differ, 0,
        "{differ} pixels differ from a desk drawn in amber"
    );
    chrome.set_theme(&mut scene, amber);
    assert!(
        !live.render(&scene, &target.view, target.size).drawn,
        "the same look again is no change"
    );
}
