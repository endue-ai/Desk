//! Where an app window opens again (`places.rs`) and its right-click menu (`menu.rs`).

use crate::app_windows::{Display, Item, Kept, MIN, removed};
use crate::main_frame::Frame;

/// A 3840×2160 display with a 25-point menu bar, and a laptop's screen to its left.
fn wide() -> Display {
    Display {
        key: "U32J59x 3840x2160".into(),
        area: Frame {
            x: 0.0,
            y: 25.0,
            width: 3840.0,
            height: 2135.0,
        },
    }
}

fn laptop() -> Display {
    Display {
        key: "Built-in Retina Display 1728x1117".into(),
        area: Frame {
            x: -1728.0,
            y: 0.0,
            width: 1728.0,
            height: 1117.0,
        },
    }
}

fn frame(x: f64, y: f64, width: f64, height: f64) -> Frame {
    Frame {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn an_app_opens_where_it_was_last_on_that_display() {
    let mut kept = Kept::default();
    assert!(kept.keep(
        "endue.terminal",
        &wide().key,
        frame(1200.0, 400.0, 900.0, 560.0)
    ));
    assert!(!kept.keep(
        "endue.terminal",
        &wide().key,
        frame(1200.0, 400.0, 900.0, 560.0)
    ));
    let opening = kept
        .opening("endue.terminal", &[wide(), laptop()], MIN)
        .expect("kept");
    assert_eq!(opening.at, Some((1200.0, 400.0)));
    assert_eq!(opening.size, (900.0, 560.0));
    // Another app has no place yet: the OS puts it.
    assert_eq!(kept.opening("endue.notes", &[wide()], MIN), None);
}

#[test]
fn each_display_keeps_a_place_of_its_own_and_the_last_one_wins() {
    let mut kept = Kept::default();
    kept.keep(
        "endue.terminal",
        &wide().key,
        frame(1200.0, 400.0, 900.0, 560.0),
    );
    kept.keep(
        "endue.terminal",
        &laptop().key,
        frame(-1600.0, 100.0, 800.0, 500.0),
    );
    let both = [wide(), laptop()];
    assert_eq!(
        kept.opening("endue.terminal", &both, MIN).unwrap().at,
        Some((-1600.0, 100.0))
    );
    // The laptop is closed: the app goes back to its place on the wide display.
    let only = kept.opening("endue.terminal", &[wide()], MIN).unwrap();
    assert_eq!(only.at, Some((1200.0, 400.0)));
    // Neither display is there: no place.
    let other = Display {
        key: "Other 1920x1080".into(),
        ..wide()
    };
    assert_eq!(kept.opening("endue.terminal", &[other], MIN), None);
}

#[test]
fn a_kept_place_is_never_smaller_than_an_app_window_may_be_nor_out_of_reach() {
    let mut kept = Kept::default();
    kept.keep(
        "endue.terminal",
        &wide().key,
        frame(100.0, 2150.0, 100.0, 80.0),
    );
    let opening = kept.opening("endue.terminal", &[wide()], MIN).unwrap();
    assert_eq!(opening.size, MIN);
    assert_eq!(
        opening.at, None,
        "its title bar under the display's bottom edge"
    );
}

#[test]
fn a_kept_file_round_trips_and_a_broken_one_keeps_nothing() {
    let mut kept = Kept::default();
    kept.keep(
        "endue.terminal",
        &wide().key,
        frame(1.0, 30.0, 700.0, 450.0),
    );
    let text = serde_json::to_string(&kept).unwrap();
    assert_eq!(Kept::parse(&text), kept);
    for broken in ["", "not json", "[]", r#"{"apps": 3}"#] {
        assert_eq!(Kept::parse(broken), Kept::default(), "{broken}");
    }
}

/// Places are kept by window id (ADR 0212): a plugin's second window keeps a place of its own, and
/// a file a desk wrote by plugin (`apps`) still opens its first window where it was.
#[test]
fn each_window_of_a_plugin_keeps_its_own_place_and_an_older_file_still_reads() {
    let mut kept = Kept::default();
    kept.keep("endue.images", &wide().key, frame(10.0, 40.0, 700.0, 450.0));
    kept.keep(
        "endue.images@2",
        &wide().key,
        frame(800.0, 40.0, 500.0, 400.0),
    );
    let first = kept.opening("endue.images", &[wide()], MIN).unwrap();
    let second = kept.opening("endue.images@2", &[wide()], MIN).unwrap();
    assert_eq!((first.at, first.size), (Some((10.0, 40.0)), (700.0, 450.0)));
    assert_eq!(
        (second.at, second.size),
        (Some((800.0, 40.0)), (500.0, 400.0))
    );
    assert!(kept.opening("endue.images@3", &[wide()], MIN).is_none());
    let older = serde_json::json!({ "apps": { "endue.terminal": {
        "last": wide().key, "frames": { wide().key: { "x": 1.0, "y": 30.0, "width": 700.0, "height": 450.0 } } } } });
    let read = Kept::parse(&older.to_string());
    assert!(read.opening("endue.terminal", &[wide()], MIN).is_some());
    assert!(
        serde_json::to_string(&read)
            .unwrap()
            .contains("\"windows\"")
    );
}

#[test]
fn the_right_click_menu_keeps_only_what_edits_text() {
    use Item::{Command as C, Separator as S};
    // Chromium's menu on a page: back, forward, reload, a separator, print, view source.
    let page = [C(100), C(101), C(102), S, C(131), C(132)];
    let gone = removed(&page);
    assert_eq!(gone, vec![5, 4, 3, 2, 1, 0], "nothing left: no menu");
    // In a text field: undo, redo, a separator, cut, copy, paste, select all, a separator, more.
    let field = [
        C(110),
        C(111),
        S,
        C(112),
        C(113),
        C(114),
        C(117),
        S,
        C(130),
        C(131),
    ];
    assert_eq!(removed(&field), vec![9, 8, 7]);
    // A misspelled word: suggestions, a separator, add to dictionary, a separator, back.
    let spelling = [C(200), C(201), S, C(206), S, C(100), S, C(113)];
    assert_eq!(removed(&spelling), vec![6, 5]);
}
