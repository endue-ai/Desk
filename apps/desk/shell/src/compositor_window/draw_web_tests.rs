//! A plugin pane's web view in the scene (#273, ADR 0216): drawn over the plugin's surface at its
//! box, cut to the pane and to what its texture holds, the pointer on it the view's.

use desk_compositor::glam::Vec2;
use desk_compositor::input::Target;
use desk_compositor::{ChromeTheme, Rect, Scene, TextureId, hit_test};

use super::tests::{hosted_at, sources};
use super::{Drawn, Sources, Texture, draw};
use crate::compositor_window::draw_web::cut;

const WEB: &str = "web:main.endue-notes";

/// The plugin's surface, its window's own page when `paged`, and its web view's picture.
fn textures(paged: bool) -> impl Fn(&str) -> Option<Texture> {
    move |surface: &str| match surface {
        "main.endue-notes" => Some((TextureId(2), (400, 263))),
        WEB => Some((TextureId(7), (800, 600))),
        "window:endue.notes" if paged => Some((TextureId(5), (400, 300))),
        _ => None,
    }
}

fn drawn_with(surface: &dyn Fn(&str) -> Option<Texture>, at: Option<[f32; 4]>) -> (Scene, Drawn) {
    let hosted = hosted_at("live", 1.0);
    let web = move |host: &str| at.filter(|_| host == "main.endue-notes");
    let from = Sources {
        web: &web,
        ..sources(surface)
    };
    let mut scene = Scene::new(1440, 900);
    let drawn = draw(&mut scene, &ChromeTheme::default(), &hosted, &from).unwrap();
    (scene, drawn)
}

fn target((scene, drawn): &(Scene, Drawn), at: Vec2) -> Option<(String, Vec2)> {
    let hit = hit_test(scene, at)?;
    let t: &Target = &drawn.shown.iter().find(|(node, _)| *node == hit.node)?.1;
    Some((t.surface.clone(), t.origin + hit.local_point * t.per_unit))
}

// The pane's body lies at 105,231 and is 379 by 219 (`draw_tests.rs`).
const BODY: Vec2 = Vec2::new(105.0, 231.0);

#[test]
fn a_web_view_is_drawn_over_its_plugins_pane_at_its_box_and_takes_the_pointer_there() {
    // Under a toolbar 40 high, and taller than what is left of the pane.
    let shown = drawn_with(&textures(false), Some([0.0, 40.0, 379.0, 500.0]));
    let (surface, at) = target(&shown, BODY + Vec2::new(10.0, 10.0)).unwrap();
    assert_eq!(
        (surface.as_str(), at),
        ("main.endue-notes", Vec2::new(10.0, 10.0)),
        "the toolbar"
    );
    let (surface, at) = target(&shown, BODY + Vec2::new(10.0, 50.0)).unwrap();
    assert_eq!(
        (surface.as_str(), at),
        (WEB, Vec2::new(10.0, 10.0)),
        "the page, at its own point"
    );
    let (surface, at) = target(&shown, BODY + Vec2::new(370.0, 218.0)).unwrap();
    assert_eq!(
        (surface.as_str(), at),
        (WEB, Vec2::new(370.0, 178.0)),
        "to the pane's last row"
    );
    let below = target(&shown, BODY + Vec2::new(10.0, 225.0)).unwrap().0;
    assert_ne!(below, WEB, "nothing of it past the pane");
    // Where it lies on the desk, whole: its popups are placed from there.
    let placed = shown.1.placed.iter().find(|(s, _)| s == WEB).unwrap().1;
    assert_eq!(
        (placed.x, placed.y, placed.width, placed.height),
        (105.0, 271.0, 379.0, 500.0)
    );
}

#[test]
fn a_view_laid_out_past_the_panes_top_is_cut_there_and_heard_from_its_own_corner() {
    let shown = drawn_with(&textures(false), Some([-30.0, -20.0, 200.0, 100.0]));
    let (surface, at) = target(&shown, BODY + Vec2::new(5.0, 5.0)).unwrap();
    assert_eq!((surface.as_str(), at), (WEB, Vec2::new(35.0, 25.0)));
    let beside = target(&shown, BODY + Vec2::new(175.0, 5.0)).unwrap().0;
    assert_eq!(
        beside, "main.endue-notes",
        "past its right edge: the plugin"
    );
}

#[test]
fn a_view_with_no_box_or_no_picture_yet_leaves_the_pane_to_its_plugin() {
    let none = drawn_with(&textures(false), None);
    assert_eq!(
        target(&none, BODY + Vec2::new(10.0, 50.0)).unwrap().0,
        "main.endue-notes"
    );
    let unpainted = |surface: &str| textures(false)(surface).filter(|_| surface != WEB);
    let waiting = drawn_with(&unpainted, Some([0.0, 40.0, 379.0, 179.0]));
    assert_eq!(
        target(&waiting, BODY + Vec2::new(10.0, 50.0)).unwrap().0,
        "main.endue-notes"
    );
    assert!(waiting.1.placed.iter().all(|(s, _)| s != WEB));
}

#[test]
fn a_windows_own_page_hears_a_press_on_its_web_view_too() {
    // The runtime finds the pane and its window from that page's DOM (ADR 0201).
    let paged = drawn_with(&textures(true), Some([0.0, 40.0, 379.0, 179.0]));
    let own = "window:endue.notes".to_owned();
    assert!(paged.1.pages.contains(&(WEB.to_owned(), own.clone())));
    assert!(
        paged
            .1
            .pages
            .contains(&("main.endue-notes".to_owned(), own))
    );
    let unpaged = drawn_with(&textures(false), Some([0.0, 40.0, 379.0, 179.0]));
    assert!(unpaged.1.pages.is_empty(), "the desk's page hears it there");
}

#[test]
fn a_view_shows_what_its_texture_holds_from_its_top_left_never_stretched() {
    let pane = Rect::new(0.0, 0.0, 400.0, 300.0);
    let full = Rect::new(0.0, 40.0, 400.0, 260.0);
    // A picture of the size before a resize, at two pixels a CSS pixel: 300 by 200 of it.
    let (node, off) = cut(full, pane, (TextureId(7), (600, 400)), 2.0).unwrap();
    assert_eq!(off, Vec2::ZERO);
    assert_eq!((node.rect.width, node.rect.height), (300.0, 200.0));
    assert_eq!((node.uv.width, node.uv.height), (1.0, 1.0));
    // Half of it scrolled past the pane's left: the right half of the picture.
    let (node, off) = cut(
        Rect::new(-150.0, 40.0, 400.0, 260.0),
        pane,
        (TextureId(7), (600, 400)),
        2.0,
    )
    .unwrap();
    assert_eq!(off, Vec2::new(150.0, 0.0));
    assert_eq!((node.rect.x, node.rect.width), (0.0, 150.0));
    assert_eq!((node.uv.x, node.uv.width), (0.5, 0.5));
    assert!(
        cut(
            Rect::new(500.0, 0.0, 100.0, 100.0),
            pane,
            (TextureId(7), (600, 400)),
            2.0
        )
        .is_none()
    );
}
