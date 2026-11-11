//! Measuring chrome text before it is drawn (#156): a box sized to its text, as a hover title's
//! is, takes the text's widest line and its number of lines, broken at the box's width and at the
//! text's own newlines. The bundled fonts (`tests/fonts`) make it the same on every OS.

mod support;

use desk_compositor::{FontStack, Rect, TextNode, TextStyle};
use support::test_fonts;

fn style() -> TextStyle {
    TextStyle {
        font: FontStack::new(r#""Inter", sans-serif"#),
        size: 12.0,
        line_height: 20.0 / 12.0,
        ..TextStyle::default()
    }
}

fn wrapped(text: &str, width: f32) -> TextNode {
    TextNode::new(Rect::new(0.0, 0.0, width, 10_000.0), text, style()).wrapped()
}

#[test]
fn a_line_is_as_wide_as_its_text() {
    let mut fonts = test_fonts();
    let (short, one) = fonts.measure(&wrapped("Split right", 360.0));
    let (long, also_one) = fonts.measure(&wrapped("Split right (Ctrl+D)", 360.0));
    assert_eq!((one, also_one), (1, 1));
    assert!(short > 40.0 && short < 90.0, "{short}");
    assert!(long > short + 30.0, "{long} against {short}");
    assert!(long < 360.0);
}

#[test]
fn a_box_too_narrow_and_a_newline_break_the_text_into_lines() {
    let mut fonts = test_fonts();
    let text = "Could not read the agents: the folder is not there";
    let (width, lines) = fonts.measure(&wrapped(text, 120.0));
    assert!(lines >= 3, "{lines} lines");
    assert!(width <= 120.0, "{width}");
    let (width, lines) = fonts.measure(&wrapped("Inbox\nNothing new", 360.0));
    assert_eq!(lines, 2);
    let (alone, _) = fonts.measure(&wrapped("Nothing new", 360.0));
    assert!(
        (width - alone).abs() < 0.5,
        "the widest line: {width} against {alone}"
    );
}

#[test]
fn a_one_line_node_is_one_line_cut_to_its_box() {
    let mut fonts = test_fonts();
    let node = TextNode::new(
        Rect::new(0.0, 0.0, 60.0, 20.0),
        "Inbox\nNothing new at all",
        style(),
    );
    let (width, lines) = fonts.measure(&node);
    assert_eq!(lines, 1);
    assert!(width <= 60.5, "{width}");
}
