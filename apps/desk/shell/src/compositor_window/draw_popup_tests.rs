use std::time::{Duration, Instant};

use desk_compositor::glam::Vec2;
use desk_compositor::input::Targets;
use desk_compositor::{ChromeTheme, NodeId, NodeKind, Rect, Scene, TextureId, hit_test};
use serde_json::{Value, json};

use super::{Popup, node};
use crate::compositor_window::PAGE;
use crate::compositor_window::draw::{Drawn, Sources, Texture, draw};
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::input::popup_input::areas;
use crate::compositor_window::report::DeskReport;

/// The app window of the tests: 1440 × 900.
const APP: Rect = Rect {
    x: 0.0,
    y: 0.0,
    width: 1440.0,
    height: 900.0,
};

#[test]
fn a_popup_lies_at_its_place_in_the_surface_and_is_heard_there() {
    let pane = Rect::new(100.0, 200.0, 400.0, 300.0);
    let list = (
        Rect::new(10.0, 34.0, 140.0, 100.0),
        (TextureId(9), (280, 200)),
    );
    let (made, origin) = node(pane, APP, list, 2.0).unwrap();
    assert_eq!(made.rect, Rect::new(110.0, 234.0, 140.0, 100.0));
    assert_eq!(made.uv, Rect::new(0.0, 0.0, 1.0, 1.0));
    assert_eq!(made.texture, TextureId(9));
    assert_eq!(origin, Vec2::new(10.0, 34.0), "the surface's own point");
}

#[test]
fn a_picker_taller_than_its_pane_is_drawn_whole_past_the_pane() {
    // A first window's pane (326 × 169) and the date picker Chromium puts under its field.
    let pane = Rect::new(849.0, 295.0, 326.0, 169.0);
    let picker: Popup = (
        Rect::new(160.0, 38.0, 218.0, 281.0),
        (TextureId(4), (436, 562)),
    );
    let (made, origin) = node(pane, APP, picker, 2.0).unwrap();
    assert_eq!(made.rect, Rect::new(1009.0, 333.0, 218.0, 281.0), "uncut");
    assert_eq!(made.uv, Rect::new(0.0, 0.0, 1.0, 1.0));
    assert_eq!(origin, Vec2::new(160.0, 38.0));
    // Above its pane's top (a field low in its pane, flipped up), whole as well.
    let above: Popup = (
        Rect::new(10.0, -240.0, 218.0, 281.0),
        (TextureId(4), (218, 281)),
    );
    let (made, origin) = node(pane, APP, above, 1.0).unwrap();
    assert_eq!(made.rect, Rect::new(859.0, 55.0, 218.0, 281.0));
    assert_eq!(origin, Vec2::new(10.0, -240.0), "heard at its own place");
}

#[test]
fn a_popup_stays_inside_the_app_window_moved_in_and_never_stretched() {
    let pane = Rect::new(1200.0, 700.0, 200.0, 150.0);
    // Past the app's bottom right (a screen told late): moved in whole, heard at its own place.
    let low: Popup = (
        Rect::new(100.0, 100.0, 200.0, 120.0),
        (TextureId(2), (200, 120)),
    );
    let (made, origin) = node(pane, APP, low, 1.0).unwrap();
    assert_eq!(made.rect, Rect::new(1240.0, 780.0, 200.0, 120.0));
    assert_eq!(made.uv, Rect::new(0.0, 0.0, 1.0, 1.0));
    assert_eq!(origin, Vec2::new(100.0, 100.0));
    // Past its top left: moved in.
    let high: Popup = (
        Rect::new(-1300.0, -800.0, 100.0, 80.0),
        (TextureId(2), (100, 80)),
    );
    assert_eq!(
        node(pane, APP, high, 1.0).unwrap().0.rect,
        Rect::new(0.0, 0.0, 100.0, 80.0)
    );
    // Taller than the app: at its top, cut at its bottom.
    let tall: Popup = (
        Rect::new(0.0, -700.0, 100.0, 1000.0),
        (TextureId(2), (100, 1000)),
    );
    let (made, _) = node(pane, APP, tall, 1.0).unwrap();
    assert_eq!(made.rect, Rect::new(1200.0, 0.0, 100.0, 900.0));
    assert_eq!(made.uv, Rect::new(0.0, 0.0, 1.0, 0.9));
    // A texture not grown to a new size yet: only what it holds.
    let older: Popup = (Rect::new(0.0, 0.0, 100.0, 80.0), (TextureId(2), (50, 80)));
    assert_eq!(node(pane, APP, older, 1.0).unwrap().0.rect.width, 50.0);
    // An empty one: nothing.
    let empty: Popup = (Rect::new(0.0, 0.0, 0.0, 80.0), (TextureId(2), (50, 80)));
    assert!(node(pane, APP, empty, 1.0).is_none());
}

const NOTES: &str = "main.endue-notes";
const MAIL: &str = "main.endue-mail";

/// Notes and Mail in their slots, Mail adopted last, and `parts` of the desk's system layer.
fn hosted(parts: &[Value]) -> Hosted {
    let frame = |plugin: &str, host: &str| {
        json!({ "plugin": plugin, "host": host, "src": format!("desk-plugin://{host}/i.html"),
            "loads": 1, "state": "live" })
    };
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1440, "height": 900, "applied": 1,
        "frames": [frame("endue.notes", NOTES), frame("endue.mail", MAIL)],
        "parts": parts,
    }))
    .unwrap();
    let mut hosted = Hosted::new(1.0);
    for (id, title) in [("endue.notes", "Notes"), ("endue.mail", "Mail")] {
        let adopt = desk_wm::edits::Edit::Adopt {
            id: id.into(),
            title: title.into(),
        };
        hosted.wm.edit(1, &[adopt]);
    }
    let now = Instant::now();
    hosted.apply(report, now);
    hosted.tick(now + Duration::from_millis(desk_wm::host::QUIET_MS as u64 + 50));
    hosted
}

fn textures(surface: &str) -> Option<Texture> {
    match surface {
        NOTES => Some((TextureId(2), (400, 263))),
        MAIL => Some((TextureId(3), (400, 263))),
        _ => None,
    }
}

/// `hosted` drawn while Notes's `popup` is open, and what it drew.
fn drawn(hosted: &Hosted, popup: Popup) -> (Scene, Drawn) {
    let open = move |surface: &str| (surface == NOTES).then_some(popup);
    let from = Sources {
        scale: 1.0,
        page: Some((TextureId(1), (1440, 900))),
        surface: &textures,
        popup: &open,
        spread: None,
        map: None,
    };
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(&mut scene, &ChromeTheme::default(), hosted, &from).unwrap();
    (scene, drawn)
}

/// The router's targets for what `hosted` drew: the windows covering what lies under them and,
/// with `popups`, the popups above them (`popup_input::areas`, as `register` sets them).
fn targets(hosted: &Hosted, scene: &Scene, drawn: &Drawn, popups: bool) -> Targets {
    let mut targets = Targets::default();
    for (node, target) in &drawn.shown {
        targets.surface(scene, *node, target.clone());
    }
    let made = hosted.surfaces().made();
    let above = if popups { drawn.popups.as_slice() } else { &[] };
    let windows = &hosted.plan().unwrap().windows;
    targets.set_areas(PAGE, areas(windows, &made, above, 1.0));
    targets
}

/// The texture of the topmost surface drawn at each of `points`, whether it hears the pointer.
fn seen(hosted: &Hosted, popup: Popup, points: &[Vec2]) -> Vec<Option<TextureId>> {
    fn see(scene: &mut Scene, id: NodeId) {
        let node = scene.node(id).cloned().unwrap();
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
    let (mut scene, _) = drawn(hosted, popup);
    let root = scene.root();
    see(&mut scene, root);
    let texture = |p: &Vec2| match scene.node(hit_test(&scene, *p)?.node)?.kind.clone() {
        NodeKind::Surface(s) => Some(s.texture),
        _ => None,
    };
    points.iter().map(texture).collect()
}

/// What the pointer at each of `points` reaches in `hosted` while Notes's `popup` is open: the
/// texture drawn there (none for a fill) and the surface hearing it, at its own point.
fn reached(
    hosted: &Hosted,
    popup: Popup,
    points: &[Vec2],
) -> Vec<(Option<TextureId>, String, Vec2)> {
    let (scene, drawn) = drawn(hosted, popup);
    let targets = targets(hosted, &scene, &drawn, true);
    let at = |point: Vec2| {
        let hit = hit_test(&scene, point).expect("something under the pointer");
        let texture = match scene.node(hit.node).map(|n| n.kind.clone()) {
            Some(NodeKind::Surface(node)) => Some(node.texture),
            _ => None,
        };
        let (surface, at) = targets.surface_at(&scene, point).expect("a surface");
        (texture, surface, at)
    };
    points.iter().map(|p| at(*p)).collect()
}

#[test]
fn a_windows_popup_is_drawn_whole_above_every_window_and_under_the_system_layer() {
    let plain = hosted(&[]);
    let plan = plain.plan().unwrap();
    let rect_of = |plugin: &str| {
        let w = plan.windows.iter().find(|w| w.id == plugin).unwrap();
        (w.rect, w.panes[0].body)
    };
    let ((notes, body), (mail, _)) = (rect_of("endue.notes"), rect_of("endue.mail"));
    let front = plan.windows.last().map(|w| w.id.as_str());
    assert_eq!(front, Some("endue.mail"), "Mail over Notes");
    assert!(
        mail.x > notes.x + 100.0 && mail.y < notes.y + notes.h,
        "side by side"
    );
    // Notes's picker, from near its pane's right edge, past it under Mail's window and on below
    // both windows, twice the pane's height.
    let (bx, by) = (body.x as f32, body.y as f32);
    let place = Rect::new(body.w as f32 - 60.0, 40.0, 300.0, 2.0 * body.h as f32);
    let picker: Popup = (place, (TextureId(5), (300, 2 * body.h as u32)));
    let inside = Vec2::new(bx + place.x + 20.0, by + place.y + 20.0);
    let over_mail = Vec2::new(mail.x as f32 + 30.0, by + place.y + 20.0);
    let below = Vec2::new(bx + place.x + 20.0, (notes.y + notes.h) as f32 + 100.0);
    let points = [inside, over_mail, below];
    let within = |r: desk_wm::Rect, p: Vec2| {
        let (x, y) = (f64::from(p.x), f64::from(p.y));
        x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
    };
    assert!(
        within(body, inside) && within(mail, over_mail),
        "in the pane, over Mail"
    );
    assert!(
        plan.windows.iter().all(|w| !within(w.rect, below)),
        "the page's own pixels"
    );
    let heard = |p: Vec2| Vec2::new(p.x - bx, p.y - by);
    for (point, (texture, surface, at)) in points.iter().zip(reached(&plain, picker, &points)) {
        assert_eq!(texture, Some(TextureId(5)), "{point}: the picker, over all");
        assert_eq!((surface.as_str(), at), (NOTES, heard(*point)), "{point}");
    }
    // Over Mail the router hands a press to the page, as on any part of a window another one
    // covers (ADR 0192), but for the popup's own area above every window.
    let (scene, made) = drawn(&plain, picker);
    let bare = targets(&plain, &scene, &made, false);
    let under = bare.surface_at(&scene, over_mail).map(|(s, _)| s);
    assert_eq!(under.as_deref(), Some(PAGE), "covered by Mail without it");
    // Flipped up over both title bars: drawn over the tools the page draws of a window, too.
    let up: Popup = (
        Rect::new(place.x, -60.0, 300.0, 200.0),
        (TextureId(5), (300, 200)),
    );
    let bars = [
        Vec2::new(bx + place.x + 20.0, notes.y as f32 + 20.0),
        Vec2::new(mail.x as f32 + 30.0, mail.y as f32 + 20.0),
    ];
    assert_eq!(seen(&plain, up, &bars), [Some(TextureId(5)); 2], "seen");
    let heard_up: Vec<String> = reached(&plain, up, &bars)
        .into_iter()
        .map(|r| r.1)
        .collect();
    assert_eq!(heard_up, [NOTES, NOTES], "heard");
    // A bar of the desk's over its lower part, and a modal's scrim over the whole app: theirs.
    let bar = json!({ "id": "desk.notices", "x": below.x - 10.0, "y": below.y - 10.0,
        "width": 40, "height": 40 });
    let barred = hosted(&[bar]);
    let seen = reached(&barred, picker, &[below, inside]);
    let (texture, surface, _) = &seen[0];
    assert_eq!(
        (*texture, surface.as_str()),
        (Some(TextureId(1)), PAGE),
        "the bar"
    );
    assert_eq!(seen[1].1, NOTES, "the picker beside it");
    let scrim = json!({ "id": "desk.scrim", "x": 0, "y": 0, "width": 1440, "height": 900 });
    for (_, surface, _) in reached(&hosted(&[scrim]), picker, &points) {
        assert_eq!(surface, PAGE, "under the scrim");
    }
}
