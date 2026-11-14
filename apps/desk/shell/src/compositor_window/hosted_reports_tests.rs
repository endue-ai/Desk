//! #269, ADR 0215: the desk's page sends its report and its picture apart, and while the app window
//! resizes the report runs ahead. A report laid out for another size than the page's last picture
//! waits for a picture of its size; one of the picture's size, and any while no picture can come,
//! is taken at once.

use std::time::Instant;

use desk_wm::{Desk, Size};
use serde_json::json;

use super::Hosted;
use crate::compositor_window::report::DeskReport;

const SCALE: f64 = 2.0;

/// Mail fills the app: its rect follows the size its report was laid out for.
fn desk() -> Desk {
    let mail = json!({ "id": "endue.mail", "plugin": "endue.mail", "x": 0, "y": 0, "w": 400,
        "h": 300, "pinned": false, "floating": true, "fill": "full",
        "restore": { "x": 0, "y": 0, "w": 400, "h": 300 } });
    serde_json::from_value(
        json!({ "desktop": "1", "session": { "1": { "surfaces": [mail] } },
        "adopted": [{ "id": "endue.mail", "title": "Mail", "slot": 0 }] }),
    )
    .unwrap()
}

/// The page's report `seq`, laid out at `w`×`h` CSS pixels.
fn laid(seq: u64, w: f64, h: f64) -> DeskReport {
    serde_json::from_value(json!({ "seq": seq, "width": w, "height": h })).unwrap()
}

/// A picture of the page at `w`×`h` CSS pixels, in device pixels.
fn picture(w: f64, h: f64) -> (u32, u32) {
    ((w * SCALE).round() as u32, (h * SCALE).round() as u32)
}

/// A desk whose page reported `seq` 1 at 1440×900 and painted it.
fn shown() -> (Hosted, Instant) {
    let now = Instant::now();
    let mut hosted = Hosted::new(SCALE);
    hosted.wm.start(
        desk(),
        Size {
            w: 1440.0,
            h: 900.0,
        },
    );
    hosted.apply(laid(1, 1440.0, 900.0), now);
    hosted.page_picture(picture(1440.0, 900.0), now);
    (hosted, now)
}

/// The size the plan's scene is laid out for, and the report it came from.
fn scene(hosted: &Hosted) -> (f64, f64, u64) {
    let plan = hosted.plan().expect("a plan");
    (plan.screen.w, plan.screen.h, hosted.seq())
}

#[test]
fn a_report_laid_out_for_another_size_than_the_pages_picture_waits_for_a_picture_of_its_size() {
    let (mut hosted, now) = shown();
    hosted.apply(laid(2, 1600.0, 1000.0), now);
    assert_eq!(
        scene(&hosted),
        (1440.0, 900.0, 1),
        "the picture still shows 1440×900"
    );
    let mail = |h: &Hosted| h.plan().unwrap().window("endue.mail").unwrap().rect;
    let before = mail(&hosted);
    hosted.page_picture(picture(1600.0, 1000.0), now);
    assert_eq!(scene(&hosted), (1600.0, 1000.0, 2), "its picture came");
    assert!(
        mail(&hosted).w > before.w,
        "Mail fills the new size with it"
    );
}

#[test]
fn a_picture_takes_the_newest_report_of_its_size_and_the_older_ones_go() {
    let (mut hosted, now) = shown();
    for (seq, w, h) in [(2, 1500.0, 950.0), (3, 1600.0, 1000.0), (4, 1700.0, 1050.0)] {
        hosted.apply(laid(seq, w, h), now);
    }
    hosted.page_picture(picture(1600.0, 1000.0), now);
    assert_eq!(scene(&hosted), (1600.0, 1000.0, 3), "2 went with it");
    hosted.page_picture(picture(1700.0, 1050.0), now);
    assert_eq!(scene(&hosted), (1700.0, 1050.0, 4));
    hosted.apply(laid(3, 1600.0, 1000.0), now);
    assert_eq!(
        scene(&hosted),
        (1700.0, 1050.0, 4),
        "an older report arriving late"
    );
}

#[test]
fn a_report_of_the_pictures_size_is_taken_at_once_and_the_ones_held_before_it_go() {
    let (mut hosted, now) = shown();
    hosted.apply(laid(2, 1440.0, 900.0), now);
    assert_eq!(scene(&hosted), (1440.0, 900.0, 2), "at rest nothing waits");
    hosted.apply(laid(3, 1600.0, 1000.0), now);
    hosted.apply(laid(4, 1440.0, 900.0), now);
    assert_eq!(
        scene(&hosted),
        (1440.0, 900.0, 4),
        "back to the picture's size"
    );
    hosted.page_picture(picture(1600.0, 1000.0), now);
    assert_eq!(
        scene(&hosted),
        (1440.0, 900.0, 4),
        "3 is older than the scene: gone"
    );
    // Within a device pixel, as a size rounds.
    let (mut hosted, now) = shown();
    hosted.apply(laid(2, 1440.5, 899.5), now);
    assert_eq!(scene(&hosted).2, 2);
}

#[test]
fn a_picture_of_a_size_no_report_has_takes_the_newest_held_so_no_report_waits_for_ever() {
    let (mut hosted, now) = shown();
    hosted.apply(laid(2, 1600.0, 1000.0), now);
    hosted.apply(laid(3, 1700.0, 1050.0), now);
    // The page painted a size before its report came.
    hosted.page_picture(picture(1800.0, 1100.0), now);
    assert_eq!(scene(&hosted), (1700.0, 1050.0, 3));
    hosted.apply(laid(4, 1800.0, 1100.0), now);
    assert_eq!(
        scene(&hosted),
        (1800.0, 1100.0, 4),
        "of the picture's size: at once"
    );
}

#[test]
fn while_no_picture_can_come_a_report_is_taken_at_once() {
    // Before the page's first picture.
    let now = Instant::now();
    let mut hosted = Hosted::new(SCALE);
    hosted.wm.start(
        desk(),
        Size {
            w: 1440.0,
            h: 900.0,
        },
    );
    hosted.apply(laid(1, 1440.0, 900.0), now);
    hosted.apply(laid(2, 1600.0, 1000.0), now);
    assert_eq!(scene(&hosted).2, 2);
    // Off screen the page paints nothing: what was held is taken, and what comes next too.
    let (mut hosted, now) = shown();
    hosted.apply(laid(2, 1600.0, 1000.0), now);
    hosted.occluded(true, now);
    assert_eq!(scene(&hosted), (1600.0, 1000.0, 2));
    hosted.apply(laid(3, 1700.0, 1050.0), now);
    assert_eq!(scene(&hosted), (1700.0, 1050.0, 3));
}
