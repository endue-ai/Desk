//! A desktop coming in front slides in from the side it lies on (ADR 0222): its windows are drawn
//! a whole app to the side and come to rest over `--motion-base`, and the frame says how far the
//! desktop that left is, a whole app ahead.

use desk_wm::Desk;
use desk_wm::edits::Edit;
use desk_wm::interact::{Motion, Wm};

use super::support::*;

/// `window-1` on desktop 1 and `window-2` on desktop 2, desktop 1 in front.
fn two_desktops() -> Desk {
    let mut desk = windows(1);
    desk.set_desktop("2");
    desk.new_window();
    desk.set_desktop("1");
    desk
}

fn switch(wm: &mut Wm, seq: u64, to: &str) {
    wm.edit(seq, &[Edit::SwitchTo { desktop: to.into() }]);
}

/// The window manager with the desk's own motion (220 ms), its first frame drawn.
fn started() -> Wm {
    let mut wm = wm_over(&two_desktops(), Motion::default());
    let first = wm.frame(0.0);
    assert_eq!((first.slide, first.moving), (None, false), "the first desk");
    wm
}

#[test]
fn a_desktop_further_along_comes_in_from_the_right_and_the_one_that_left_goes_left() {
    let mut wm = started();
    switch(&mut wm, 1, "2");
    let rest = {
        let mut still = wm_of(&two_desktops());
        switch(&mut still, 1, "2");
        rect_of(&still, "window-2")
    };
    let start = wm.frame(1000.0);
    assert_eq!(start.slide, Some((W, 0.0)));
    assert!(start.moving);
    assert_eq!(start.drawn["window-2"].x, rest.x + W);
    assert_eq!(wm.drawn_rect("window-2", 1000.0).unwrap().x, rest.x + W);

    let mid = wm.frame(1110.0);
    let (aside, out) = mid.slide.expect("half way");
    assert!(aside > 0.0 && aside < W, "{aside}");
    assert_eq!(out, aside - W);
    let at = mid.drawn["window-2"];
    assert_eq!(
        (at.x, at.y, at.w, at.h),
        (rest.x + aside, rest.y, rest.w, rest.h)
    );

    let end = wm.frame(1220.0);
    assert_eq!((end.slide, end.moving), (None, false));
    assert!(end.drawn.is_empty(), "at rest: {:?}", end.drawn);
    assert_eq!(wm.drawn_rect("window-2", 1220.0), Some(rest));
}

#[test]
fn a_desktop_before_comes_in_from_the_left_whatever_the_distance() {
    let mut wm = started();
    switch(&mut wm, 1, "4");
    assert_eq!(wm.frame(1000.0).slide, Some((W, 0.0)));
    wm.frame(2000.0);
    switch(&mut wm, 2, "1");
    let back = wm.frame(3000.0);
    assert_eq!(back.slide, Some((-W, 0.0)));
    let (aside, out) = wm.frame(3110.0).slide.expect("half way");
    assert!(aside < 0.0 && aside > -W, "{aside}");
    assert_eq!(out, aside + W);
}

#[test]
fn a_switch_during_a_slide_starts_the_next_from_its_own_side() {
    let mut wm = started();
    switch(&mut wm, 1, "2");
    wm.frame(1000.0);
    switch(&mut wm, 2, "3");
    assert_eq!(wm.frame(1050.0).slide, Some((W, 0.0)));
    assert_eq!(wm.frame(1270.0).slide, None);
}

#[test]
fn nothing_slides_without_motion_or_when_the_same_desktop_stays_in_front() {
    let mut wm = wm_of(&two_desktops());
    wm.frame(0.0);
    switch(&mut wm, 1, "2");
    let frame = wm.frame(1000.0);
    assert_eq!((frame.slide, frame.moving), (None, false));
    assert!(frame.drawn.is_empty());

    let mut wm = started();
    switch(&mut wm, 1, "1");
    assert_eq!(wm.frame(1000.0).slide, None);
}
