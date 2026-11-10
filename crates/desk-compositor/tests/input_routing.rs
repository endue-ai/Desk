//! Input routing (#56): winit-equivalent events in, surface protocol messages out: hit test to a
//! surface's own pixels, capture, the underlay, overlays, clicks, focus, the keymap before delivery
//! and the cursor. The desk is `input_desk`'s.

use std::time::Duration;

use desk_compositor::glam::Vec2;
use desk_compositor::input::keymap::{KeyDecision, Platform};
use desk_compositor::input::*;
use desk_compositor::*;

mod input_desk;
use input_desk::*;

#[test]
fn a_point_over_a_surface_reaches_it_in_its_own_logical_pixels() {
    let mut d = desk();
    let out = d.to(150.0, 80.0);
    let a = sent(&out).into_iter().find(|m| m["surface"] == A).unwrap();
    assert_eq!(point(&a), (50.0, 30.0), "a.one's own pixels");
    let page = sent(&out)
        .into_iter()
        .find(|m| m["surface"] == PAGE)
        .unwrap();
    assert_eq!(point(&page), (150.0, 80.0), "the page's pixels");
    // A covered surface shows only a piece: its pixels still count from the surface's top left.
    let mut scene = Scene::new(2560, 1600);
    let mut router = InputRouter::new(Platform::Mac, PointerSettings::default());
    let root = scene.root();
    quad(
        &mut scene,
        &mut router,
        root,
        B,
        Rect::new(1600.0, 100.0, 400.0, 600.0),
        Vec2::new(200.0, 0.0),
    );
    let at = router
        .targets
        .surface_at(&scene, Vec2::new(1700.0, 300.0))
        .unwrap();
    assert!(at.0 == B && near(at.1, Vec2::new(250.0, 100.0)), "{at:?}");
    // A window the spread view shows at half size, through its group's transform.
    let group = scene
        .insert(
            root,
            GroupNode {
                transform: glam::Mat4::from_translation(glam::Vec3::new(100.0, 100.0, 0.0))
                    * glam::Mat4::from_scale(glam::Vec3::new(0.5, 0.5, 1.0)),
                ..GroupNode::default()
            },
        )
        .unwrap();
    quad(
        &mut scene,
        &mut router,
        group,
        A,
        Rect::new(0.0, 0.0, 800.0, 600.0),
        Vec2::ZERO,
    );
    let at = router
        .targets
        .surface_at(&scene, Vec2::new(300.0, 250.0))
        .unwrap();
    assert!(
        at.0 == A && near(at.1, Vec2::new(200.0, 150.0)),
        "the middle of a.one: {at:?}"
    );
}

#[test]
fn a_press_captures_the_pointer_until_its_last_button_is_released() {
    let mut d = desk();
    d.to(150.0, 80.0);
    let down = d.press(true);
    assert_eq!(
        kinds(&down),
        ["pointer.down@a.one", "pointer.down@desk", "focus.in@a.one"]
    );
    // Dragged out over b.two: a.one keeps hearing, in its own pixels, outside itself.
    let moved = d.to(700.0, 100.0);
    assert_eq!(kinds(&moved), ["pointer.move@a.one", "pointer.move@desk"]);
    assert_eq!(point(&sent(&moved)[0]), (600.0, 50.0));
    assert_eq!(sent(&moved)[0]["buttons"], serde_json::json!(["left"]));
    let up = d.press(false);
    assert_eq!(
        kinds(&up),
        ["pointer.up@a.one", "pointer.up@desk", "pointer.leave@a.one"]
    );
    assert_eq!(
        kinds(&d.to(701.0, 100.0)),
        ["pointer.move@b.two", "pointer.move@desk"]
    );
}

#[test]
fn a_press_sent_to_the_underlay_holds_it_and_the_surface_under_it_hears_nothing() {
    // A window's grip lies over its surface's edge: the window manager sends that press to the
    // page, whose DOM finds the grip (#80).
    let mut d = desk();
    d.to(150.0, 80.0);
    d.router.press_to(PAGE);
    let down = d.press(true);
    assert_eq!(
        kinds(&down),
        ["pointer.leave@a.one", "pointer.down@desk", "focus.in@desk"]
    );
    assert_eq!(point(&sent(&down)[1]), (150.0, 80.0), "the page's pixels");
    assert_eq!(kinds(&d.to(160.0, 90.0)), ["pointer.move@desk"]);
    assert_eq!(kinds(&d.press(false)), ["pointer.up@desk"]);
    // Once only: the next press goes to what lies under it again.
    d.to(150.0, 80.0);
    let next = d.press(true);
    assert_eq!(
        kinds(&next)[..2],
        ["pointer.down@a.one", "pointer.down@desk"]
    );
}

#[test]
fn the_underlay_hears_moves_and_presses_over_the_surfaces_but_never_their_wheels() {
    let mut d = desk();
    assert_eq!(kinds(&d.to(10.0, 10.0)), ["pointer.move@desk"]);
    assert_eq!(
        kinds(&d.to(150.0, 80.0)),
        ["pointer.move@a.one", "pointer.move@desk"]
    );
    let wheel = d.feed(Input::Wheel {
        dx: 0.0,
        dy: 20.0,
        unit: desk_surface::generated::SurfaceWheelUnit::Pixel,
    });
    assert_eq!(kinds(&wheel), ["pointer.wheel@a.one"]);
    assert_eq!(sent(&wheel)[0]["deltaY"], 10.0, "logical pixels");
    // Off a.one, back on the page: a.one hears it leave, the page goes on hearing.
    assert_eq!(
        kinds(&d.to(20.0, 20.0)),
        ["pointer.leave@a.one", "pointer.move@desk"]
    );
    assert_eq!(kinds(&d.feed(Input::PointerLeft)), ["pointer.leave@desk"]);
}

#[test]
fn an_overlay_takes_the_pointer_only_while_it_is_active() {
    let mut d = desk();
    let root = d.scene.root();
    let shield = RectNode::new(Rect::new(0.0, 0.0, 2560.0, 1600.0), Color::TRANSPARENT);
    let node = d
        .scene
        .insert(root, Node::from(shield).with_hit(false))
        .unwrap();
    d.router.targets.overlay(node, "menu");
    assert_eq!(
        kinds(&d.to(150.0, 80.0)),
        ["pointer.move@a.one", "pointer.move@desk"],
        "inactive: through"
    );
    let shield = d.scene.node(node).unwrap().clone();
    d.scene.set(node, shield.with_hit(true)).unwrap();
    assert_eq!(
        d.router.targets.at(&d.scene, Vec2::new(300.0, 160.0)),
        Some(Under::Overlay {
            name: "menu".into(),
            at: Vec2::new(300.0, 160.0)
        })
    );
    assert_eq!(
        kinds(&d.to(151.0, 80.0)),
        ["pointer.leave@a.one", "pointer.leave@desk"],
        "active: the overlay has it"
    );
}

#[test]
fn quick_presses_in_one_place_count_as_a_double_click() {
    let mut d = desk();
    let first = d.click(150.0, 80.0);
    let second = d.click(150.5, 80.0);
    let clicks = |out: &[Out]| {
        sent(out)
            .iter()
            .find(|m| m["type"] == "pointer.down")
            .unwrap()["clicks"]
            .clone()
    };
    assert_eq!((clicks(&first), clicks(&second)), (1.into(), 2.into()));
    d.now += Duration::from_secs(1);
    assert_eq!(
        clicks(&d.click(150.5, 80.0)),
        1,
        "too late for a double click"
    );
    // A drag is no click: pressed again where it started, a moment later, it is a first click
    // (a title bar dragged twice is not double-clicked, #80).
    d.now += Duration::from_secs(1);
    d.to(150.0, 80.0);
    d.press(true);
    d.to(190.0, 80.0);
    d.press(false);
    d.to(150.0, 80.0);
    assert_eq!(clicks(&d.press(true)), 1, "after a drag");
}

#[test]
fn a_press_moves_the_focus_and_keys_go_to_the_focused_surface() {
    let mut d = desk();
    let out = d.click(150.0, 80.0);
    assert!(kinds(&out).contains(&"focus.in@a.one".to_owned()));
    assert_eq!(d.router.focused(), Some(A));
    let typed = d.key("a", "KeyA", Some("a"), NO_MODS);
    assert_eq!(
        kinds(&typed),
        ["key.down@a.one", "key.char@a.one", "key.up@a.one"]
    );
    let out = d.click(700.0, 100.0);
    assert!(
        kinds(&out).contains(&"focus.out@a.one".to_owned())
            && kinds(&out).contains(&"focus.in@b.two".to_owned())
    );
    assert!(out.contains(&Out::Redraw), "the focus ring moves");
    // The window losing the OS focus takes it from the surface too, and gives it back.
    assert_eq!(
        kinds(&d.feed(Input::WindowFocused { focused: false })),
        ["focus.out@b.two"]
    );
    assert_eq!(
        kinds(&d.feed(Input::WindowFocused { focused: true })),
        ["focus.in@b.two"]
    );
}

#[test]
fn the_desks_keymap_takes_its_chords_first_and_every_key_while_a_prefix_waits() {
    let mut d = desk();
    d.router.keymap.apply(
        &[
            entry("Mod+K", "desk.palette.open", "desk"),
            entry("Ctrl+C p", "example.project", "person"),
            entry("Escape", "desk.keys.quit", "desk"),
        ],
        None,
    );
    d.click(150.0, 80.0);
    let palette = d.key("k", "KeyK", Some("k"), META);
    let Some(Out::DeskKey {
        surface,
        key,
        decision,
    }) = palette.first()
    else {
        panic!("{palette:?}")
    };
    assert_eq!((surface.as_str(), key.key.as_str()), (A, "k"));
    assert_eq!(
        decision,
        &KeyDecision::Run {
            command: "desk.palette.open".into(),
            args: None
        }
    );
    assert!(
        kinds(&palette).is_empty(),
        "a.one never hears ⌘K, its release neither"
    );
    // An unbound chord reaches the surface: the plugin's own ⌘B.
    assert_eq!(
        kinds(&d.key("b", "KeyB", Some("b"), META)),
        ["key.down@a.one", "key.up@a.one"]
    );
    // A prefix, then a plain key typed in the plugin: the desk's.
    assert!(matches!(
        d.key("c", "KeyC", None, CTRL).first(),
        Some(Out::DeskKey {
            decision: KeyDecision::Wait,
            ..
        })
    ));
    let p = d.key("p", "KeyP", Some("p"), NO_MODS);
    assert!(
        matches!(
            p.first(),
            Some(Out::DeskKey {
                decision: KeyDecision::Run { .. },
                ..
            })
        ),
        "{p:?}"
    );
    // Without a prefix, plain keys and Escape are the plugin's first, as in Stage 1.
    assert_eq!(
        kinds(&d.key("p", "KeyP", Some("p"), NO_MODS)),
        ["key.down@a.one", "key.char@a.one", "key.up@a.one"]
    );
    assert_eq!(
        kinds(&d.key("Escape", "Escape", None, NO_MODS)),
        ["key.down@a.one", "key.up@a.one"]
    );
}

#[test]
fn keys_before_anything_has_the_focus_go_to_the_underlay() {
    let mut d = desk();
    assert_eq!(d.router.focused(), None);
    assert_eq!(
        kinds(&d.key("a", "KeyA", Some("a"), NO_MODS)),
        ["key.down@desk", "key.char@desk", "key.up@desk"]
    );
}

#[test]
fn the_underlay_runs_the_keymap_itself_so_its_keys_reach_it() {
    let mut d = desk();
    d.router
        .keymap
        .apply(&[entry("Mod+K Mod+S", "desk.files.save-all", "desk")], None);
    d.click(10.0, 10.0);
    assert_eq!(d.router.focused(), Some(PAGE));
    assert_eq!(
        kinds(&d.key("k", "KeyK", Some("k"), META)),
        ["key.down@desk", "key.up@desk"]
    );
    assert_eq!(
        d.router.keymap.pending(),
        ["Meta+K"],
        "the compositor follows the prefix"
    );
}

#[test]
fn the_cursor_follows_the_surface_the_pointer_is_for() {
    let mut d = desk();
    d.said(message(serde_json::json!({ "type": "cursor", "surface": A, "cursor": { "kind": "named", "name": "text" } })));
    d.said(message(serde_json::json!({ "type": "cursor", "surface": B, "cursor": { "kind": "image", "png": "iVBORw0KGgo=", "hotspotX": 3, "hotspotY": 4, "scale": 2 } })));
    let named = |name| Out::Cursor(CursorChoice::Named(name));
    use desk_surface::generated::SurfaceCursorName as C;
    assert!(d.to(150.0, 80.0).contains(&named(C::Text)));
    // Held by a press on a.one, over b.two: a.one's cursor stays.
    d.press(true);
    assert!(
        !d.to(700.0, 100.0)
            .iter()
            .any(|o| matches!(o, Out::Cursor(_)))
    );
    let out = d.press(false);
    assert!(out.contains(&Out::Cursor(CursorChoice::Image {
        png: "iVBORw0KGgo=".into(),
        hotspot: (3, 4),
        scale: 2.0
    })));
    assert!(d.to(10.0, 10.0).contains(&named(C::Default)));
}
