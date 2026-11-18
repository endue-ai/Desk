//! The canvas map's size and grips as the scene lays them out (ADR 0270): the width the person
//! gave it, in `MAP`'s proportions against the app's bottom right, under the rail while it fits
//! there, and the grips along its left and top edges that the pointer finds before the canvas.

use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::{ChromeTheme, Rect, Scene, hit_test};
use desk_wm::MapEdges;
use serde_json::json;

use super::{MapSource, layout, tall};
use crate::compositor_window::draw::{Sources, Texture, draw};
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::report::DeskReport;

/// A 1440×900 desk with Notes and Files, the map as the page reports it.
fn hosted(height: f64, map: serde_json::Value) -> Hosted {
    let frame = |plugin: &str, host: &str| {
        json!({ "plugin": plugin, "host": host, "src": format!("desk-plugin://{host}/index.html"),
            "loads": 1, "state": "live" })
    };
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1440, "height": height,
        "frames": [frame("endue.notes", "main.endue-notes"), frame("endue.files", "main.endue-files")],
        "icons": { "plugin:endue.notes": "M5 4h10l4 4v12H5z", "plugin:endue.files": "M6 3h8l5 5v13H6z" },
        "map": map,
    }))
    .unwrap();
    let mut hosted = Hosted::new(1.0);
    let adopt = |id: &str, title: &str| desk_wm::edits::Edit::Adopt {
        id: id.into(),
        title: title.into(),
        window: None,
    };
    hosted.wm.edit(
        1,
        &[adopt("endue.notes", "Notes"), adopt("endue.files", "Files")],
    );
    hosted.apply(report, Instant::now());
    hosted
}

fn no_texture(_: &str) -> Option<Texture> {
    None
}

/// The canvas a map `w` by `h` wide, `right` from the app's right edge, in a 1440×`vh` app.
fn canvas(vh: f32, right: f32, w: f32, h: f32) -> Rect {
    Rect::new(1440.0 - right - 5.0 - w, vh - 64.0 - 5.0 - h, w, h)
}

#[test]
fn the_rail_clears_the_default_box_from_734_high_and_a_taller_one_later() {
    assert_eq!(tall(130.0), 734.0);
    assert_eq!(tall(190.0), 854.0);
}

#[test]
fn a_resized_map_keeps_its_proportions_and_the_apps_bottom_right() {
    let laid = layout(&hosted(900.0, json!({ "width": 288 })), None, None).unwrap();
    assert_eq!(laid.width, 288.0);
    assert_eq!(laid.canvas, canvas(900.0, 24.0, 288.0, 180.0));
    // Every window with its icon, in its box.
    for w in &laid.windows {
        let (_, square) = w.icon.clone().unwrap();
        assert!(
            w.rect.contains((square.min() + square.max()) / 2.0),
            "{w:?}"
        );
        assert!(
            square.width <= 28.0 && square.width == square.height,
            "{w:?}"
        );
    }
    // Too tall to lie under the rail: left of the rail's column, as in a short app.
    let widest = layout(&hosted(900.0, json!({ "width": 480 })), None, None).unwrap();
    assert_eq!(widest.canvas, canvas(900.0, 92.0, 480.0, 300.0));
    let tall_app = layout(&hosted(1100.0, json!({ "width": 480 })), None, None).unwrap();
    assert_eq!(tall_app.canvas, canvas(1100.0, 24.0, 480.0, 300.0));
    // A width out of bounds is held to them; while a resize lasts, its width wins.
    let least = layout(&hosted(900.0, json!({ "width": 20 })), None, None).unwrap();
    assert_eq!((least.canvas.width, least.canvas.height), (144.0, 90.0));
    let live = layout(&hosted(900.0, json!({ "width": 288 })), None, Some(240.0)).unwrap();
    assert_eq!(live.canvas, canvas(900.0, 24.0, 240.0, 150.0));
}

#[test]
fn the_grips_along_the_left_and_top_edges_take_the_pointer_before_the_canvas() {
    let hosted = hosted(900.0, json!({}));
    let laid = layout(&hosted, None, None).unwrap();
    let none = |_: &str| None;
    let map = MapSource {
        layout: &laid,
        folded: false,
        icon: &none,
    };
    let sources = Sources {
        scale: 1.0,
        page: None,
        surface: &no_texture,
        popup: &crate::compositor_window::draw_popup::none,
        web: &crate::compositor_window::draw_web::none,
        spread: None,
        map: Some(map),
    };
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(&mut scene, &ChromeTheme::default(), &hosted, &sources).unwrap();
    let map = drawn.map.unwrap();
    let edges_at = |x: f32, y: f32| {
        let hit = hit_test(&scene, Vec2::new(x, y))?.node;
        map.grips.iter().find(|(g, _)| *g == hit).map(|(_, e)| *e)
    };
    let o = laid.outer;
    let both = MapEdges {
        left: true,
        top: true,
    };
    assert_eq!(edges_at(o.x, o.y), Some(both), "the corner");
    assert_eq!(
        edges_at(o.x - 3.0, o.y + 2.0),
        Some(both),
        "just outside it"
    );
    let left = edges_at(o.x + 1.0, o.y + o.height / 2.0);
    assert_eq!(left.map(|e| (e.left, e.top)), Some((true, false)));
    let top = edges_at(o.x + o.width / 2.0, o.y + 1.0);
    assert_eq!(top.map(|e| (e.left, e.top)), Some((false, true)));
    assert_eq!(
        edges_at(o.x + o.width / 2.0, o.y + o.height / 2.0),
        None,
        "the canvas"
    );
    // The fold button stays the button's.
    let button = Vec2::new(o.x + o.width - 18.0, o.y + 18.0);
    assert_eq!(hit_test(&scene, button).map(|h| h.node), Some(map.button));
    assert_eq!(
        edges_at(o.x + o.width - 4.0, o.y),
        None,
        "the top grip stops short of it"
    );
}
