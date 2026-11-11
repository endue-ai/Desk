use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::input::Target;
use desk_compositor::{ChromeTheme, NodeKind, Rect, Scene, TextureId, hit_test};
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
        "frames": [{ "plugin": "endue.notes", "host": "main.endue-notes",
            "src": "desk-plugin://main.endue-notes/index.html", "loads": 1, "state": state,
            "card": { "title": "Notes", "line": "Stopped.", "actions": ["Reload"] } }],
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
    (surface == "main.endue-notes").then_some((TextureId(2), (400, 263)))
}

fn sources(surface: &dyn Fn(&str) -> Option<Texture>) -> Sources<'_> {
    Sources {
        scale: 1.0,
        page: Some((TextureId(1), (1440, 900))),
        surface,
        popup: &crate::compositor_window::draw_popup::none,
        spread: None,
        map: None,
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
    assert_eq!(pane.size, Some((379.0, 219.0)));
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
    let on = hit_test(&scene, Vec2::new(295.0, 386.0)).unwrap();
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

#[test]
fn a_part_of_the_page_is_cut_to_what_its_texture_holds_never_its_edge_stretched() {
    // A page texture not grown to the app's new size yet (1280×800 for 1440×900), and a window's
    // part laid out across its bottom right corner.
    let small = Sources {
        page: Some((TextureId(1), (1280, 800))),
        ..sources(&textures)
    };
    let mut scene = Scene::new(1440, 900);
    let root = scene.root();
    let mut shown = Vec::new();
    let at = Rect::new(1200.0, 700.0, 200.0, 150.0);
    let to = Rect::new(1000.0, 500.0, 200.0, 150.0);
    super::page_part(&mut scene, root, at, to, &small, &mut shown).unwrap();
    let (node, target) = shown.pop().unwrap();
    let Some(NodeKind::Surface(drawn)) = scene.node(node).map(|n| n.kind.clone()) else {
        panic!("a surface node");
    };
    assert_eq!(drawn.rect, Rect::new(1000.0, 500.0, 80.0, 100.0));
    let uv = Rect::new(1200.0 / 1280.0, 700.0 / 800.0, 80.0 / 1280.0, 100.0 / 800.0);
    assert_eq!(drawn.uv, uv, "inside the texture");
    assert_eq!(target.origin, Vec2::new(1200.0, 700.0));
    // Wholly past it: nothing is drawn.
    let past = Rect::new(1300.0, 100.0, 100.0, 100.0);
    super::page_part(&mut scene, root, past, past, &small, &mut shown).unwrap();
    assert!(shown.is_empty());
}

#[test]
fn an_open_popup_is_drawn_over_its_surface_and_the_page_s_over_everything_heard_where_it_lies() {
    // Notes's list under its field, the page's under a field of its settings.
    let popup = |surface: &str| match surface {
        "main.endue-notes" => Some((
            Rect::new(10.0, 34.0, 140.0, 100.0),
            (TextureId(5), (140, 100)),
        )),
        PAGE => Some((
            Rect::new(600.0, 300.0, 200.0, 150.0),
            (TextureId(6), (200, 150)),
        )),
        _ => None,
    };
    let hosted = hosted("live");
    let mut scene = Scene::new(1440, 900);
    let from = Sources {
        popup: &popup,
        ..sources(&textures)
    };
    let shown = draw(&mut scene, &ChromeTheme::default(), &hosted, &from)
        .unwrap()
        .shown;
    let under = |at: Vec2| {
        let hit = hit_test(&scene, at)?;
        let Some(NodeKind::Surface(node)) = scene.node(hit.node).map(|n| n.kind.clone()) else {
            return None;
        };
        let t: &Target = &shown.iter().find(|(id, _)| *id == hit.node)?.1;
        Some((
            node.texture,
            t.surface.clone(),
            t.origin + hit.local_point * t.per_unit,
        ))
    };
    // The pane's body starts at 105,231: the list from 115,265, the pointer on it Notes's there.
    let (texture, surface, at) = under(Vec2::new(135.0, 285.0)).unwrap();
    assert_eq!(texture, TextureId(5), "the list, over the frame");
    assert_eq!(
        (surface.as_str(), at),
        ("main.endue-notes", Vec2::new(30.0, 54.0))
    );
    // Beside it, the frame itself.
    assert_eq!(under(Vec2::new(300.0, 285.0)).unwrap().0, TextureId(2));
    // The page's list over the window and the page's own layer, the page hearing its own point.
    let (texture, surface, at) = under(Vec2::new(650.0, 350.0)).unwrap();
    assert_eq!(
        (texture, surface.as_str(), at),
        (TextureId(6), PAGE, Vec2::new(650.0, 350.0))
    );
}
