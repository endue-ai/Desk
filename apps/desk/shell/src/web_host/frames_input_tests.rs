//! Input on the frame clock (ADR 0231, `frames_pacing.rs`): a surface that heard input takes the
//! next desk frame, the two after a paint and the slow frames, not every desk frame for a second.
//! Chromium's display holds a begin frame its page had nothing for to its deadline, a desk frame
//! on, and CEF sends none meanwhile: on every desk frame, a press's prompt waited for the one out.

use super::Pacing;
use crate::web_host::frames::{AFTER_PAINT, Clock, FRAME, LONG_IDLE, PROMPT_AFTER, RATE, SLOW};
use std::time::{Duration, Instant};

/// A surface whose page painted once and that has rested since, looked at every desk frame for two
/// seconds: when the last look was, and its frame.
fn rested() -> (Pacing, Instant, u64) {
    let t0 = Instant::now();
    let mut pacing = Pacing::default();
    let frames = u64::from(RATE) * 2;
    for k in 0..=frames {
        pacing.due(t0 + FRAME * k as u32, Some(k), 1);
    }
    let now = t0 + FRAME * frames as u32;
    assert!(pacing.long_idle(now), "it rests");
    (pacing, now, frames)
}

/// The desk frames after frame `k` at `from` that the surface takes, each looked at on time with
/// `paints` painted.
fn frames_after(pacing: &mut Pacing, from: Instant, k: u64, count: u32, paints: u64) -> String {
    (1..=count)
        .map(|j| pacing.due(from + FRAME * j, Some(k + u64::from(j)), paints))
        .map(|due| if due { 'x' } else { '.' })
        .collect()
}

#[test]
fn input_brings_the_next_desk_frame_and_the_slow_ones_not_every_desk_frame() {
    let (mut pacing, now, k) = rested();
    // A move, between two desk frames.
    let moved = now + FRAME / 2;
    pacing.input(moved);
    assert!(!pacing.long_idle(moved), "it is awake");
    assert!(!pacing.due(moved, None, 1), "no begin frame between frames");
    let clock = {
        let mut clock = Clock::default();
        clock.frame(now);
        clock
    };
    assert_eq!(
        pacing.next(&clock, moved),
        Some(now + FRAME),
        "it looks at the next desk frame"
    );
    let second = frames_after(&mut pacing, now, k, RATE, 1);
    assert_eq!(
        second,
        "x.....".repeat(10),
        "the frame after the move, then {SLOW} a second from it"
    );
    assert_eq!(
        second.matches('x').count(),
        10,
        "a press finds no begin frame out most of the time: every desk frame took 60"
    );
    let later = now + FRAME * RATE + LONG_IDLE;
    assert!(pacing.long_idle(later), "and it rests again");
}

#[test]
fn a_stream_of_moves_takes_every_desk_frame_while_it_lasts() {
    let (mut pacing, now, k) = rested();
    let taken: String = (1..=12u32)
        .map(|j| {
            // Two moves a desk frame, as a pointer at 120 Hz sends.
            pacing.input(now + FRAME * j - FRAME / 4);
            pacing.input(now + FRAME * j - FRAME / 8);
            pacing.due(now + FRAME * j, Some(k + u64::from(j)), 1)
        })
        .map(|due| if due { 'x' } else { '.' })
        .collect();
    assert_eq!(taken, "xxxxxxxxxxxx");
    let after = frames_after(&mut pacing, now + FRAME * 12, k + 12, 8, 1);
    assert_eq!(
        after, ".....x..",
        "then the slow frames, from the last move"
    );
}

#[test]
fn the_slow_frames_count_from_the_last_input() {
    let (mut pacing, now, k) = rested();
    pacing.input(now);
    assert_eq!(frames_after(&mut pacing, now, k, 4, 1), "x...");
    // A key 70 ms on: its own frame, and the slow one that was 30 ms away waits a period more.
    let again = now + FRAME * 4 + FRAME / 2;
    pacing.input(again);
    assert_eq!(
        frames_after(&mut pacing, now + FRAME * 4, k + 4, 9, 1),
        "x.....x..",
        "one begin frame for the key, the next a slow period after it"
    );
}

#[test]
fn a_paint_after_input_brings_the_next_two_desk_frames_and_a_second_paint_every_one() {
    assert_eq!(AFTER_PAINT, 2);
    let (mut pacing, now, k) = rested();
    pacing.input(now + FRAME / 2);
    // The move's frame painted (a hover's colour): the two desk frames after it, then the slow ones.
    assert!(pacing.due(now + FRAME, Some(k + 1), 1));
    let lone = frames_after(&mut pacing, now + FRAME, k + 1, 9, 2);
    assert_eq!(lone, "xx...x...", "two frames for a change that goes on");
    // A hover that starts a transition paints again on the first of them: every frame from there.
    let (mut going, now, k) = rested();
    going.input(now + FRAME / 2);
    assert!(going.due(now + FRAME, Some(k + 1), 1));
    let taken: String = (2..=9u32)
        .map(|j| going.due(now + FRAME * j, Some(k + u64::from(j)), u64::from(j)))
        .map(|due| if due { 'x' } else { '.' })
        .collect();
    assert_eq!(taken, "xxxxxxxx", "it paints: every desk frame");
}

#[test]
fn a_paint_at_rest_brings_no_desk_frames_after_it() {
    // A caret's blink on a surface that heard nothing: the slow frames alone (ADR 0185).
    let (mut pacing, now, k) = rested();
    pacing.ask(now);
    assert!(pacing.due(now + FRAME, Some(k + 1), 1), "its page asked");
    assert!(
        pacing.due(now + FRAME * 2, Some(k + 2), 2),
        "the ask's frames"
    );
    assert_eq!(
        frames_after(&mut pacing, now + FRAME * 2, k + 2, 9, 2),
        ".....x...",
        "a slow frame, no two after the paint"
    );
}

#[test]
fn the_paint_a_press_waited_for_does_not_put_its_surface_on_every_desk_frame() {
    // Presses 150 ms apart (typing, the probe's click page), each painted 6 ms after it: two paints
    // within a quarter of a second, yet no animation.
    let (mut pacing, mut now, mut k) = rested();
    let mut paints = 1;
    for press in 0..4 {
        let pressed = now + FRAME / 4;
        pacing.press(pressed, paints);
        assert!(
            !pacing.due(pressed, None, paints),
            "press {press}: no begin frame before its first prompt"
        );
        assert!(
            pacing.due(pressed + PROMPT_AFTER, None, paints),
            "press {press}: its first prompt, {PROMPT_AFTER:?} after it"
        );
        paints += 1;
        let painted = pressed + Duration::from_millis(6);
        assert!(!pacing.due(painted, None, paints), "press {press}: painted");
        // Nine desk frames to the next press: the two after the paint and a slow one.
        let between = frames_after(&mut pacing, now, k, 9, paints);
        assert_eq!(between, "xx....x..", "press {press}: not every desk frame");
        now += FRAME * 9;
        k += 9;
    }
}

#[test]
fn a_press_whose_page_asks_gets_its_first_prompt_then_not_at_the_timers() {
    let (mut pacing, now, _) = rested();
    let pressed = now + FRAME / 4;
    pacing.press(pressed, 1);
    let clock = Clock::default();
    assert_eq!(pacing.next(&clock, pressed), Some(pressed + PROMPT_AFTER));
    // Its page handled the press, changed and asked, half a millisecond on.
    let asked = pressed + Duration::from_micros(500);
    assert!(!pacing.due(asked, None, 1), "nothing yet");
    pacing.ask(asked);
    assert_eq!(pacing.next(&clock, asked), Some(asked), "at once");
    assert!(
        pacing.due(asked, None, 1),
        "the begin frame its change is for"
    );
    assert!(!pacing.due(pressed + PROMPT_AFTER / 2, None, 1));
    assert!(
        pacing.due(asked + Duration::from_millis(1), None, 1),
        "and the prompts after it, until its paint"
    );
    // A page that asks nothing (a change of style alone) keeps the timer's.
    let (mut still, now, _) = rested();
    still.press(now, 1);
    assert!(!still.due(now + PROMPT_AFTER / 2, None, 1));
    assert!(still.due(now + PROMPT_AFTER, None, 1));
}

#[test]
fn a_message_that_is_not_input_still_wakes_a_surface_onto_every_desk_frame() {
    let (mut pacing, now, k) = rested();
    pacing.told(now, true);
    assert!(pacing.long_idle(now), "input is heard at its browser");
    pacing.told(now, false);
    assert_eq!(
        frames_after(&mut pacing, now, k, 6, 1),
        "xxxxxx",
        "a size, its screen"
    );
}
