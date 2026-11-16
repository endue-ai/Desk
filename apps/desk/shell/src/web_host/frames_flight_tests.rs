//! A browser's begin frame in flight (#339, ADR 0261): the clock sends none while the last is out.

use super::{FRAME, Flight};
use crate::web_host::view::View;
use std::time::{Duration, Instant};

#[test]
fn a_begin_frame_waits_while_the_last_one_is_out() {
    let now = Instant::now();
    let mut flight = Flight::default();
    assert_eq!(flight.out(now, 0), None, "nothing sent yet");
    flight.sent(now, 0);
    assert_eq!(
        flight.out(now, 0),
        Some(now + FRAME),
        "out until a desk frame on"
    );
    let soon = now + Duration::from_millis(1);
    assert_eq!(
        flight.out(soon, 0),
        Some(now + FRAME),
        "a prompt's next is held too"
    );
    assert_eq!(
        flight.out(now + FRAME, 0),
        None,
        "a frame with nothing to draw ended"
    );
    flight.restart();
    assert_eq!(flight.out(soon, 0), None, "a new browser has nothing out");
}

#[test]
fn a_paint_ends_the_frame_out_at_once() {
    let now = Instant::now();
    let mut flight = Flight::default();
    flight.sent(now, 7);
    assert_eq!(flight.out(now + Duration::from_millis(2), 8), None);
}

#[test]
fn the_clock_counts_the_frames_it_held() {
    let now = Instant::now();
    let mut view = View::new("s", (400, 300), 2.0, false);
    assert_eq!(view.begin_frame(now), Ok(()));
    let soon = now + Duration::from_millis(1);
    assert_eq!(view.begin_frame(soon), Err(now + FRAME));
    assert_eq!((view.counts.begin_frames, view.counts.held), (1, 1));
    // Its page paints: the next goes at once.
    view.next_frame((800, 600));
    view.counts.paints += 1;
    assert_eq!(view.begin_frame(soon), Ok(()));
    assert_eq!((view.counts.begin_frames, view.counts.held), (2, 1));
    // Loaded again: nothing of the old browser is out.
    view.restart();
    assert_eq!(view.begin_frame(soon), Ok(()));
}
