//! A web view's box and id (`web_views.rs`).

use super::*;

fn place(width: f64, height: f64, shown: bool) -> WebPlace {
    WebPlace {
        x: 0.0,
        y: 40.0,
        width,
        height,
        shown,
        fill: false,
    }
}

#[test]
fn a_view_shows_only_with_a_box_and_lays_out_at_whole_pixels() {
    assert!(shows(&place(640.0, 480.0, true)));
    assert!(!shows(&place(640.0, 480.0, false)), "hidden by its plugin");
    assert!(!shows(&place(0.0, 480.0, true)), "no width");
    assert!(!shows(&place(640.0, 0.4, true)), "less than a pixel");
    assert_eq!(size_of(&place(640.4, 479.6, true)), (640, 480));
    assert_eq!(
        size_of(&place(0.0, 0.0, true)),
        (1, 1),
        "a browser has a size"
    );
    assert_eq!(size_of(&place(1e9, 10.0, true)).0, 16384);
}

#[test]
fn a_view_is_found_by_the_id_the_core_gave_it() {
    let mut views = Views::default();
    let web = WebView {
        last_find: None,
        id: "w-3".into(),
        place: place(1.0, 1.0, true),
        keys: false,
        state: WebState::default(),
        pending: None,
        calls: Default::default(),
    };
    views.by_host.insert("main.endue-browser".into(), web);
    assert_eq!(views.host_of("w-3").as_deref(), Some("main.endue-browser"));
    assert_eq!(views.host_of("w-4"), None);
}

#[test]
fn a_filling_view_reflows_with_the_requested_pane_size_and_hides_when_empty() {
    let fill = WebPlace {
        fill: true,
        ..place(640.0, 480.0, true)
    };
    let grown = fill.in_pane(900.0, 700.0);
    assert_eq!(size_of(&grown), (900, 660));
    assert!(shows(&grown));
    assert!(!shows(&fill.in_pane(900.0, 40.0)));
    let fixed = place(640.0, 480.0, true);
    assert_eq!(fixed.in_pane(900.0, 700.0), fixed);
}
