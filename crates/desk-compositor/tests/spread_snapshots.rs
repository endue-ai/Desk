//! The spread on the compositor (#54, ADR 0116) at fixed clock times, as ADR 0013 freezes motion:
//! five titled windows of a 1280 by 800 app, each over a texture of its own (a surface's live frame),
//! fanned out by `desk-wm`'s spread and drawn as the shell draws it: the scrim over the desk, every
//! window posed in 3D under the stage's perspective, the selected one ringed, and the filter field
//! with the count and the hint above them. The spread opens at 2.8 s, a filter is typed at 6.0 s and
//! the selection moves at 8.7 s, and a window is chosen at 19.1 s: at 3.0 s it is fanning out, at
//! 8.8 s the cards are moving to the new selection, at 19.3 s it is closing back to the desk. Each
//! time gives the same frame on every run; `UPDATE_SNAPSHOTS=1` rewrites the PNGs.

mod support;

use desk_compositor::glam::{Mat4, Vec3};
use desk_compositor::headless::{Headless, Target, upload_rgba};
use desk_compositor::stage::{pose_transform, stage_projection, stage_transform};
use desk_compositor::*;
use desk_wm::{Durations, Ending, KeyPress, Spread, SpreadAction, SpreadWindow};
use support::{FORMAT, assert_snapshot, compositor, gpu, look};

const APP: (f32, f32) = (1280.0, 800.0);
const SCALE: f32 = 0.375;
const SIZE: (u32, u32) = (480, 300);
const TEXTURE: (u32, u32) = (160, 100);

const WINDOWS: [(&str, &str, f64, f64, [u8; 3]); 5] = [
    ("calendar", "Calendar", 60.0, 90.0, [64, 132, 220]),
    ("notes", "Notes", 520.0, 120.0, [236, 184, 64]),
    ("mail", "Mail", 900.0, 80.0, [90, 190, 120]),
    ("terminal", "Terminal", 120.0, 430.0, [40, 40, 48]),
    ("files", "Files", 640.0, 400.0, [196, 92, 150]),
];

fn windows() -> Vec<SpreadWindow> {
    WINDOWS
        .iter()
        .map(|(id, title, x, y, _)| SpreadWindow {
            id: (*id).into(),
            title: (*title).into(),
            rect: desk_wm::Rect::new(*x, *y, 480.0, 320.0),
            asleep: false,
        })
        .collect()
}

/// What a surface painted: a band of its colour over lines of text, on white.
fn page(colour: [u8; 3]) -> Vec<u8> {
    let (w, h) = TEXTURE;
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            let line = y > 30 && y % 12 < 4 && x > 10 && x < w - 10 - (y * 7) % 40;
            let px = if y < 22 {
                [colour[0], colour[1], colour[2], 255]
            } else if line {
                [120, 120, 130, 255]
            } else {
                [250, 250, 252, 255]
            };
            rgba.extend_from_slice(&px);
        }
    }
    rgba
}

/// The spread as the person drives it, at `now` ms.
fn spread_at(now: f64) -> Spread {
    let start = 2800.0;
    let mut spread = Spread::open(
        windows(),
        (f64::from(APP.0), f64::from(APP.1)),
        false,
        Some("notes"),
        Durations::default(),
        start,
    )
    .expect("five windows");
    if now >= 6000.0 {
        spread.filter("i", 6000.0);
    }
    if now >= 8700.0 {
        assert_eq!(
            spread.key(&KeyPress::new("ArrowRight"), 8700.0),
            SpreadAction::Moved
        );
    }
    if now >= 19100.0 {
        let chosen = spread.key(&KeyPress::new("Enter"), 19100.0);
        let SpreadAction::Choose { id } = chosen else {
            panic!("{chosen:?}")
        };
        spread.choose(&id, windows(), 19100.0);
    }
    spread
}

fn rect(r: desk_wm::Rect) -> Rect {
    Rect::new(r.x as f32, r.y as f32, r.w as f32, r.h as f32)
}

/// The scene the shell draws for `spread` at `now`.
fn scene(spread: &Spread, now: f64, theme: &ChromeTheme) -> Scene {
    let mut scene = Scene::new(SIZE.0, SIZE.1);
    scene.set_wallpaper(Wallpaper::Solid(theme.wallpaper));
    scene.set_projection(stage_projection(APP.1));
    let mut chrome = Chrome::new(theme.clone());
    let root = scene.root();
    let flat = GroupNode {
        transform: Mat4::from_scale(Vec3::new(SCALE, SCALE, 1.0)),
        ..GroupNode::default()
    };
    let app = Rect::new(0.0, 0.0, APP.0, APP.1);
    let under = scene.insert(root, flat).unwrap();
    chrome.spread_scrim(&mut scene, under, app).unwrap();
    let stage = GroupNode {
        transform: stage_transform(SCALE, APP),
        ..GroupNode::default()
    };
    let stage = scene.insert(root, stage).unwrap();
    let frame = spread.frame(now);
    let model = spread.model();
    let mut cards: Vec<&SpreadWindow> = model.windows().iter().collect();
    cards.sort_by_key(|w| model.order_of(&w.id));
    for w in cards {
        let pose = frame.poses[&w.id];
        let at = rect(w.rect);
        let posed = GroupNode {
            transform: pose_transform(
                at,
                (pose.tx as f32, pose.ty as f32, pose.z as f32),
                (pose.rotate_y as f32, pose.rotate_x as f32),
                pose.scale as f32,
            ),
            opacity: pose.opacity as f32,
            clip: None,
        };
        let posed = scene.insert(stage, posed).unwrap();
        let selected = model.selected() == Some(w.id.as_str());
        let made = chrome
            .window(&mut scene, posed, at, &w.title, None, selected)
            .unwrap();
        let texture = TextureId(1 + WINDOWS.iter().position(|x| x.0 == w.id).unwrap() as u64);
        scene
            .insert(made.group, SurfaceNode::new(made.content, texture))
            .unwrap();
        // The ring and the bar stay until the spread has closed, as the runtime's did.
        if selected {
            let local = Rect::new(0.0, 0.0, at.width, at.height);
            chrome.spread_ring(&mut scene, made.group, local).unwrap();
        }
    }
    let over = scene.insert(root, flat).unwrap();
    let shown = model.shown().len();
    let count = if shown == model.windows().len() {
        format!("{shown} windows")
    } else {
        format!("{shown} of {} windows", model.windows().len())
    };
    let text = SpreadText {
        filter: model.filter(),
        placeholder: "Type to filter by title",
        count: &count,
        hint: "Arrows or Tab to choose · Enter to open · Esc to close",
        empty: None,
    };
    chrome.spread_bar(&mut scene, over, app, &text).unwrap();
    scene
}

fn render(gpu: &Headless, scene: &Scene) -> Vec<u8> {
    let mut compositor = compositor(gpu);
    let textures: Vec<wgpu::Texture> = (WINDOWS.iter())
        .map(|w| upload_rgba(&gpu.device, &gpu.queue, TEXTURE, &page(w.4)))
        .collect();
    for (i, texture) in textures.iter().enumerate() {
        compositor.register_texture(TextureId(1 + i as u64), texture);
    }
    let target = Target::new(&gpu.device, SIZE, FORMAT);
    let stats = compositor.render(scene, &target.view, target.size);
    assert!(stats.drawn && stats.missing_textures == 0, "{stats:?}");
    assert_eq!(stats.missing_glyphs, 0, "{stats:?}");
    target.read_rgba(&gpu.device, &gpu.queue).unwrap()
}

#[test]
fn the_clock_alone_decides_what_each_frame_shows() {
    for at in [3000.0, 8800.0, 19300.0] {
        assert_eq!(spread_at(at).frame(at), spread_at(at).frame(at), "{at}");
    }
    // Mid-motion at each of the three times, and settled or closed a little later.
    assert!(spread_at(3000.0).frame(3000.0).moving);
    assert!(!spread_at(3200.0).frame(3200.0).moving);
    assert!(spread_at(8800.0).frame(8800.0).moving);
    let closing = spread_at(19300.0);
    assert!(closing.frame(19300.0).moving);
    assert_eq!(
        closing.frame(19320.0).closed,
        Some(Ending::Chosen("files".into()))
    );
}

#[test]
fn the_spread_fanning_out_at_3_0_s() {
    let Some(gpu) = gpu("the_spread_fanning_out_at_3_0_s") else {
        return;
    };
    let theme = ChromeTheme::from_tokens(&look(""));
    let spread = spread_at(3000.0);
    let rgba = render(&gpu, &scene(&spread, 3000.0, &theme));
    assert_snapshot(&gpu, "spread_3_0s", SIZE, &rgba);
}

#[test]
fn the_spread_filtered_and_moving_at_8_8_s() {
    let Some(gpu) = gpu("the_spread_filtered_and_moving_at_8_8_s") else {
        return;
    };
    let theme = ChromeTheme::from_tokens(&look(""));
    let spread = spread_at(8800.0);
    assert_eq!(spread.model().filter(), "i");
    let shown: Vec<&str> = spread
        .model()
        .shown()
        .iter()
        .map(|w| w.id.as_str())
        .collect();
    assert_eq!(shown, ["terminal", "files", "mail"]);
    let rgba = render(&gpu, &scene(&spread, 8800.0, &theme));
    assert_snapshot(&gpu, "spread_8_8s", SIZE, &rgba);
}

#[test]
fn the_spread_closing_on_the_chosen_window_at_19_3_s() {
    let Some(gpu) = gpu("the_spread_closing_on_the_chosen_window_at_19_3_s") else {
        return;
    };
    let theme = ChromeTheme::from_tokens(&look(""));
    let spread = spread_at(19300.0);
    let rgba = render(&gpu, &scene(&spread, 19300.0, &theme));
    assert_snapshot(&gpu, "spread_19_3s", SIZE, &rgba);
}
