use super::{
    ASKED_FOR, COLD, Clock, Copies, FRAME, Heard, IDLE, LONG_IDLE, PROMPT, PROMPT_FOR, Pacing,
    asked, heard, on_clock, prompts, take_heard,
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
fn a_long_idle_surface_rests_until_it_hears_something_paints_or_its_page_asks() {
    let t0 = Instant::now();
    let (mut a, mut b) = (Pacing::new(60), Pacing::new(60));
    assert!(a.due(t0, Some(0), 1), "a's page painted");
    assert!(b.due(t0, Some(3), 1), "b's first frame is its own");
    let rest = t0 + LONG_IDLE;
    assert!(a.long_idle(rest) && b.long_idle(rest));
    assert_eq!(
        taken(&mut a, rest, 60..73, 1),
        ".............",
        "no frame at rest"
    );
    assert_eq!(taken(&mut b, rest, 60..73, 1), ".............");
    // Input or a message puts it back on every frame.
    a.heard(rest);
    assert!(!a.long_idle(rest));
    assert_eq!(taken(&mut a, rest, 73..76, 1), "xxx");
    // Its page asks: the desk frames within ASKED_FOR, then none again, unless they brought a paint.
    let asked = rest + FRAME / 2;
    b.ask(asked);
    let looks = [0.0, 16.7, 33.4, 50.1].map(|t| ms(asked, t));
    let got: Vec<bool> = looks
        .iter()
        .zip(80u64..)
        .map(|(at, k)| b.due(*at, Some(k), 1))
        .collect();
    assert_eq!(
        got,
        [true, true, true, false],
        "{ASKED_FOR:?} of desk frames"
    );
    assert!(
        b.long_idle(looks[3]),
        "nothing came of them: it rests again"
    );
    b.ask(looks[3]);
    assert!(b.due(looks[3], Some(84), 1));
    let painted = looks[3] + FRAME;
    assert!(b.due(painted, Some(85), 2), "a paint came");
    assert!(
        !b.long_idle(painted + LONG_IDLE / 2),
        "awake: it takes its pace's frames"
    );
    assert_eq!(taken(&mut b, painted + FRAME, 86..89, 2), "xxx");
}

#[test]
fn a_page_that_has_not_painted_since_it_loaded_never_rests() {
    let t0 = Instant::now();
    let mut slow = Pacing::new(60);
    // A start-up script holds the page's thread: no paint, no ask, for longer than LONG_IDLE.
    assert!(slow.due(t0, Some(0), 0));
    let late = t0 + LONG_IDLE * 3;
    assert!(
        !slow.long_idle(late),
        "not painted since it loaded: not resting"
    );
    assert_eq!(
        taken(&mut slow, late, 180..183, 0),
        "xxx",
        "it keeps its desk frames"
    );
    // Its first paint comes; once idle after it, it rests.
    assert!(slow.due(late, Some(183), 1));
    let rest = late + LONG_IDLE;
    assert!(slow.long_idle(rest));
    assert_eq!(taken(&mut slow, rest, 240..243, 1), "...");
    // A reload in place (or a restart) starts over: frames until the new page paints.
    slow.loading(rest);
    let again = rest + LONG_IDLE * 2;
    assert!(!slow.long_idle(again), "a new page, not painted yet");
    assert_eq!(taken(&mut slow, again, 300..303, 1), "xxx");
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
fn a_desk_at_rest_has_nothing_to_look_at_until_a_page_asks_or_a_press_comes() {
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
    let k = clock.frame(rest);
    assert!(!pacing.due(rest, k, 1));
    assert_eq!(pacing.next(&clock, rest), None, "no look at rest");
    pacing.ask(rest);
    assert_eq!(
        pacing.next(&clock, rest),
        clock.next(),
        "its page asked: the next desk frame"
    );
    let after = rest + ASKED_FOR + FRAME;
    assert_eq!(
        pacing.next(&clock, after),
        None,
        "and none once the ask is over"
    );
    let k = clock.frame(after);
    assert!(!pacing.due(after, k, 1));
    pacing.press(after, 1);
    assert_eq!(
        pacing.next(&clock, after),
        Some(after),
        "a press looks at once"
    );
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
    asked(-119);
    let got: Vec<(i32, Heard)> = take_heard()
        .into_iter()
        .filter(|(id, _, _)| *id <= -117)
        .map(|(id, _, what)| (id, what))
        .collect();
    assert_eq!(
        got,
        [
            (-117, Heard::Prompt),
            (-118, Heard::Woken),
            (-119, Heard::Asked)
        ]
    );
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
