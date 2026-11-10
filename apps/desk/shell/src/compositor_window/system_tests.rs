use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::input::Target;
use desk_compositor::{ChromeTheme, Scene, TextureId, hit_test};
use desk_wm::host::intersect;
use serde_json::{Value, json};

use super::pieces;
use crate::compositor_window::PAGE;
use crate::compositor_window::draw::{Sources, Texture, draw};
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::report::DeskReport;

const NOTES: &str = "main.endue-notes";
const PALETTE: &str = "main.desk-palette";
const DOCK: &str = "main.endue-dock";

/// Notes in its slot (104,190, 402 × 305), the dock along the bottom, the palette over the whole
/// app while `palette` shows, and the agent bar's part lying over Notes's window.
fn hosted(palette: bool) -> Hosted {
    let place = |x: f64, y: f64, w: f64, h: f64, shown: bool, layer: &str| -> Value {
        json!({ "x": x, "y": y, "width": w, "height": h, "shown": shown, "layer": layer })
    };
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1440, "height": 900,
        "frames": [
            { "plugin": "endue.notes", "host": NOTES, "src": "desk-plugin://main.endue-notes/i.html",
              "loads": 1, "state": "live" },
            { "plugin": "desk.palette", "host": PALETTE, "src": "desk-plugin://main.desk-palette/i.html",
              "loads": 1, "state": "live", "place": place(0.0, 0.0, 1440.0, 900.0, palette, "overlay") },
            { "plugin": "endue.dock", "host": DOCK, "src": "desk-plugin://main.endue-dock/i.html",
              "loads": 1, "state": "live", "place": place(300.0, 820.0, 800.0, 60.0, true, "edge") }
        ],
        "parts": [
            { "id": "desk.agents", "x": 24, "y": 300, "width": 120, "height": 200 },
            { "id": "desk.nope", "x": 600, "y": 600, "width": 50, "height": 50 }
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
        NOTES => Some((TextureId(2), (400, 263))),
        PALETTE => Some((TextureId(3), (1440, 900))),
        DOCK => Some((TextureId(4), (800, 60))),
        _ => None,
    }
}

/// What the pointer at `at` reaches: its surface.
fn reached(palette: bool, at: Vec2) -> (String, Vec<String>, Vec<String>) {
    let hosted = hosted(palette);
    let mut scene = Scene::new(1440, 900);
    let sources = Sources {
        scale: 1.0,
        page: Some((TextureId(1), (1440, 900))),
        surface: &textures,
        spread: None,
        map: None,
    };
    let drawn = draw(&mut scene, &ChromeTheme::default(), &hosted, &sources).unwrap();
    let hit = hit_test(&scene, at).expect("something is under the pointer");
    let target: &Target = &drawn.shown.iter().find(|(n, _)| *n == hit.node).unwrap().1;
    (target.surface.clone(), drawn.parts, drawn.order)
}

#[test]
fn an_overlay_comes_over_every_window_and_the_desks_own_system_surface() {
    for point in [
        Vec2::new(115.0, 241.0),
        Vec2::new(60.0, 400.0),
        Vec2::new(700.0, 850.0),
    ] {
        assert_eq!(reached(true, point).0, PALETTE, "{point}");
    }
    let (_, _, order) = reached(true, Vec2::new(1.0, 1.0));
    assert_eq!(
        order,
        ["endue.dock", "desk", "desk.palette"],
        "back to front"
    );
}

#[test]
fn a_named_part_of_the_desk_takes_the_pointer_over_a_window_and_an_edge_bar_its_own() {
    // The agent bar lies over Notes's window: the bar's press is the desk's, not the plugin's.
    let (over_window, parts, order) = reached(false, Vec2::new(130.0, 400.0));
    assert_eq!(order, ["endue.dock", "desk"], "the palette hidden");
    assert_eq!(over_window, PAGE);
    assert_eq!(parts, ["desk.agents"], "an unknown part is not drawn");
    // Notes's pane where no bar lies over it: Notes.
    assert_eq!(reached(false, Vec2::new(300.0, 241.0)).0, NOTES);
    // The dock under the page's system layer still hears its own presses.
    assert_eq!(reached(false, Vec2::new(700.0, 850.0)).0, DOCK);
    // The wallpaper: the page.
    assert_eq!(reached(false, Vec2::new(1300.0, 600.0)).0, PAGE);
}

#[test]
fn the_desks_system_surface_is_drawn_in_pieces_that_never_overlap() {
    let hosted = hosted(false);
    let plan = hosted.plan().unwrap();
    let split = pieces(&plan.page, &hosted);
    let mut all: Vec<desk_wm::Rect> = split.page.clone();
    for (_, boxes) in &split.parts {
        all.extend(boxes.iter().copied());
    }
    for (i, a) in all.iter().enumerate() {
        for b in &all[i + 1..] {
            let overlap = intersect(*a, *b).map_or(0.0, |r| r.w * r.h);
            assert!(overlap < 1e-6, "{a:?} and {b:?} overlap");
        }
    }
    // The part's box is covered whole, whatever the page's pieces left out there.
    let part = desk_wm::Rect::new(24.0, 300.0, 120.0, 200.0);
    let covered: f64 = all
        .iter()
        .filter_map(|r| intersect(*r, part))
        .map(|r| r.w * r.h)
        .sum();
    assert!((covered - part.w * part.h).abs() < 1e-6, "{covered}");
}
