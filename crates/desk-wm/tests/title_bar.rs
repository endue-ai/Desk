//! A window's title bar (#298, ADR 0255): 36 high, with three tools at its end (the window menu,
//! Pop out, Close) and room before them for the pinned and floating marks. The page's style sheet
//! (`surface.css`), the compositor's theme and this crate lay the bar out with the same numbers, so
//! no frame, grip or hit area is off by the difference.

use desk_wm::edits::{Edit, Kept, apply};
use desk_wm::host::{
    BORDER, TITLE, TITLE_END, TITLE_START, body_of, title_bar_of, title_insets_of,
};
use desk_wm::{Desk, Rect, Size, TitleClearance};
use serde_json::json;

const APP: Size = Size {
    w: 1440.0,
    h: 900.0,
};

#[test]
fn a_title_bar_is_36_high_and_the_body_starts_under_it() {
    assert_eq!(TITLE, 36.0);
    let window = Rect::new(100.0, 100.0, 400.0, 300.0);
    assert_eq!(title_bar_of(window), Rect::new(101.0, 101.0, 398.0, 36.0));
    assert_eq!(body_of(window), Rect::new(101.0, 137.0, 398.0, 262.0));
}

#[test]
fn a_title_ends_before_three_tools_and_two_marks() {
    // The end padding, three 24 px tools 2 px apart, two 16 px marks each 2 px before what
    // follows, and the gap after the title.
    assert_eq!(
        TITLE_END,
        8.0 + 3.0 * 24.0 + 2.0 * 2.0 + 2.0 * (16.0 + 2.0) + 8.0
    );
    assert_eq!(TITLE_END, 128.0);
    assert_eq!(title_insets_of(TitleClearance::default()), (37.0, 129.0));
    // A fill's clearance still moves both in: the chips' room in place of the bar's own padding.
    let clear = TitleClearance {
        left: Some(312.0),
        right: Some(200.0),
    };
    assert_eq!(
        title_insets_of(clear),
        (
            312.0 - 12.0 + TITLE_START + BORDER,
            200.0 - 8.0 + 128.0 + BORDER
        )
    );
}

#[test]
fn a_window_is_38_taller_than_the_page_its_plugin_asked_for() {
    let hints = json!({ "size": { "w": 480.0, "h": 360.0 }, "min": { "w": 400.0, "h": 300.0 } });
    let edit = json!({ "op": "adopt", "id": "p.app", "title": "App", "window": hints });
    let edit: Edit = serde_json::from_value(edit).expect("an adopt edit");
    let mut desk = Desk::default();
    apply(&mut desk, &mut Kept::default(), &edit, APP);
    let p = desk.window("p.app").expect("its window");
    assert_eq!((p.w, p.h), (482.0, 398.0));
    assert_eq!(desk.least_of(&p), Size { w: 402.0, h: 338.0 });
}
