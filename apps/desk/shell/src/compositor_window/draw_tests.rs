use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::input::Target;
use desk_compositor::{ChromeTheme, Rect, Scene, TextureId, hit_test};
use serde_json::json;

use super::{Sources, Texture, draw, sampled};
use crate::compositor_window::PAGE;
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::report::DeskReport;

#[test]
fn a_frame_fills_its_pane_and_an_older_smaller_one_is_never_stretched() {
    let pane = Rect::new(10.0, 20.0, 400.0, 300.0);
    let whole = sampled(pane, (TextureId(3), (800, 600)), 2.0);
    assert_eq!(
        (whole.rect, whole.uv),
        (pane, Rect::new(0.0, 0.0, 1.0, 1.0))
    );
    let older = sampled(pane, (TextureId(3), (400, 600)), 2.0);
    assert_eq!(
        older.rect,
        Rect::new(10.0, 20.0, 200.0, 300.0),
        "the rest shows the frame"
    );
    let larger = sampled(pane, (TextureId(3), (1000, 600)), 2.0);
    assert_eq!(larger.uv, Rect::new(0.0, 0.0, 0.8, 1.0), "cropped");
}

/// One plugin window, Notes, in its slot, its frame live (or `state`).
fn hosted(state: &str) -> Hosted {
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1440, "height": 900,
        "desk": { "desktop": "1", "adopted": [{ "id": "endue.notes", "title": "Notes", "slot": 0 }] },
        "frames": [{ "plugin": "endue.notes", "host": "main.endue-notes",
            "src": "desk-plugin://main.endue-notes/index.html", "loads": 1, "state": state,
            "card": { "title": "Notes", "line": "Stopped.", "actions": ["Reload"] } }],
    }))
    .unwrap();
    let mut hosted = Hosted::new(1.0);
    hosted.apply(report, Instant::now());
    hosted
}

fn textures(surface: &str) -> Option<Texture> {
    (surface == "main.endue-notes").then_some((TextureId(2), (400, 263)))
}

fn sources(surface: &dyn Fn(&str) -> Option<Texture>) -> Sources<'_> {
    Sources {
        scale: 1.0,
        page: Some((TextureId(1), (1440, 900))),
        surface,
    }
}

#[test]
fn the_pointer_finds_the_plugin_in_its_pane_and_the_page_everywhere_else() {
    let hosted = hosted("live");
    let mut scene = Scene::new(1440, 900);
    let shown = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(&textures),
    )
    .unwrap();
    let pane = hosted.plan().unwrap().seat("endue.notes");
    assert_eq!(pane.size, Some((400.0, 263.0)));
    let target = |at: Vec2| {
        let hit = hit_test(&scene, at)?;
        let t: &Target = &shown.iter().find(|(node, _)| *node == hit.node)?.1;
        Some((t.surface.clone(), t.origin + hit.local_point * t.per_unit))
    };
    // Inside the pane's body (the slot at 104,190; body from 105,231): Notes, at its own point.
    let (surface, at) = target(Vec2::new(115.0, 241.0)).unwrap();
    assert_eq!(
        (surface.as_str(), at),
        ("main.endue-notes", Vec2::new(10.0, 10.0))
    );
    // On its title bar, its frame's edge and the wallpaper: the page, at the same point.
    for point in [
        Vec2::new(300.0, 210.0),
        Vec2::new(104.5, 400.0),
        Vec2::new(700.0, 860.0),
    ] {
        let (surface, at) = target(point).unwrap();
        assert_eq!(surface, PAGE, "{point}");
        assert!(at.distance(point) < 1e-3, "{point}: {at}");
    }
}

#[test]
fn a_window_without_a_live_frame_shows_its_card_and_the_pointer_goes_to_the_page() {
    let hosted = hosted("stopped");
    let mut scene = Scene::new(1440, 900);
    let shown = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(&textures),
    )
    .unwrap();
    assert!(
        shown.iter().all(|(_, t)| t.surface == PAGE),
        "no quad for a stopped frame"
    );
    let hit = hit_test(&scene, Vec2::new(305.0, 400.0)).unwrap();
    let under = shown.iter().find(|(node, _)| *node == hit.node).unwrap();
    assert_eq!(under.1.surface, PAGE, "the card lets the pointer through");
}
