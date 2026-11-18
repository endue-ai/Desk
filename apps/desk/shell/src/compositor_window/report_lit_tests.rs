//! What the report's lit windows draw (ADR 0271): a glow around the frame of each window Eris is
//! at, as bright as the page says, in the window's own group and under its frame, so it goes
//! where the window goes and under whatever lies over the window.

use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::{ChromeTheme, Color, NodeId, NodeKind, Rect, RectNode, Scene, TextureId};
use serde_json::{Value, json};

use super::DeskReport;
use crate::compositor_window::draw::{Sources, Texture, draw};
use crate::compositor_window::hosted::Hosted;

fn report(seq: u64, lit: Value) -> DeskReport {
    let page = json!({ "seq": seq, "width": 1440, "height": 900, "lit": lit });
    serde_json::from_value(page).unwrap()
}

/// Notes and Mail on the desk, each in a window of its own; the page says which Eris is at.
fn hosted(lit: Value) -> Hosted {
    let mut hosted = Hosted::new(1.0);
    let adopt = |id: &str, title: &str| desk_wm::edits::Edit::Adopt {
        id: id.into(),
        title: title.into(),
        window: None,
    };
    let both = [adopt("endue.notes", "Notes"), adopt("endue.mail", "Mail")];
    hosted.wm.edit(1, &both);
    hosted.apply(report(1, lit), Instant::now());
    hosted
}

fn no_texture(_: &str) -> Option<Texture> {
    None
}

/// The scene of `hosted`, and where it drew each window's frame.
fn drawn(hosted: &Hosted) -> (Scene, Vec<(String, Rect)>) {
    let mut scene = Scene::new(1440, 900);
    let sources = Sources {
        scale: 1.0,
        page: Some((TextureId(1), (1440, 900))),
        surface: &no_texture,
        popup: &crate::compositor_window::draw_popup::none,
        web: &crate::compositor_window::draw_web::none,
        spread: None,
        map: None,
    };
    let drawn = draw(&mut scene, &ChromeTheme::default(), hosted, &sources).unwrap();
    (scene, drawn.windows)
}

/// Every group under `from` with where it puts its children.
fn groups(scene: &Scene, from: NodeId, found: &mut Vec<(Vec2, NodeId)>) {
    for child in scene.children(from).to_vec() {
        if let Some(NodeKind::Group(group)) = scene.node(child).map(|n| &n.kind) {
            let at = group.transform.w_axis;
            found.push((Vec2::new(at.x, at.y), child));
            groups(scene, child, found);
        }
    }
}

/// What lies at the bottom of window `id`'s group: its glow where it has one, else its frame.
fn under(scene: &Scene, windows: &[(String, Rect)], id: &str) -> (NodeId, RectNode) {
    let (_, at) = windows.iter().find(|(w, _)| w == id).expect("drawn");
    let mut found = Vec::new();
    groups(scene, scene.root(), &mut found);
    let window = found.iter().find(|(to, _)| *to == at.min());
    let first = scene.children(window.expect("its group").1)[0];
    match &scene.node(first).unwrap().kind {
        NodeKind::Rect(rect) => (first, *rect),
        other => panic!("a window's group starts with a rectangle, not {other:?}"),
    }
}

#[test]
fn a_window_eris_is_at_glows_around_its_frame_and_the_others_do_not() {
    let hosted = hosted(json!([{ "window": "endue.mail", "level": 1 }]));
    let (scene, windows) = drawn(&hosted);
    assert_eq!(windows.len(), 2);
    let theme = ChromeTheme::default();
    let (_, mail) = windows.iter().find(|(w, _)| w == "endue.mail").unwrap();
    let (node, glow) = under(&scene, &windows, "endue.mail");
    // In the window's own units, the 2 px around its frame: nothing of it lies over the window.
    assert_eq!(
        glow.rect,
        Rect::new(-2.0, -2.0, mail.width + 4.0, mail.height + 4.0)
    );
    assert_eq!(glow.fill, Color::TRANSPARENT);
    assert_eq!(glow.stroke.unwrap().color, theme.window.glow.fade(0.75));
    assert_eq!(glow.shadow.unwrap().color, theme.window.glow.fade(0.42));
    assert!(!scene.node(node).unwrap().hit, "the pointer goes through");
    let (_, frame) = under(&scene, &windows, "endue.notes");
    assert_eq!(frame.fill, theme.window.fill, "Notes starts with its frame");
}

#[test]
fn it_glows_as_brightly_as_the_page_says_and_goes_dark_with_the_next_report() {
    let mut hosted = hosted(json!([{ "window": "endue.notes", "level": 0.6 },
        { "window": "endue.mail", "level": 1 }, { "window": "window-gone", "level": 1 }]));
    let (scene, windows) = drawn(&hosted);
    let brand = ChromeTheme::default().window.glow;
    let rim = |id: &str| under(&scene, &windows, id).1.stroke.unwrap().color;
    // Looked at, Notes glows softer than Mail, which she uses; a window not on the desk is none.
    assert!((rim("endue.notes").a - brand.a * 0.45).abs() < 1e-6);
    assert_eq!(rim("endue.mail"), brand.fade(0.75));
    hosted.apply(report(2, json!([])), Instant::now());
    let (scene, windows) = drawn(&hosted);
    for id in ["endue.notes", "endue.mail"] {
        let (_, first) = under(&scene, &windows, id);
        assert_eq!(first.fill, ChromeTheme::default().window.fill, "{id}");
    }
}
