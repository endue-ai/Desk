//! Drag and drop through the compositor (#56, ADR 0119's broker in Rust): between two surfaces,
//! with the answer waited for, Escape, refusals, and files from the OS.

use std::time::Duration;

use desk_compositor::glam::Vec2;
use desk_compositor::input::*;

mod input_desk;
use input_desk::*;

#[test]
fn a_drag_from_one_surface_reaches_another_in_its_coordinates_with_the_types_it_accepts() {
    let mut d = dragging();
    let enter = d.to(650.0, 60.0);
    assert_eq!(
        kinds(&enter),
        ["drag.enter@b.two"],
        "the compositor owns the pointer"
    );
    let m = &sent(&enter)[0];
    assert_eq!((point(m), m["from"].as_str()), ((50.0, 10.0), Some("a")));
    assert_eq!(m["types"], serde_json::json!(["desk/paths", "text/plain"]));
    let overlay = d.router.overlay().unwrap();
    assert_eq!(
        (overlay.look.label.as_str(), overlay.at),
        ("a.md", Vec2::new(1300.0, 120.0))
    );
    assert_eq!(kinds(&d.to(660.0, 60.0)), ["drag.over@b.two"]);
}

#[test]
fn the_items_go_to_the_target_once_it_answered_and_the_source_hears_how_it_ended() {
    let mut d = dragging();
    d.to(650.0, 60.0);
    let out = d.said(message(
        serde_json::json!({ "type": "drag.status", "surface": B, "effect": "move" }),
    ));
    assert!(
        out.contains(&Out::Cursor(CursorChoice::Named(
            desk_surface::generated::SurfaceCursorName::Default
        ))) || out.is_empty()
    );
    let up = d.press(false);
    let drop = sent(&up)
        .into_iter()
        .find(|m| m["type"] == "drag.drop")
        .unwrap();
    assert_eq!(
        (drop["surface"].as_str(), drop["effect"].as_str()),
        (Some(B), Some("move"))
    );
    assert_eq!(
        drop["items"],
        serde_json::json!([{ "type": "desk/paths", "paths": [{ "path": "~/Documents/a.md", "kind": "file" }] }, { "type": "text/plain", "text": "~/Documents/a.md" }])
    );
    assert!(
        kinds(&up).contains(&"pointer.up@a.one".to_owned()),
        "the source's press ends"
    );
    let ended = d.said(message(
        serde_json::json!({ "type": "drag.done", "surface": B, "effect": "move" }),
    ));
    assert_eq!(
        sent(&ended),
        [serde_json::json!({ "type": "drag.ended", "surface": A, "effect": "move", "to": "b" })]
    );
}

#[test]
fn a_release_waits_for_the_last_answer_and_drops_nothing_on_a_refusal_or_silence() {
    let mut d = dragging();
    d.to(650.0, 60.0);
    let up = d.press(false);
    assert!(
        !kinds(&up).iter().any(|k| k.starts_with("drag.")),
        "waits for b.two"
    );
    let out = d.said(message(
        serde_json::json!({ "type": "drag.status", "surface": B, "effect": "none" }),
    ));
    assert_eq!(kinds(&out), ["drag.leave@b.two", "drag.ended@a.one"]);
    // Silence: 400 ms later nothing is dropped.
    let mut d = dragging();
    d.to(650.0, 60.0);
    d.press(false);
    assert!(
        d.router
            .tick(&d.scene, d.now + Duration::from_millis(100))
            .is_empty()
    );
    assert_eq!(
        kinds(&d.router.tick(&d.scene, d.now + Duration::from_millis(400))),
        ["drag.leave@b.two", "drag.ended@a.one"]
    );
}

#[test]
fn escape_cancels_a_drag_and_a_surface_that_takes_none_of_its_types_hears_nothing() {
    let mut d = dragging();
    d.said(message(
        serde_json::json!({ "type": "drag.accept", "surface": PAGE, "types": ["desk/text"] }),
    ));
    assert!(
        kinds(&d.to(20.0, 20.0)).is_empty(),
        "the page takes no paths"
    );
    d.to(650.0, 60.0);
    let out = d.key("Escape", "Escape", None, NO_MODS);
    assert_eq!(kinds(&out), ["drag.leave@b.two", "drag.ended@a.one"]);
    assert!(d.router.overlay().is_none());
}

#[test]
fn a_drag_whose_items_do_not_hold_or_no_press_started_is_refused() {
    let mut d = desk();
    d.to(110.0, 60.0);
    d.press(true);
    let bad = serde_json::json!({ "type": "drag.start", "surface": A, "effectAllowed": ["copy"], "items": [{ "type": "desk/paths", "paths": [{ "path": "/etc/../passwd" }] }] });
    assert_eq!(kinds(&d.said(message(bad))), ["drag.ended@a.one"]);
    d.press(false);
    let good = serde_json::json!({ "type": "drag.start", "surface": A, "effectAllowed": ["copy"], "items": [{ "type": "desk/text", "text": "hi" }] });
    assert_eq!(
        kinds(&d.said(message(good.clone()))),
        ["drag.ended@a.one"],
        "no press held"
    );
    // A press on b.two does not let a.one start a drag either.
    d.to(650.0, 60.0);
    d.press(true);
    assert_eq!(kinds(&d.said(message(good))), ["drag.ended@a.one"]);
    assert!(!d.router.broker().active());
}

#[test]
fn files_from_the_os_reach_the_surface_under_the_pointer_and_open_when_nobody_takes_them() {
    let mut d = desk();
    d.said(message(
        serde_json::json!({ "type": "drag.accept", "surface": B, "types": ["desk/paths"] }),
    ));
    d.to(650.0, 60.0);
    d.feed(Input::FileHovered {
        path: "/Users/me/한 글.md".into(),
    });
    d.feed(Input::FileHovered {
        path: "/Users/me/b.md".into(),
    });
    let enter = d.router.tick(&d.scene, d.now);
    let m = &sent(&enter)[0];
    assert_eq!(
        (m["type"].as_str(), m["from"].as_str()),
        (Some("drag.enter"), Some("os"))
    );
    assert_eq!(
        m["effectAllowed"],
        serde_json::json!(["copy", "link"]),
        "never move a person's files"
    );
    assert!(d.router.overlay().is_none(), "the OS draws its own image");
    d.said(message(
        serde_json::json!({ "type": "drag.status", "surface": B, "effect": "copy" }),
    ));
    d.feed(Input::FileDropped {
        path: "/Users/me/한 글.md".into(),
    });
    d.feed(Input::FileDropped {
        path: "/Users/me/b.md".into(),
    });
    let drop = d.router.tick(&d.scene, d.now);
    let m = &sent(&drop)[0];
    assert_eq!(
        m["items"][0]["paths"],
        serde_json::json!([{ "path": "/Users/me/한 글.md" }, { "path": "/Users/me/b.md" }])
    );
    assert!(
        d.said(message(
            serde_json::json!({ "type": "drag.done", "surface": B, "effect": "copy" })
        ))
        .is_empty()
    );
    // Dropped on the page, which takes nothing: the files open.
    d.to(20.0, 20.0);
    d.feed(Input::FileDropped {
        path: "/Users/me/c.md".into(),
    });
    assert_eq!(
        d.router.tick(&d.scene, d.now),
        [Out::OpenFiles(vec!["/Users/me/c.md".into()])]
    );
}
