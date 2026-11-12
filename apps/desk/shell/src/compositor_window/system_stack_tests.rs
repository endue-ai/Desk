//! The overlays stacked as the page stacks them (ADR 0190): one shown later is drawn above the
//! others and takes the pointer, whatever the order the page names them in.

use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::{ChromeTheme, Scene, TextureId, hit_test};
use serde_json::{Value, json};

use crate::compositor_window::draw::{Sources, Texture, draw};
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::report::DeskReport;

const PALETTE: &str = "main.desk-palette";
const QUESTION: &str = "main.endue-permissions";

/// The palette and a permission question over the whole app, named in that order, stacked at the
/// page's `z` each, over Notes's window.
fn hosted(palette: f64, question: f64) -> Hosted {
    let overlay = |plugin: &str, host: &str, z: f64| -> Value {
        json!({ "plugin": plugin, "host": host, "src": format!("desk-plugin://{host}/i.html"),
            "loads": 1, "state": "live", "place": { "x": 0, "y": 0, "width": 1280, "height": 800,
            "shown": true, "layer": "overlay", "z": z } })
    };
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1280, "height": 800, "applied": 1,
        "frames": [
            { "plugin": "endue.notes", "host": "main.endue-notes",
              "src": "desk-plugin://main.endue-notes/i.html", "loads": 1, "state": "live" },
            overlay("desk.palette", PALETTE, palette),
            overlay("endue.permissions", QUESTION, question)
        ]
    }))
    .unwrap();
    let mut hosted = Hosted::new(1.0);
    let adopt = desk_wm::edits::Edit::Adopt {
        id: "endue.notes".into(),
        title: "Notes".into(),
    };
    hosted.wm.edit(1, &[adopt]);
    hosted.apply(report, Instant::now());
    hosted
}

fn textures(surface: &str) -> Option<Texture> {
    match surface {
        PALETTE => Some((TextureId(3), (1280, 800))),
        QUESTION => Some((TextureId(5), (1280, 800))),
        _ => None,
    }
}

/// The surface a press in the middle of the app reaches, and the system layer back to front.
fn front(hosted: &Hosted) -> (String, Vec<String>) {
    let mut scene = Scene::new(1280, 800);
    let sources = Sources {
        scale: 1.0,
        page: Some((TextureId(1), (1280, 800))),
        surface: &textures,
        popup: &crate::compositor_window::draw_popup::none,
        spread: None,
        map: None,
    };
    let drawn = draw(&mut scene, &ChromeTheme::default(), hosted, &sources).unwrap();
    let hit = hit_test(&scene, Vec2::new(640.0, 400.0)).expect("something is there");
    let (_, target) = (drawn.shown.iter())
        .find(|(n, _)| *n == hit.node)
        .expect("a surface is there");
    (target.surface.clone(), drawn.order)
}

#[test]
fn an_overlay_shown_later_is_drawn_above_the_others_and_takes_the_pointer() {
    // A question shown over the palette: in front of it.
    let (heard, order) = front(&hosted(11.0, 12.0));
    assert_eq!(heard, QUESTION);
    assert_eq!(order, ["desk", "desk.palette", "endue.permissions"]);
    // The palette opened over a question: in front of it, though the page names it first.
    let (heard, order) = front(&hosted(13.0, 12.0));
    assert_eq!(heard, PALETTE);
    assert_eq!(order, ["desk", "endue.permissions", "desk.palette"]);
    // Neither raised yet: in the order the page names them, as its sections stack.
    assert_eq!(front(&hosted(0.0, 0.0)).0, QUESTION);
}
