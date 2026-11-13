//! The island's place and its panel without a window (ADR 0204).

use super::kept::{Kept, top_middle};
use super::place::{Display, Rect};

fn display(key: &str, x: i32) -> Display {
    Display {
        key: key.to_owned(),
        area: Rect {
            x,
            y: 50,
            width: 2000,
            height: 1200,
        },
    }
}

#[test]
fn with_no_spot_kept_it_sits_at_the_top_in_the_middle() {
    let kept = Kept::default();
    let built_in = display("Built-in 2000x1250", 0);
    let at = kept.place(&built_in, (640, 128), 12);
    assert_eq!(
        at,
        Rect {
            x: 680,
            y: 62,
            width: 640,
            height: 128
        }
    );
    // Wider than the display: its left edge on the display's.
    let wide = top_middle(built_in.area, (2400, 128), 12);
    assert_eq!((wide.x, wide.y), (0, 62));
}

#[test]
fn it_comes_back_where_the_person_left_it_on_each_display_and_on_the_last_one() {
    let (left, right) = (
        display("Left 2000x1250", 0),
        display("Right 2000x1250", 2000),
    );
    let mut kept = Kept::default();
    let dropped = Rect {
        x: 2100,
        y: 900,
        width: 640,
        height: 128,
    };
    assert!(kept.remember(&right, dropped), "a new spot is kept");
    assert!(
        !kept.remember(&right, dropped),
        "the same spot changes nothing"
    );
    assert_eq!(kept.last.as_deref(), Some("Right 2000x1250"));
    assert_eq!(kept.place(&right, (640, 128), 12), dropped);
    // A restart reads it back whole.
    let again = Kept::parse(&kept.to_json());
    assert_eq!(again, kept);
    // Shown again: on the display it was left on, wherever the pointer is.
    let both = [left.clone(), right.clone()];
    assert_eq!(again.display(&both, Some(&left)), Some(&right));
    // That display gone: the one under the pointer, at the top there.
    let only_left = [left.clone()];
    assert_eq!(again.display(&only_left, Some(&left)), Some(&left));
    assert_eq!(again.place(&left, (640, 128), 12).y, 62);
    // No pointer either: the first display there is.
    assert_eq!(again.display(&only_left, None), Some(&left));
    assert_eq!(again.display(&[], None), None);
    // Left on the other display, that one is last; each keeps its own spot.
    assert!(kept.remember(&left, Rect { x: 300, ..dropped }));
    assert_eq!(kept.last.as_deref(), Some("Left 2000x1250"));
    assert_eq!(kept.place(&right, (640, 128), 12), dropped);
}

#[test]
fn a_file_it_cannot_read_keeps_nothing_and_the_floating_eris_file_reads_too() {
    assert_eq!(Kept::parse("not json"), Kept::default());
    assert_eq!(Kept::parse("{}"), Kept::default());
    let eris = r#"{ "displays": { "Built-in 3024x1964": { "x": 1400, "y": 30 } } }"#;
    let kept = Kept::parse(eris);
    assert_eq!(kept.last, None);
    assert_eq!(kept.spots.displays.len(), 1);
}

#[test]
fn a_move_while_the_displays_change_is_not_the_persons() {
    use super::screens::{changing, reconfigure_for_test, settled};
    reconfigure_for_test(true);
    assert!(changing());
    reconfigure_for_test(false);
    assert!(
        changing(),
        "still changing until the island is placed again"
    );
    settled();
    assert!(!changing());
}

#[cfg(target_os = "macos")]
#[test]
fn winits_window_is_made_a_panel_only_while_neither_adds_memory_to_the_other() {
    use objc2::runtime::AnyClass;
    use objc2::sel;

    use super::panel::mac::{PANEL, panel_class, same_size};

    let window = AnyClass::get(c"NSWindow").expect("AppKit is linked");
    let panel = AnyClass::get(c"NSPanel").expect("AppKit is linked");
    assert!(
        same_size(window, panel),
        "NSPanel adds no instance variables to NSWindow on this SDK"
    );
    let ours = panel_class().expect("the panel class registers");
    assert_eq!(ours.name(), PANEL);
    assert_eq!(ours.superclass().map(AnyClass::name), Some(c"NSPanel"));
    assert!(same_size(window, ours));
    for method in [
        sel!(canBecomeKeyWindow),
        sel!(canBecomeMainWindow),
        sel!(setStyleMask:),
    ] {
        assert!(ours.instance_method(method).is_some(), "{method:?}");
    }
    assert_eq!(panel_class().map(|c| c as *const _), Some(ours as *const _));
}
