use super::{
    COLD, Clock, Copies, FRAME, IDLE, IDLE_RATE, LONG_IDLE, PROMPT, PROMPT_FOR, Pacing, heard,
    on_clock, prompts, take_heard,
};
use crate::web_host::lifecycle::State;
use std::time::{Duration, Instant};

/// Which of desk `frames` a surface that painted `paints` frames takes, as `x` and `.`.
fn taken(pacing: &mut Pacing, now: Instant, frames: std::ops::Range<u64>, paints: u64) -> String {
    frames
        .map(|k| {
            if pacing.due(now, Some(k), paints) {
                'x'
            } else {
                '.'
            }
        })
        .collect()
}

fn ms(at: Instant, ms: f64) -> Instant {
    at + Duration::from_secs_f64(ms / 1000.0)
}

#[test]
fn a_surfaces_pace_takes_every_desk_frame_or_skips_evenly() {
    let now = Instant::now();
    let pattern = |pace: u32, n: u64| taken(&mut Pacing::new(pace), now, 0..n, 0);
    assert_eq!(pattern(60, 6), "xxxxxx");
    assert_eq!(pattern(240, 3), "xxx", "never more than the desk's frames");
    assert_eq!(pattern(30, 6), "x.x.x.");
    assert_eq!(pattern(10, 13), "x.....x.....x");
    assert_eq!(pattern(45, 8), "x.xxx.xx", "three in four");
    assert_eq!(
        pattern(0, 3),
        "x..",
        "at least one a second, the first at once"
    );
    let mut pacing = Pacing::new(60);
    assert!(!pacing.due(now, None, 0), "only desk frames are paced");
    assert_eq!(taken(&mut pacing, now, 0..3, 0), "xxx");
    pacing.set_pace(30);
    assert_eq!(
        taken(&mut pacing, now, 3..7, 0),
        "x.x.",
        "a new pace from the next frame"
    );
    let mut late = Pacing::new(30);
    assert_eq!(
        taken(&mut late, now, 5..9, 0),
        "x.x.",
        "its first desk frame is its own"
    );
}

#[test]
fn a_long_idle_surface_takes_one_desk_frame_in_six_on_frames_every_long_idle_surface_shares() {
    let t0 = Instant::now();
    let (mut a, mut b) = (Pacing::new(60), Pacing::new(60));
    assert!(a.due(t0, Some(0), 0));
    assert!(b.due(t0, Some(3), 0), "b's first frame is its own");
    let rest = t0 + LONG_IDLE;
    assert!(a.long_idle(rest) && b.long_idle(rest));
    assert_eq!(taken(&mut a, rest, 60..73, 0), "x.....x.....x");
    assert_eq!(
        taken(&mut b, rest, 60..73, 0),
        "x.....x.....x",
        "the same frames"
    );
    assert_eq!(IDLE_RATE, 10);
    let mut slow = Pacing::new(1);
    slow.due(t0, Some(1), 0);
    assert_eq!(
        taken(&mut slow, rest, 61..121, 0).matches('x').count(),
        1,
        "never faster than its pace"
    );
    // Input or a message puts it back on every frame, and so does a paint.
    a.heard(rest);
    assert!(!a.long_idle(rest));
    assert_eq!(taken(&mut a, rest, 73..76, 0), "xxx");
    let later = rest + LONG_IDLE;
    assert_eq!(taken(&mut b, later, 126..129, 0), "x..");
    assert!(b.due(later, Some(129), 1), "it painted");
    assert_eq!(taken(&mut b, later, 130..132, 1), "xx");
}

#[test]
fn the_clock_numbers_its_frames_never_makes_up_a_late_one_and_starts_at_once() {
    let mut clock = Clock::default();
    let t0 = Instant::now();
    assert_eq!(clock.next(), None);
    assert_eq!(
        clock.frame(t0),
        Some(0),
        "a stopped clock's first frame is at once"
    );
    assert_eq!(clock.frame(t0 + FRAME / 2), None);
    assert_eq!(clock.frame(t0 + FRAME), Some(1));
    assert_eq!(clock.next(), Some(t0 + FRAME * 2));
    assert_eq!(
        clock.frame(t0 + FRAME * 5),
        Some(5),
        "late: the ones between are skipped"
    );
    assert_eq!(clock.next(), Some(t0 + FRAME * 6), "and not made up");
    assert_eq!(clock.frame(t0 + FRAME * 5 + FRAME / 2), None);
    let behind = t0 + FRAME * 7 + FRAME * 3 / 4;
    assert_eq!(clock.frame(behind), Some(7));
    assert_eq!(
        clock.next(),
        Some(behind + FRAME),
        "half a frame late starts again from it"
    );
    clock.stop();
    assert_eq!(clock.next(), None);
    assert_eq!(clock.frame(behind), Some(0));
}

#[test]
fn a_desk_at_rest_wakes_for_its_clock_ten_times_a_second() {
    let t0 = Instant::now();
    let mut clock = Clock::default();
    let mut pacing = Pacing::new(60);
    assert!(pacing.due(t0, clock.frame(t0), 1));
    assert_eq!(
        pacing.next(&clock, t0),
        Some(t0 + FRAME),
        "awake: every frame"
    );
    let rest = t0 + LONG_IDLE;
    let k = clock.frame(rest).unwrap();
    pacing.due(rest, Some(k), 1);
    let next = pacing.next(&clock, rest).unwrap();
    let wait = next - rest;
    assert!(
        wait <= FRAME * 6 && next == clock.at(k.next_multiple_of(6).max(k + 1)).unwrap(),
        "the next frame long-idle surfaces share: {wait:?}"
    );
    let mut looks = 0;
    let mut now = rest;
    loop {
        let next = pacing.next(&clock, now).unwrap();
        if next >= rest + Duration::from_secs(1) {
            break;
        }
        now = next;
        let frame = clock.frame(now);
        assert!(pacing.due(now, frame, 1), "a frame it takes");
        looks += 1;
    }
    assert_eq!(looks, 10, "one look a long-idle frame");
    pacing.press(now, 1);
    assert_eq!(pacing.next(&clock, now), Some(now), "a press looks at once");
}

#[test]
fn a_press_on_an_idle_surface_brings_begin_frames_at_once_until_it_paints() {
    let mut pacing = Pacing::new(1);
    let t0 = Instant::now();
    assert!(pacing.due(t0, Some(0), 0), "its first frame");
    assert!(!pacing.due(t0 + FRAME, Some(1), 0), "a second's pace");
    let pressed = t0 + FRAME;
    pacing.press(pressed, 0);
    let clock = Clock::default();
    assert_eq!(
        pacing.next(&clock, pressed),
        Some(pressed),
        "from the press on"
    );
    let looks = [0.0, 0.5, 1.0, 2.0, 3.0];
    let got: Vec<bool> = looks
        .iter()
        .map(|t| pacing.due(ms(pressed, *t), None, 0))
        .collect();
    assert_eq!(got, [true, false, true, true, true], "every {PROMPT:?}");
    assert!(!pacing.due(ms(pressed, 3.5), None, 0));
    assert!(
        pacing.due(ms(pressed, 9.0), None, 0),
        "a late look takes one"
    );
    assert!(
        !pacing.due(ms(pressed, 9.1), None, 0),
        "not every one it missed"
    );
    assert!(
        !pacing.due(ms(pressed, 10.0), None, 1),
        "its paint came: no more"
    );
    assert_eq!(pacing.next(&clock, ms(pressed, 10.0)), None);

    let mut unanswered = Pacing::new(1);
    unanswered.due(t0, Some(0), 0);
    unanswered.press(pressed, 0);
    let sent = (0..60)
        .filter(|t| unanswered.due(ms(pressed, f64::from(*t)), None, 0))
        .count();
    assert_eq!(sent, 34, "{PROMPT_FOR:?} of them when no paint comes");
}

#[test]
fn a_press_on_a_surface_that_paints_already_waits_for_its_desk_frames() {
    let mut pacing = Pacing::new(60);
    let t0 = Instant::now();
    assert!(pacing.due(t0, Some(0), 1), "it painted");
    pacing.press(t0 + FRAME, 2);
    let clock = Clock::default();
    assert_eq!(
        pacing.next(&clock, t0 + FRAME),
        None,
        "it takes every desk frame"
    );
    assert!(pacing.due(t0 + FRAME, Some(1), 2));
    let idle = t0 + FRAME + IDLE;
    pacing.press(idle, 2);
    assert_eq!(
        pacing.next(&clock, idle),
        Some(idle),
        "idle again after {IDLE:?}"
    );
}

#[test]
fn only_visible_awake_surfaces_are_on_the_clock_presses_prompt_and_the_clock_hears_them() {
    assert!(on_clock(State::Live { hidden: false }));
    for state in [
        State::Live { hidden: true },
        State::Asleep { hidden: false },
        State::Dead { hidden: false },
        State::Gone,
    ] {
        assert!(!on_clock(state), "{state:?}");
    }
    let message = |value: serde_json::Value| serde_json::from_value(value).unwrap();
    let press = serde_json::json!({ "type": "pointer.down", "surface": "s", "x": 1, "y": 1,
        "button": "left", "buttons": [], "clicks": 1, "modifiers": [] });
    let moved = serde_json::json!({ "type": "pointer.move", "surface": "s", "x": 1, "y": 1,
        "buttons": [], "modifiers": [] });
    assert!(prompts(&message(press)));
    assert!(
        !prompts(&message(moved)),
        "moves paint on the desk's frames"
    );
    // Other tests may hear too: look for this one's browser only.
    heard(-117, true);
    heard(-118, false);
    let got: Vec<(i32, bool)> = take_heard()
        .into_iter()
        .filter(|(id, _, _)| *id <= -117)
        .map(|(id, _, prompt)| (id, prompt))
        .collect();
    assert_eq!(got, [(-117, true), (-118, false)]);
}

#[test]
fn input_to_a_desk_that_painted_nothing_for_a_while_wakes_the_gpus_copies_once() {
    let t0 = Instant::now();
    let mut copies = Copies::default();
    assert!(copies.wake(t0), "nothing painted yet: cold");
    assert!(!copies.wake(t0 + COLD / 2), "the wake-up counts as a copy");
    assert!(copies.wake(t0 + COLD), "cold again {COLD:?} later");
    let painted = t0 + COLD * 3;
    copies.copied(painted);
    copies.copied(painted - FRAME);
    assert!(
        !copies.wake(painted + COLD - FRAME),
        "a paint is a copy, and the latest counts"
    );
    assert!(copies.wake(painted + COLD));
    assert!(COLD < LONG_IDLE, "woken well before a second without one");
}

#[test]
fn the_clock_notes_when_a_surface_painted() {
    let t0 = Instant::now();
    let mut pacing = Pacing::new(60);
    pacing.due(t0, Some(0), 0);
    assert_eq!(pacing.painted(), None, "no paint yet");
    pacing.due(t0 + FRAME, Some(1), 1);
    assert_eq!(pacing.painted(), Some(t0 + FRAME));
    pacing.due(t0 + FRAME * 2, Some(2), 1);
    assert_eq!(
        pacing.painted(),
        Some(t0 + FRAME),
        "only when its count moves"
    );
}
