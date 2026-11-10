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
    .unwrap()
    .shown;
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
fn a_window_without_a_live_frame_shows_its_card_whose_button_runs_its_command() {
    let hosted = hosted("stopped");
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(&textures),
    )
    .unwrap();
    assert!(
        drawn.shown.iter().all(|(_, t)| t.surface == PAGE),
        "no quad for a stopped frame"
    );
    // The card lets the pointer through to the page, but on its Reload button (centred under the
    // card's line, in the pane's body from 105,231).
    let hit = hit_test(&scene, Vec2::new(305.0, 300.0)).unwrap();
    let under = drawn
        .shown
        .iter()
        .find(|(node, _)| *node == hit.node)
        .unwrap();
    assert_eq!(under.1.surface, PAGE, "the card lets the pointer through");
    let [button] = drawn.buttons.as_slice() else {
        panic!("one button: {:?}", drawn.buttons)
    };
    assert_eq!(
        (button.command, button.plugin.as_str()),
        ("desk.frames.reload", "endue.notes")
    );
    let on = hit_test(&scene, Vec2::new(305.0, 408.0)).unwrap();
    assert_eq!(on.node, button.node, "the button takes the pointer");
}

#[test]
fn a_window_that_does_not_answer_offers_wait_and_stop_over_its_last_frame() {
    let hosted = hosted("late");
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(&textures),
    )
    .unwrap();
    let commands: Vec<&str> = drawn.buttons.iter().map(|b| b.command).collect();
    // The report's card names one action; a second it does not name gets no button.
    assert_eq!(commands, ["desk.frames.wait"]);
    assert!(
        drawn
            .shown
            .iter()
            .any(|(_, t)| t.surface == "main.endue-notes")
    );
}

#[test]
fn the_snap_preview_lies_under_the_window_dragged_to_an_edge_and_takes_no_pointer() {
    let mut hosted = hosted("live");
    hosted.wm.set_motion(desk_wm::interact::Motion::none());
    let notes = hosted.plan().unwrap().window("endue.notes").unwrap().rect;
    let from = desk_wm::Point::new(notes.x + 80.0, notes.y + 20.0);
    hosted.wm.pressed(from);
    let kind = desk_wm::interact::Kind::Move {
        window: "endue.notes".into(),
    };
    hosted.wm.grab(kind, from, 0.0);
    hosted.wm.moved(desk_wm::Point::new(3.0, 450.0), 0.0);
    hosted.replan(Instant::now());
    let (part, under) = hosted.preview().cloned().unwrap();
    assert_eq!(
        (part, under.as_str()),
        (
            desk_wm::snap_rect(desk_wm::Fill::Left, 1440.0, 900.0),
            "endue.notes"
        )
    );
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(&textures),
    )
    .unwrap();
    // Off the window, inside the part: the pointer goes to the page under the preview.
    let hit = hit_test(&scene, Vec2::new(300.0, 100.0)).unwrap();
    let under = drawn
        .shown
        .iter()
        .find(|(node, _)| *node == hit.node)
        .unwrap();
    assert_eq!(under.1.surface, PAGE);
}
