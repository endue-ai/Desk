//! The spread, a sleeping window and the canvas map as the scene draws them (#54), on the CPU: what
//! the GPU then draws is `desk-compositor`'s snapshots' (`spread_snapshots.rs`, `thumbnails.rs`).

use std::time::Instant;

use desk_compositor::glam::Vec2;
use desk_compositor::{ChromeTheme, Projection, Rect, Scene, TextureId, hit_test};
use desk_wm::{Durations, KeyPress, Spread};
use serde_json::json;

use crate::compositor_window::draw::{Sources, Texture, draw};
use crate::compositor_window::draw_map::{MapSource, layout};
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::report::DeskReport;

/// Notes and Files, two plugin windows in their slots; Files' frame in `files` state.
fn hosted(files: &str) -> Hosted {
    let frame = |plugin: &str, host: &str, state: &str| {
        json!({ "plugin": plugin, "host": host, "src": format!("desk-plugin://{host}/index.html"),
            "loads": 1, "state": state, "card": { "title": "Files",
            "line": "Unloaded while out of sight.", "actions": ["Reload"] } })
    };
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1440, "height": 900,
        "frames": [frame("endue.notes", "main.endue-notes", "live"),
            frame("endue.files", "main.endue-files", files)],
        "copy": { "spread": { "count": "{n} windows", "filter": "Type to filter by title" } },
    }))
    .unwrap();
    let mut hosted = Hosted::new(1.0);
    let adopt = |id: &str, title: &str| desk_wm::edits::Edit::Adopt {
        id: id.into(),
        title: title.into(),
    };
    hosted.wm.edit(
        1,
        &[adopt("endue.notes", "Notes"), adopt("endue.files", "Files")],
    );
    hosted.apply(report, Instant::now());
    hosted
}

fn textures(surface: &str) -> Option<Texture> {
    match surface {
        "main.endue-notes" => Some((TextureId(2), (400, 263))),
        "main.endue-files" => Some((TextureId(3), (400, 263))),
        _ => None,
    }
}

fn sources<'a>(spread: Option<(&'a Spread, f64)>, map: Option<MapSource<'a>>) -> Sources<'a> {
    Sources {
        scale: 1.0,
        page: Some((TextureId(1), (1440, 900))),
        surface: &textures,
        spread,
        map,
    }
}

fn spread_of(hosted: &Hosted) -> Spread {
    let plan = hosted.plan().unwrap();
    let windows = (plan.windows.iter())
        .map(|w| desk_wm::SpreadWindow {
            id: w.id.clone(),
            title: w.title.clone(),
            rect: w.rect,
            asleep: false,
        })
        .collect();
    let screen = (plan.screen.w, plan.screen.h);
    let durations = Durations::none();
    Spread::open(windows, screen, false, Some("endue.notes"), durations, 0.0).unwrap()
}

#[test]
fn the_spread_poses_every_window_under_the_stages_perspective_and_names_each_card() {
    let hosted = hosted("live");
    let spread = spread_of(&hosted);
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(Some((&spread, 0.0)), None),
    )
    .unwrap();
    assert!(matches!(scene.projection(), Projection::Perspective { .. }));
    let ids: Vec<&str> = drawn.cards.iter().map(|(_, id)| id.as_str()).collect();
    assert_eq!(ids.len(), 2, "{ids:?}");
    assert!(!drawn.bar.is_empty(), "the field, the count and the hint");
    // Each card's middle on screen is that card: the pointer finds its window through the pose.
    for (node, id) in &drawn.cards {
        let r = scene.screen_bounds(*node).unwrap();
        let middle = Vec2::new(r.x + r.width / 2.0, r.y + r.height / 2.0);
        assert_eq!(
            hit_test(&scene, middle).map(|h| h.node),
            Some(*node),
            "{id}"
        );
    }
    // Both surfaces still draw, live, on their cards.
    let surfaces: Vec<&str> = drawn
        .shown
        .iter()
        .map(|(_, t)| t.surface.as_str())
        .collect();
    assert!(surfaces.contains(&"main.endue-notes") && surfaces.contains(&"main.endue-files"));
    let a11y = drawn.spread.unwrap();
    assert_eq!(a11y.count, "2 windows");
    assert_eq!(a11y.field, "Type to filter by title");
    let selected: Vec<&str> = (a11y.options.iter())
        .filter(|o| o.selected)
        .map(|o| o.id.as_str())
        .collect();
    assert_eq!(selected, ["endue.notes"], "it opens on the window in use");
}

#[test]
fn a_filtered_out_card_is_drawn_faded_and_takes_no_pointer() {
    let hosted = hosted("live");
    let mut spread = spread_of(&hosted);
    spread.filter("fil", 0.0);
    assert_eq!(
        spread.key(&KeyPress::new("End"), 0.0),
        desk_wm::SpreadAction::Moved
    );
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(Some((&spread, 0.0)), None),
    )
    .unwrap();
    let ids: Vec<&str> = drawn.cards.iter().map(|(_, id)| id.as_str()).collect();
    assert_eq!(ids, ["endue.files"]);
    assert_eq!(drawn.spread.unwrap().options.len(), 1);
}

#[test]
fn a_sleeping_window_shows_its_last_frame_greyed_under_its_card_with_reload() {
    let hosted = hosted("asleep");
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(None, None),
    )
    .unwrap();
    let greyed = (scene.root_nodes())
        .filter_map(|n| match &scene.node(n)?.kind {
            desk_compositor::NodeKind::Surface(s) if s.texture == TextureId(3) => Some(s.grey),
            _ => None,
        })
        .collect::<Vec<f32>>();
    assert_eq!(greyed, [1.0], "Files' last frame, greyed");
    let [reload] = drawn.buttons.as_slice() else {
        panic!("one button: {:?}", drawn.buttons)
    };
    assert_eq!(
        (reload.command, reload.plugin.as_str()),
        ("desk.frames.reload", "endue.files")
    );
    assert!(
        !drawn
            .shown
            .iter()
            .any(|(_, t)| t.surface == "main.endue-files"),
        "a sleeping surface takes no input"
    );
}

#[test]
fn the_canvas_map_sits_in_the_bottom_right_from_the_panes_thumbnails_or_folded_to_its_button() {
    let hosted = hosted("live");
    let laid = layout(&hosted, None).unwrap();
    // 70 px from the right and 64 from the bottom, 192 by 120 inside 5 px.
    assert_eq!(
        laid.canvas,
        Rect::new(
            1440.0 - 70.0 - 5.0 - 192.0,
            900.0 - 64.0 - 5.0 - 120.0,
            192.0,
            120.0
        )
    );
    assert_eq!(
        laid.button,
        Rect::new(1440.0 - 70.0 - 32.0, 900.0 - 64.0 - 32.0, 32.0, 32.0)
    );
    assert_eq!(laid.windows.len(), 2);
    for w in &laid.windows {
        assert_eq!(w.panes.len(), 1, "{w:?}");
        assert!(laid.canvas.contains(Vec2::new(w.rect.x, w.rect.y)), "{w:?}");
    }
    let thumbnail = |host: &str| (host == "main.endue-notes").then_some(TextureId(40));
    let open = MapSource {
        layout: &laid,
        folded: false,
        thumbnail: &thumbnail,
    };
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(None, Some(open)),
    )
    .unwrap();
    let map = drawn.map.unwrap();
    assert!(map.canvas.is_some() && map.view.is_some());
    let thumbs = (scene.root_nodes())
        .filter(|n| {
            matches!(&scene.node(*n).map(|n| &n.kind),
                Some(desk_compositor::NodeKind::Surface(s)) if s.texture == TextureId(40))
        })
        .count();
    assert_eq!(thumbs, 1, "Notes from its thumbnail; Files has none yet");
    // The fold button over the canvas takes the pointer first.
    let b = laid.outer;
    let on = Vec2::new(b.x + b.width - 18.0, b.y + 18.0);
    assert_eq!(hit_test(&scene, on).map(|h| h.node), Some(map.button));
    let folded = MapSource {
        layout: &laid,
        folded: true,
        thumbnail: &thumbnail,
    };
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(
        &mut scene,
        &ChromeTheme::default(),
        &hosted,
        &sources(None, Some(folded)),
    )
    .unwrap();
    let map = drawn.map.unwrap();
    assert_eq!((map.canvas, map.view), (None, None));
    let middle = Vec2::new(laid.button.x + 16.0, laid.button.y + 16.0);
    assert_eq!(hit_test(&scene, middle).map(|h| h.node), Some(map.button));
}

/// Every node of a scene, depth first.
trait Nodes {
    fn root_nodes(&self) -> std::vec::IntoIter<desk_compositor::NodeId>;
}

impl Nodes for Scene {
    fn root_nodes(&self) -> std::vec::IntoIter<desk_compositor::NodeId> {
        let mut all = Vec::new();
        let mut stack = vec![self.root()];
        while let Some(n) = stack.pop() {
            all.push(n);
            stack.extend(self.children(n).iter().copied());
        }
        all.into_iter()
    }
}
