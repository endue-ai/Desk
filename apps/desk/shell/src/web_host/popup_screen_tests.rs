use std::time::{Duration, Instant};

use cef::Rect;

use super::{App, Placed, SETTLE, Screen, settled};
use crate::web_host::render::popup::Popup;
use crate::web_host::view::View;

fn rect(x: i32, y: i32, width: i32, height: i32) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}

/// `[x, y, width, height]` of a CEF rect, which has no equality of its own.
fn quad(r: Rect) -> [i32; 4] {
    [r.x, r.y, r.width, r.height]
}

/// A 1280 × 800 app window: between its bars and under Eris at home (`desk_wm::host::bars`).
const APP: App = App {
    width: 1280,
    height: 800,
    free: [104, 190, 1072, 498],
};

/// A first window's pane in it.
const PANE: Placed = Placed {
    x: 849,
    y: 295,
    app: APP,
};

#[test]
fn a_view_drawn_nowhere_yet_is_its_own_screen() {
    let screen = Screen::default();
    assert_eq!(quad(screen.view_rect((326, 169))), [0, 0, 326, 169]);
    let (whole, free) = screen.rects((326, 169));
    assert_eq!(
        (quad(whole), quad(free)),
        ([0, 0, 326, 169], [0, 0, 326, 169])
    );
    assert_eq!(quad(screen.view_rect((0, 0))), [0, 0, 1, 1], "never empty");
    assert!(!screen.due(Instant::now(), true));
}

#[test]
fn a_view_tells_its_browser_where_it_rests_and_answers_only_what_it_told() {
    let t0 = Instant::now();
    let mut screen = Screen::default();
    screen.placed(PANE, t0);
    assert!(!screen.due(t0, true), "not at rest yet");
    assert!(
        !screen.due(t0 + SETTLE, false),
        "a resize in flight, or a popup open"
    );
    assert_eq!(
        quad(screen.view_rect((326, 169))),
        [0, 0, 326, 169],
        "untold"
    );
    assert!(screen.due(t0 + SETTLE, true));
    screen.tell(1);
    assert_eq!(quad(screen.view_rect((326, 169))), [849, 295, 326, 169]);
    let (whole, free) = screen.rects((326, 169));
    assert_eq!(quad(whole), [0, 0, 1280, 800], "the app window");
    assert_eq!(quad(free), [104, 190, 1072, 498], "less its bars");
    assert!(!screen.due(t0 + 2 * SETTLE, true), "told");
    // The same place again is no move; a glide is told only where it stops.
    let t1 = t0 + Duration::from_secs(1);
    screen.placed(PANE, t1);
    assert!(!screen.due(t1 + SETTLE, true));
    for (i, x) in [700, 600, 500].into_iter().enumerate() {
        let at = t1 + Duration::from_millis(16 * i as u64);
        screen.placed(Placed { x, ..PANE }, at);
        assert!(
            !screen.due(at + Duration::from_millis(16), true),
            "{x}: moving"
        );
    }
    assert_eq!(
        screen.view_rect((326, 169)).x,
        849,
        "what it told, till it tells again"
    );
    assert!(screen.due(t1 + Duration::from_millis(32) + SETTLE, true));
    screen.tell(1);
    assert_eq!(screen.view_rect((326, 169)).x, 500);
    // A new app window size is a new screen too.
    let wider = App { width: 1440, ..APP };
    screen.placed(
        Placed {
            x: 500,
            app: wider,
            ..PANE
        },
        t1 + Duration::from_secs(1),
    );
    assert!(screen.due(t1 + Duration::from_secs(2), true));
}

#[test]
fn an_app_window_is_whole_pixels_and_its_free_area_lies_inside_it() {
    let app = App::new((1279.6, 800.2), [103.5, 190.0, 1072.0, 498.4]);
    assert_eq!(
        (app.width, app.height, app.free),
        (1280, 800, [104, 190, 1072, 498])
    );
    // The free area of a small app keeps windows' smallest size: never past the app.
    let small = App::new((300.0, 200.0), [104.0, 190.0, 240.0, 160.0]);
    assert_eq!(small.free, [104, 190, 196, 10]);
    let none = App::new((0.0, 0.0), [0.0, 0.0, 0.0, 0.0]);
    assert_eq!((none.width, none.height, none.free), (1, 1, [0, 0, 1, 1]));
    assert_eq!(
        Placed::new(848.6, 294.4, app),
        Placed {
            x: 849,
            y: 294,
            app
        }
    );
}

#[test]
fn a_view_settles_shown_painted_at_its_size_and_with_no_popup_open() {
    let mut view = View::new("main.e2e-popup", (326, 169), 2.0, false);
    assert!(!settled(&view), "nothing painted yet");
    view.next_frame((652, 338));
    view.counts.paints += 1;
    assert!(settled(&view));
    view.screen.tell(1);
    assert!(
        !settled(&view),
        "told, and no paint since: CEF holds the view's bounds"
    );
    view.counts.software_paints += 1;
    assert!(settled(&view), "painted since");
    view.size = (400, 169);
    assert!(!settled(&view), "a resize in flight");
    view.next_frame((801, 338));
    assert!(settled(&view), "a pixel's rounding apart");
    view.hidden = true;
    assert!(!settled(&view), "hidden");
    view.hidden = false;
    view.popup = Popup::default();
    view.popup.shown(true);
    view.popup.sized(&rect(160, 38, 218, 281));
    assert!(!settled(&view), "a popup open where the old screen put it");
}

#[test]
fn a_new_scale_tells_the_screen_with_it() {
    let mut view = View::new("main.e2e-popup", (326, 169), 1.0, false);
    view.screen.placed(PANE, Instant::now());
    assert!(!view.rescaled());
    assert_eq!(view.screen.view_rect(view.size).x, 0);
    view.scale = 2.0;
    assert!(view.rescaled(), "CEF reads the screen now");
    assert_eq!(quad(view.screen.view_rect(view.size)), [849, 295, 326, 169]);
}
