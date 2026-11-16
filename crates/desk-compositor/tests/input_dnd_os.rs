//! What crosses the window's edge (#309, ADR 0243): a surface's drag of paths that leaves the window
//! is handed to the OS and ends as the OS says; a drag without paths stays in the window; text and
//! links an OS app drags over the window are desk data, read at the same trust boundary.

use desk_compositor::input::*;
use desk_surface::generated::{SurfaceDropAnswer, SurfaceDropEffect};
use serde_json::json;

mod input_desk;
use input_desk::*;

fn hand_offs(out: &[Out]) -> Vec<(Vec<String>, Vec<SurfaceDropEffect>)> {
    out.iter()
        .filter_map(|o| match o {
            Out::HandOff { paths, allowed } => Some((paths.clone(), allowed.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn a_drag_of_paths_past_the_windows_edge_hands_off_to_the_os() {
    let mut d = dragging();
    assert_eq!(kinds(&d.to(650.0, 60.0)), ["drag.enter@b.two"]);
    let out = d.to(1400.0, 60.0);
    assert!(
        kinds(&out).contains(&"drag.leave@b.two".to_owned()),
        "{out:?}"
    );
    assert!(!kinds(&out).iter().any(|k| k.starts_with("drag.drop")));
    use SurfaceDropEffect::{Copy, Link, Move};
    assert_eq!(
        hand_offs(&out),
        [(vec!["~/Documents/a.md".to_owned()], vec![Copy, Move, Link])]
    );
    assert!(!d.router.broker().active(), "the OS owns the drag now");
    assert!(d.router.broker().handed_off());
    // Moving on, or letting go, says nothing more until the OS ends it.
    assert!(hand_offs(&d.to(1500.0, 80.0)).is_empty());
    assert!(
        !kinds(&d.press(false))
            .iter()
            .any(|k| k.starts_with("drag."))
    );
}

#[test]
fn the_os_ends_a_handed_off_drag() {
    let mut d = dragging();
    d.to(1400.0, 60.0);
    let ended = d.feed(Input::HandOffEnded {
        effect: Some(SurfaceDropAnswer::Copy),
    });
    assert_eq!(
        sent(&ended),
        [json!({ "type": "drag.ended", "surface": A, "effect": "copy", "to": "os" })]
    );
    assert!(!d.router.broker().handed_off());
    // Cancelled outside, or no OS drag could start: `none`, and the next drag starts as ever.
    for effect in [None, Some(SurfaceDropAnswer::None)] {
        let mut d = dragging();
        d.to(1400.0, 60.0);
        let ended = d.feed(Input::HandOffEnded { effect });
        assert_eq!(
            sent(&ended),
            [json!({ "type": "drag.ended", "surface": A, "effect": "none" })]
        );
        d.to(110.0, 60.0);
        d.press(true);
        let start = json!({ "type": "drag.start", "surface": A, "effectAllowed": ["copy"],
            "items": [{ "type": "desk/text", "text": "again" }] });
        d.said(message(start));
        assert!(d.router.broker().active());
    }
    // An effect the source did not allow is none.
    let mut d = desk();
    d.to(110.0, 60.0);
    d.press(true);
    let start = json!({ "type": "drag.start", "surface": A, "effectAllowed": ["copy"],
        "items": [{ "type": "desk/paths", "paths": [{ "path": "/tmp/a.md" }] }] });
    d.said(message(start));
    d.to(1400.0, 60.0);
    let ended = d.feed(Input::HandOffEnded {
        effect: Some(SurfaceDropAnswer::Move),
    });
    assert_eq!(sent(&ended)[0]["effect"], "none");
}

#[test]
fn a_drag_without_paths_stays_in_the_window() {
    let mut d = desk();
    d.to(110.0, 60.0);
    d.press(true);
    let start = json!({ "type": "drag.start", "surface": A, "effectAllowed": ["copy"],
        "items": [{ "type": "desk/text", "text": "a note" }] });
    d.said(message(start));
    let out = d.to(1400.0, 60.0);
    assert!(hand_offs(&out).is_empty());
    assert!(d.router.broker().active(), "over nothing, as before");
    let up = d.press(false);
    assert_eq!(
        sent(&up)
            .iter()
            .find(|m| m["type"] == "drag.ended")
            .unwrap()["effect"],
        "none"
    );
}

#[test]
fn text_from_the_os_reaches_targets_that_take_text() {
    let mut d = desk();
    d.said(message(
        json!({ "type": "drag.accept", "surface": B, "types": ["desk/text", "text/plain"] }),
    ));
    d.said(message(
        json!({ "type": "drag.accept", "surface": A, "types": ["desk/paths"] }),
    ));
    d.to(650.0, 60.0);
    let enter = d.feed(Input::OsDataHovered {
        text: Some("hello there".into()),
        uris: vec![],
    });
    let m = &sent(&enter)[0];
    assert_eq!(
        (m["type"].as_str(), m["surface"].as_str()),
        (Some("drag.enter"), Some(B))
    );
    assert_eq!(m["types"], json!(["desk/text", "text/plain"]));
    assert_eq!(m["from"], "os");
    d.said(message(
        json!({ "type": "drag.status", "surface": B, "effect": "copy" }),
    ));
    let drop = d.feed(Input::OsDataDropped {
        text: Some("hello there".into()),
        uris: vec![],
    });
    let dropped = sent(&drop)
        .into_iter()
        .find(|m| m["type"] == "drag.drop")
        .unwrap();
    assert_eq!(
        dropped["items"][0],
        json!({ "type": "desk/text", "text": "hello there" })
    );
    // Over a target that takes only paths, a text drag is over nothing.
    let mut d = desk();
    d.said(message(
        json!({ "type": "drag.accept", "surface": A, "types": ["desk/paths"] }),
    ));
    d.to(300.0, 60.0);
    let out = d.feed(Input::OsDataHovered {
        text: Some("x".into()),
        uris: vec![],
    });
    assert!(!kinds(&out).iter().any(|k| k.starts_with("drag.enter")));
    // Let go over nothing, it opens nothing.
    let out = d.feed(Input::OsDataDropped {
        text: Some("x".into()),
        uris: vec![],
    });
    assert!(!out.iter().any(|o| matches!(o, Out::OpenFiles(_))));
}

#[test]
fn a_link_from_the_os_is_a_uri() {
    let mut d = desk();
    d.said(message(
        json!({ "type": "drag.accept", "surface": B, "types": ["desk/uri", "desk/text"] }),
    ));
    d.to(650.0, 60.0);
    let enter = d.feed(Input::OsDataHovered {
        text: Some("https://endue.ai/".into()),
        uris: vec!["https://endue.ai/".into()],
    });
    assert_eq!(sent(&enter)[0]["types"], json!(["desk/text", "desk/uri"]));
    // A script URI is refused whole: no drag at all.
    let mut d = desk();
    d.said(message(
        json!({ "type": "drag.accept", "surface": B, "types": ["desk/uri"] }),
    ));
    d.to(650.0, 60.0);
    let out = d.feed(Input::OsDataHovered {
        text: None,
        uris: vec!["javascript:alert(1)".into()],
    });
    assert!(sent(&out).is_empty(), "{out:?}");
    assert!(!d.router.broker().active());
}

#[test]
fn an_os_drag_of_data_that_leaves_ends_cleanly() {
    let mut d = desk();
    d.said(message(
        json!({ "type": "drag.accept", "surface": B, "types": ["desk/text"] }),
    ));
    d.to(650.0, 60.0);
    d.feed(Input::OsDataHovered {
        text: Some("x".into()),
        uris: vec![],
    });
    let out = d.feed(Input::FileHoverCancelled);
    assert_eq!(kinds(&out), ["drag.leave@b.two"]);
    assert!(!d.router.broker().active());
}
