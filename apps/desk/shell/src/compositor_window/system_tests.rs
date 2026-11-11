use std::time::{Duration, Instant};

use desk_compositor::glam::Vec2;
use desk_compositor::input::Target;
use desk_compositor::{ChromeTheme, Color, NodeId, NodeKind, Scene, TextureId, hit_test};
use desk_wm::host::intersect;
use serde_json::{Value, json};

use super::pieces;
use crate::compositor_window::PAGE;
use crate::compositor_window::draw::{Sources, Texture, draw};
use crate::compositor_window::draw_map::{MapSource, layout};
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::report::DeskReport;

const NOTES: &str = "main.endue-notes";
const PALETTE: &str = "main.desk-palette";
const DOCK: &str = "main.endue-dock";

/// The dock along the bottom, clear of Notes's window.
const DOCK_AT: [f64; 4] = [300.0, 820.0, 800.0, 60.0];

/// Notes in its slot (104,190, 402 × 305), the dock along the bottom, the palette over the whole
/// app while `palette` shows, and the agent bar's part lying over Notes's window.
fn hosted(palette: bool) -> Hosted {
    hosted_with(palette, DOCK_AT)
}

/// The same with the dock's surface at `dock`.
fn hosted_with(palette: bool, dock: [f64; 4]) -> Hosted {
    hosted_parts(palette, dock, &[])
}

/// The same with `more` parts after the agent bar's.
fn hosted_parts(palette: bool, dock: [f64; 4], more: &[Value]) -> Hosted {
    let [dx, dy, dw, dh] = dock;
    let mut parts = vec![
        json!({ "id": "desk.agents", "x": 24, "y": 300, "width": 120, "height": 200 }),
        json!({ "id": "desk.nope", "x": 600, "y": 600, "width": 50, "height": 50 }),
    ];
    parts.extend(more.iter().cloned());
    let place = |x: f64, y: f64, w: f64, h: f64, shown: bool, layer: &str| -> Value {
        json!({ "x": x, "y": y, "width": w, "height": h, "shown": shown, "layer": layer })
    };
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1440, "height": 900, "applied": 1,
        "frames": [
            { "plugin": "endue.notes", "host": NOTES, "src": "desk-plugin://main.endue-notes/i.html",
              "loads": 1, "state": "live" },
            { "plugin": "desk.palette", "host": PALETTE, "src": "desk-plugin://main.desk-palette/i.html",
              "loads": 1, "state": "live", "place": place(0.0, 0.0, 1440.0, 900.0, palette, "overlay") },
            { "plugin": "endue.dock", "host": DOCK, "src": "desk-plugin://main.endue-dock/i.html",
              "loads": 1, "state": "live", "place": place(dx, dy, dw, dh, true, "edge") }
        ],
        "parts": parts
    }))
    .unwrap();
    let mut hosted = Hosted::new(1.0);
    let adopt = desk_wm::edits::Edit::Adopt {
        id: "endue.notes".into(),
        title: "Notes".into(),
    };
    hosted.wm.edit(1, &[adopt]);
    let now = Instant::now();
    hosted.apply(report, now);
    // The page has been quiet long enough to have painted what it laid out: Notes's parts are
    // drawn with Notes.
    hosted.tick(now + Duration::from_millis(desk_wm::host::QUIET_MS as u64 + 50));
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

const PAGE_TEXTURE: TextureId = TextureId(1);

/// `hosted` drawn, as the app would draw it.
fn drawn(hosted: &Hosted) -> (Scene, crate::compositor_window::draw::Drawn) {
    drawn_map(hosted, false)
}

/// The same with the canvas map open while `map`.
fn drawn_map(hosted: &Hosted, map: bool) -> (Scene, crate::compositor_window::draw::Drawn) {
    let mut scene = Scene::new(1440, 900);
    let layout = map.then(|| layout(hosted, None)).flatten();
    let sources = Sources {
        scale: 1.0,
        page: Some((PAGE_TEXTURE, (1440, 900))),
        surface: &textures,
        spread: None,
        map: layout.as_ref().map(|layout| MapSource {
            layout,
            folded: false,
            thumbnail: &|_| None,
        }),
    };
    let drawn = draw(&mut scene, &ChromeTheme::default(), hosted, &sources).unwrap();
    (scene, drawn)
}

/// What the pointer at `at` reaches: its surface.
fn reached(palette: bool, at: Vec2) -> (String, Vec<String>, Vec<String>) {
    reached_in(&hosted(palette), at)
}

fn reached_in(hosted: &Hosted, at: Vec2) -> (String, Vec<String>, Vec<String>) {
    let (scene, drawn) = drawn(hosted);
    let hit = hit_test(&scene, at).expect("something is under the pointer");
    let target: &Target = &drawn.shown.iter().find(|(n, _)| *n == hit.node).unwrap().1;
    (target.surface.clone(), drawn.parts, drawn.order)
}

/// The texture of the topmost surface drawn at `at`, whether it hears the pointer or not.
fn seen_at(hosted: &Hosted, at: Vec2) -> Option<TextureId> {
    let (mut scene, _) = drawn(hosted);
    // Only the surfaces that show something, each hit where it is drawn.
    fn see(scene: &mut Scene, id: NodeId) {
        let Some(node) = scene.node(id).cloned() else {
            return;
        };
        let shows = match &node.kind {
            NodeKind::Group(_) => true,
            NodeKind::Surface(s) => s.opacity > 0.0,
            NodeKind::Rect(_) | NodeKind::Text(_) => false,
        };
        scene.set(id, node.with_hit(shows)).unwrap();
        for child in scene.children(id).to_vec() {
            see(scene, child);
        }
    }
    let root = scene.root();
    see(&mut scene, root);
    let hit = hit_test(&scene, at)?;
    match &scene.node(hit.node)?.kind {
        NodeKind::Surface(s) => Some(s.texture),
        _ => None,
    }
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
fn a_window_under_an_edge_bar_is_drawn_under_it_whole_and_the_bar_hears_what_it_shows() {
    // The dock over Notes's title bar (190..230): the page's pixels of Notes there (its icon, its
    // tools) are drawn with Notes, under the dock, never above it, so what shows is what is pressed.
    let hosted = hosted_with(false, [300.0, 180.0, 800.0, 60.0]);
    let notes = &hosted.plan().unwrap().windows[0];
    assert!(!notes.page_parts.is_empty(), "the page shows Notes");
    let tools = Vec2::new(490.0, 210.0);
    assert_eq!(reached_in(&hosted, tools).0, DOCK);
    assert_eq!(
        seen_at(&hosted, tools),
        Some(TextureId(4)),
        "the dock, not the page"
    );
    // Clear of the dock, Notes's icon is the page's, drawn and heard.
    let icon = Vec2::new(120.0, 210.0);
    assert_eq!(seen_at(&hosted, icon), Some(PAGE_TEXTURE));
    assert_eq!(reached_in(&hosted, icon).0, PAGE);
    // Notes's view below the dock: Notes.
    assert_eq!(reached_in(&hosted, Vec2::new(490.0, 245.0)).0, NOTES);
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

/// What shows topmost at `at`, whether it hears the pointer or not: a surface's texture, the fill
/// of a box of the compositor's, or something else of its own.
#[derive(Debug, PartialEq)]
enum Seen {
    Texture(TextureId),
    Fill(Color),
    Other,
}

fn seen(hosted: &Hosted, map: bool, at: Vec2) -> Option<Seen> {
    let (mut scene, _) = drawn_map(hosted, map);
    fn see(scene: &mut Scene, id: NodeId) {
        let Some(node) = scene.node(id).cloned() else {
            return;
        };
        let shows = match &node.kind {
            NodeKind::Surface(s) => s.opacity > 0.0,
            NodeKind::Rect(r) => r.fill.a > 0.0,
            NodeKind::Group(_) | NodeKind::Text(_) => true,
        };
        scene.set(id, node.with_hit(shows)).unwrap();
        for child in scene.children(id).to_vec() {
            see(scene, child);
        }
    }
    let root = scene.root();
    see(&mut scene, root);
    let hit = hit_test(&scene, at)?;
    Some(match &scene.node(hit.node)?.kind {
        NodeKind::Surface(s) => Seen::Texture(s.texture),
        NodeKind::Rect(r) => Seen::Fill(r.fill),
        _ => Seen::Other,
    })
}

/// The surface the pointer at `at` reaches with the canvas map open, if a surface is topmost.
fn heard_with_map(hosted: &Hosted, at: Vec2) -> Option<String> {
    let (scene, drawn) = drawn_map(hosted, true);
    let hit = hit_test(&scene, at)?;
    let found = drawn.shown.iter().find(|(n, _)| *n == hit.node);
    found.map(|(_, target)| target.surface.clone())
}

#[test]
fn a_modals_scrim_dims_every_window_the_dock_and_the_canvas_map_under_its_dialog() {
    // The page's scrim over the whole app and its dialog: the scrim is the compositor's, over
    // everything under the dialog, and a press anywhere outside the dialog is the page's (#158).
    let scrim = json!({ "id": "desk.scrim", "x": 0, "y": 0, "width": 1440, "height": 900 });
    let dialog = json!({ "id": "desk.overlays", "x": 600, "y": 300, "width": 300, "height": 200 });
    // Eris's box reaches into the dialog's: the page shows the dialog there, above her.
    let eris = json!({ "id": "desk.eris", "x": 700, "y": 250, "width": 128, "height": 138 });
    let hosted = hosted_parts(false, DOCK_AT, &[eris, scrim, dialog]);
    let dim = ChromeTheme::default().spread.scrim;
    let (_, drawn) = drawn_map(&hosted, true);
    assert!(
        drawn.parts.iter().any(|p| p == "desk.scrim"),
        "{:?}",
        drawn.parts
    );
    for (what, at) in [
        ("Notes's view", Vec2::new(300.0, 300.0)),
        ("Notes's title", Vec2::new(200.0, 210.0)),
        ("the dock", Vec2::new(700.0, 850.0)),
        ("the canvas map", Vec2::new(1270.0, 770.0)),
        ("the agent bar", Vec2::new(60.0, 400.0)),
        ("Eris", Vec2::new(750.0, 270.0)),
        ("the wallpaper", Vec2::new(1300.0, 100.0)),
    ] {
        assert_eq!(seen(&hosted, true, at), Some(Seen::Fill(dim)), "{what}");
        assert_eq!(heard_with_map(&hosted, at).as_deref(), Some(PAGE), "{what}");
    }
    // The dialog is the page's pixels, above its scrim, where Eris's box reaches into it too.
    for inside in [Vec2::new(650.0, 450.0), Vec2::new(750.0, 330.0)] {
        assert_eq!(
            seen(&hosted, true, inside),
            Some(Seen::Texture(PAGE_TEXTURE)),
            "{inside}"
        );
        assert_eq!(heard_with_map(&hosted, inside).as_deref(), Some(PAGE));
    }
    // The scrim is no piece of the page's: the page's pieces and parts are drawn as before.
    let split = pieces(&hosted.plan().unwrap().page, &hosted);
    assert_eq!(split.scrims, [desk_wm::Rect::new(0.0, 0.0, 1440.0, 900.0)]);
    let ids: Vec<&str> = split.parts.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids, ["desk.agents", "desk.eris", "desk.overlays"]);
    let dialog = desk_wm::Rect::new(600.0, 300.0, 300.0, 200.0);
    assert_eq!(split.parts[2].1, [dialog], "the dialog's box whole");
}

#[test]
fn the_canvas_map_lies_over_the_bars_and_under_the_settings_and_the_overlays_surfaces() {
    // The settings over the map's corner, the bottom edge's controls under its lower edge (#158,
    // #161: the map was drawn over the settings, the studios and the first run).
    let settings =
        json!({ "id": "desk.settings", "x": 1000, "y": 600, "width": 300, "height": 200 });
    let bottom = json!({ "id": "desk.bottom", "x": 1150, "y": 780, "width": 100, "height": 40 });
    let hosted = hosted_parts(false, DOCK_AT, &[bottom, settings]);
    let (scene, drawn) = drawn_map(&hosted, true);
    let map = drawn.map.as_ref().expect("the map is drawn");
    let on_map = |at: Vec2| hit_test(&scene, at).is_some_and(|h| map.nodes.contains(&h.node));
    // Over a bar, the map: it takes the press.
    assert!(on_map(Vec2::new(1230.0, 815.0)));
    // Under the settings: the settings' pixels, heard by the page.
    let under = Vec2::new(1250.0, 750.0);
    assert!(!on_map(under));
    assert_eq!(
        seen(&hosted, true, under),
        Some(Seen::Texture(PAGE_TEXTURE))
    );
    assert_eq!(heard_with_map(&hosted, under).as_deref(), Some(PAGE));
    // An overlay's plugin surface (the palette, the first run) over the map.
    let palette = hosted_parts(true, DOCK_AT, &[]);
    let at = Vec2::new(1270.0, 770.0);
    assert_eq!(seen(&palette, true, at), Some(Seen::Texture(TextureId(3))));
    assert_eq!(heard_with_map(&palette, at).as_deref(), Some(PALETTE));
}
