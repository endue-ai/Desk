//! #252, ADR 0211: while a window is resized its pictures (its own page's, its pane's plugin's)
//! come in old and new sizes in any order. The window is drawn at its own page's picture's size,
//! frame and picture together, from its place's top left; its pane's plugin is cropped or padded
//! with the window's fill; neither is stretched, and the title keeps clear of the page's tools. A
//! window drawn from its own page waits for no paint of the desk's page to be placed.

use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::{ChromeTheme, NodeId, NodeKind, Rect, Scene, TextNode, TextureId};
use serde_json::json;

use super::tests::{hosted_at, sources, surface_of};
use super::{Sources, Texture, draw};
use crate::compositor_window::report::DeskReport;

const SCALE: f32 = 2.0;
const OWN: TextureId = TextureId(5);
const PANE: TextureId = TextureId(2);

/// The first text `text` under `id`, and where its groups put it.
fn text_of(scene: &Scene, id: NodeId, text: &str) -> Option<(Vec2, TextNode)> {
    scene
        .children(id)
        .iter()
        .find_map(|child| match &scene.node(*child)?.kind {
            NodeKind::Group(g) => text_of(scene, *child, text)
                .map(|(at, t)| (at + g.transform.w_axis.truncate().truncate(), t)),
            NodeKind::Text(t) if &*t.text == text => Some((Vec2::ZERO, t.clone())),
            _ => None,
        })
}

/// Where `texture` is drawn, in CSS px, checked to hold one texel per device pixel: never stretched.
fn unstretched(scene: &Scene, texture: TextureId, (tw, th): (u32, u32)) -> Rect {
    let (at, node) = surface_of(scene, scene.root(), texture).expect("drawn");
    let texels = (node.uv.width * tw as f32, node.uv.height * th as f32);
    let pixels = (node.rect.width * SCALE, node.rect.height * SCALE);
    assert!(
        (texels.0 - pixels.0).abs() < 1e-2 && (texels.1 - pixels.1).abs() < 1e-2,
        "{texture:?} {tw}x{th}: {texels:?} texels on {pixels:?} pixels"
    );
    assert_eq!(
        (node.uv.x, node.uv.y),
        (0.0, 0.0),
        "from the picture's top left"
    );
    Rect::new(
        at.x + node.rect.x,
        at.y + node.rect.y,
        node.rect.width,
        node.rect.height,
    )
}

#[test]
fn a_resize_draws_the_window_at_its_pictures_size_and_its_panes_cropped_never_stretched() {
    let hosted = hosted_at("live", f64::from(SCALE));
    let theme = ChromeTheme::default();
    let plan = hosted.plan().unwrap();
    let notes = plan.window("endue.notes").unwrap();
    let (r, body) = (notes.rect, notes.panes[0].body);
    let (_, end) = notes.title_insets();
    let px = |w: f64, h: f64| ((w * 2.0).round() as u32, (h * 2.0).round() as u32);
    let (fit, pane) = (px(r.w, r.h), px(body.w, body.h));
    // Its own page's and its pane's pictures: fitting, from before a shrink (larger), from before
    // a growth (smaller), narrower but taller, and fitting again.
    let sizes = [
        (fit, pane),
        (
            px(r.w + 150.0, r.h + 90.0),
            px(body.w + 150.0, body.h + 90.0),
        ),
        (
            px(r.w - 120.0, r.h - 80.0),
            px(body.w - 120.0, body.h - 80.0),
        ),
        (px(r.w - 60.0, r.h + 40.0), px(body.w - 60.0, body.h + 40.0)),
        (px(r.w + 150.0, r.h + 90.0), pane),
        (fit, px(body.w - 120.0, body.h - 80.0)),
        (fit, pane),
    ];
    for (own, plugin) in sizes {
        let textures = |surface: &str| -> Option<Texture> {
            match surface {
                "window:endue.notes" => Some((OWN, own)),
                "main.endue-notes" => Some((PANE, plugin)),
                _ => None,
            }
        };
        let from = Sources {
            scale: SCALE,
            ..sources(&textures)
        };
        let mut scene = Scene::new(2880, 1800);
        let made = draw(&mut scene, &theme, &hosted, &from).unwrap();
        let shown = unstretched(&scene, OWN, own);
        let (w, h) = (own.0 as f32 / SCALE, own.1 as f32 / SCALE);
        let whole = Rect::new(r.x as f32, r.y as f32, w, h);
        assert_eq!(shown, whole, "{own:?}: whole, from the window's top left");
        let framed = made.placed.iter().find(|(s, _)| s == "window:endue.notes");
        assert_eq!(
            framed.map(|(_, at)| *at),
            Some(whole),
            "{own:?}: the window's frame is its picture's size"
        );
        let (bx, by) = (body.x as f32, body.y as f32);
        let drawn = unstretched(&scene, PANE, plugin);
        assert_eq!(
            (drawn.x, drawn.y),
            (bx, by),
            "{plugin:?}: at the pane's top left"
        );
        let (pw, ph) = (plugin.0 as f32 / SCALE, plugin.1 as f32 / SCALE);
        assert_eq!(
            (drawn.width, drawn.height),
            (pw.min(body.w as f32), ph.min(body.h as f32)),
            "{plugin:?}: cropped to the pane"
        );
        // The title ends before the tools, which are where the picture ends.
        let (at, title) = text_of(&scene, scene.root(), "Notes").expect("its title");
        let right = at.x + title.rect.x + title.rect.width;
        let tools = r.x as f32 + shown.width - (end as f32 - theme.window.padding);
        assert!(
            right <= tools + 1e-3,
            "{own:?}: the title ends at {right}, the tools at {tools}"
        );
    }
}

#[test]
fn a_window_with_its_own_page_is_placed_where_its_dom_has_it_without_waiting_for_the_desks_page() {
    let laid_at = |own: bool| {
        let mut hosted = hosted_at("live", 1.0);
        if own {
            hosted.own_pages(["endue.notes".to_owned()].into());
        }
        let r = hosted.plan().unwrap().window("endue.notes").unwrap().rect;
        let report: DeskReport = serde_json::from_value(json!({
            "seq": 2, "width": 1440, "height": 900,
            "frames": [{ "plugin": "endue.notes", "host": "main.endue-notes",
                "src": "desk-plugin://main.endue-notes/index.html", "loads": 1, "state": "live" }],
            "held": { "window": "endue.notes", "x": r.x, "y": r.y, "w": r.w + 120.0, "h": r.h + 80.0 },
        }))
        .unwrap();
        hosted.apply(report, Instant::now());
        let w = hosted
            .plan()
            .unwrap()
            .window("endue.notes")
            .unwrap()
            .clone();
        (desk_wm::Rect::new(r.x, r.y, r.w + 120.0, r.h + 80.0), w)
    };
    let (grown, own) = laid_at(true);
    assert_eq!(own.page, grown, "where its DOM has it, at once");
    assert!(!own.page_parts.is_empty());
    // A window the desk's page draws waits for that page's paints (or its quiet) to show it.
    let (_, drawn) = laid_at(false);
    assert!(
        drawn.page_parts.is_empty(),
        "not painted yet: {:?}",
        drawn.page_parts
    );
}
