//! The IME through the compositor (#56, `specs/surface/v0/ime.md`): a Korean composition reaches
//! the focused surface syllable by syllable; the OS input method is on only for a surface that takes
//! text; its caret places the candidate window; a press commits what is left.

use desk_compositor::input::*;

mod input_desk;
use input_desk::*;

#[test]
fn a_korean_composition_reaches_the_focused_surface_and_commits_syllable_by_syllable() {
    let mut d = desk();
    d.click(150.0, 80.0);
    d.said(message(
        serde_json::json!({ "type": "ime.enabled", "surface": A, "enabled": true }),
    ));
    let preedit = |text: &str| {
        Input::Ime(ImeInput::Preedit {
            text: text.into(),
            cursor: Some((text.len(), text.len())),
        })
    };
    let mut out = Vec::new();
    for step in [
        preedit("ㅎ"),
        preedit("하"),
        preedit("한"),
        preedit(""),
        Input::Ime(ImeInput::Commit { text: "한".into() }),
        preedit("ㄱ"),
        preedit("그"),
        preedit("글"),
        preedit(""),
        Input::Ime(ImeInput::Commit { text: "글".into() }),
    ] {
        out.extend(d.feed(step));
    }
    let said: Vec<String> = sent(&out)
        .iter()
        .map(|m| {
            format!(
                "{} {}",
                m["type"].as_str().unwrap(),
                m["text"].as_str().unwrap_or("")
            )
        })
        .collect();
    assert_eq!(
        said,
        [
            "ime.composition ㅎ",
            "ime.composition 하",
            "ime.composition 한",
            "ime.commit 한",
            "ime.composition ㄱ",
            "ime.composition 그",
            "ime.composition 글",
            "ime.commit 글"
        ]
    );
    let first = &sent(&out)[0];
    assert_eq!(first["surface"], A);
    assert_eq!(
        first["selection"],
        serde_json::json!({ "start": 1, "end": 1 }),
        "UTF-16 units"
    );
    // An IME that clears its text with no commit after it cancelled the composition.
    d.feed(preedit("ㅎ"));
    d.feed(preedit(""));
    assert_eq!(kinds(&d.router.tick(&d.scene, d.now)), ["ime.cancel@a.one"]);
}

#[test]
fn the_ime_is_on_only_for_a_surface_that_takes_text_and_its_caret_places_the_candidate_window() {
    let mut d = desk();
    let out = d.click(150.0, 80.0);
    assert!(!out.iter().any(|o| matches!(o, Out::ImeAllowed(true))));
    let out = d.said(message(
        serde_json::json!({ "type": "ime.enabled", "surface": A, "enabled": true }),
    ));
    assert!(out.contains(&Out::ImeAllowed(true)));
    let caret = serde_json::json!({ "type": "ime.caret", "surface": A, "caret": { "x": 20, "y": 40, "width": 1, "height": 18 }, "characters": [{ "x": 10, "y": 40, "width": 16, "height": 18 }] });
    let out = d.said(message(caret));
    let area = out.iter().find_map(|o| match o {
        Out::ImeArea(r) => Some(*r),
        _ => None,
    });
    let area = area.map(|r| [r.x, r.y, r.width, r.height].map(|v| v.round()));
    assert_eq!(
        area,
        Some([220.0, 180.0, 32.0, 36.0]),
        "a.one's character box on screen"
    );
    // The focus on b.two, which takes no text: the IME goes off.
    let out = d.click(700.0, 100.0);
    assert!(
        out.contains(&Out::ImeAllowed(false)) && out.contains(&Out::ImeReset),
        "{out:?}"
    );
}

#[test]
fn a_composition_left_behind_by_a_press_is_committed_as_it_stands() {
    let mut d = desk();
    d.click(150.0, 80.0);
    d.feed(Input::Ime(ImeInput::Preedit {
        text: "하".into(),
        cursor: None,
    }));
    d.to(700.0, 100.0);
    let out = d.press(true);
    let first = &sent(&out)[0];
    assert_eq!(
        (
            first["type"].as_str(),
            first["surface"].as_str(),
            first["text"].as_str()
        ),
        (Some("ime.commit"), Some(A), Some("하")),
        "before the press"
    );
}
