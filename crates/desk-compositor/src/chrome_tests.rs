use super::*;
use crate::node::NodeKind;
use crate::theme::Tokens;

fn text_of(scene: &Scene, node: NodeId) -> String {
    match &scene.node(node).unwrap().kind {
        NodeKind::Text(t) => t.text.to_string(),
        _ => String::new(),
    }
}

#[test]
fn a_card_has_its_fill_its_title_its_line_and_one_button_per_action_centred() {
    let mut scene = Scene::new(800, 600);
    let mut chrome = Chrome::new(ChromeTheme::default());
    let rect = Rect::new(100.0, 100.0, 400.0, 300.0);
    let root = scene.root();
    let made = chrome
        .card(
            &mut scene,
            root,
            rect,
            "Hello",
            "Stopped.",
            &["Reload"],
            false,
        )
        .unwrap();
    assert_eq!(made.len(), 5, "fill, title, line, button, label");
    assert_eq!(text_of(&scene, made[1]), "Hello");
    assert_eq!(text_of(&scene, made[4]), "Reload");
    let button = scene.node(made[3]).unwrap().rect().unwrap();
    let centre = button.x + button.width / 2.0;
    assert!((centre - 300.0).abs() < 0.5, "centred: {button:?}");
    assert_eq!(rect.intersect(&button), Some(button), "inside its box");
}

#[test]
fn a_scrim_over_a_frame_lets_it_show_through_and_follows_the_theme() {
    let mut scene = Scene::new(800, 600);
    let mut chrome = Chrome::new(ChromeTheme::default());
    let root = scene.root();
    let made = chrome
        .card(
            &mut scene,
            root,
            Rect::new(0.0, 0.0, 400.0, 300.0),
            "Not responding",
            "",
            &["Wait", "Stop"],
            true,
        )
        .unwrap();
    assert_eq!(made.len(), 1 + 1 + 2 * 2, "no line part for an empty line");
    let fill = |scene: &Scene| match &scene.node(made[0]).unwrap().kind {
        NodeKind::Rect(r) => r.fill,
        _ => unreachable!(),
    };
    assert!(fill(&scene).a < 1.0, "see-through");
    let amber: Tokens = [("muted", "#2a1d10")].into_iter().collect();
    chrome.set_theme(&mut scene, ChromeTheme::from_tokens(&amber));
    assert_eq!(
        fill(&scene),
        ChromeTheme::from_tokens(&amber).placeholder.scrim
    );
}

#[test]
fn a_cleared_title_starts_past_what_floats_over_it_and_keeps_its_end() {
    let mut scene = Scene::new(800, 600);
    let mut chrome = Chrome::new(ChromeTheme::default());
    let root = scene.root();
    let whole = Rect::new(0.0, 0.0, 800.0, 400.0);
    let w = chrome
        .window(&mut scene, root, whole, "Notes", None, false)
        .unwrap();
    let title = |scene: &Scene| scene.node(w.title).unwrap().rect().unwrap();
    assert_eq!(title(&scene).x, 12.0, "the padding");
    chrome.clear_title(&mut scene, &w, 300.0, 0.0).unwrap();
    let cleared = title(&scene);
    assert_eq!((cleared.x, cleared.x + cleared.width), (300.0, 788.0));
    // The clearance survives a new look.
    chrome.set_theme(&mut scene, ChromeTheme::default());
    assert_eq!(title(&scene).x, 300.0);
}
